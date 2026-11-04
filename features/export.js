/*
 * ChatGPT Conversation Toolkit - Conversation export
 */
let exportInProgress = false;
let exportAbortController = null;
const cancelConversationExport = () => exportAbortController?.abort();

/*
 * Build an export payload from the shared conversation index. When the
 * conversation endpoint refuses (403) or the network is gone, a complete
 * already-known branch can still be exported without pretending to be fresh.
 */
const prepareConversationExportFromIndex = (options = {}, apiError = null) => {
  const index = typeof getReadyConversationIndex === "function" ? getReadyConversationIndex() : null;
  if (!index || index.messages.length === 0) {
    return null;
  }
  try {
    const payload = buildConversationExportPayloadFromIndex(index, {
      conversationId: index.conversationId,
      url: window.location.href,
      apiError,
    });
    payload.apiDataSource = index.dataSource || "conversation-index";
    payload.indexUpdatedAt = index.updatedAt || index.loadedAt || 0;
    payload.indexStatus = index.status;
    return payload;
  } catch (error) {
    return null;
  }
};

const prepareConversationExportPayload = async (options = {}) => {
  const updatePreparationStatus = options.updateStatus === false
    ? () => {}
    : updateStatusByKey;
  updatePreparationStatus("status.exportPreparing", "info");

  // A stored index is read before the first request, so a 403 can still fall
  // back to the history that was already obtained in an earlier session.
  if (typeof ensureConversationIndexRestored === "function") {
    await ensureConversationIndexRestored();
  }

  const includeRaw = Boolean(options.includeRaw);
  const conversationIdCandidates = getStrictConversationIdCandidates();
  const conversationId = conversationIdCandidates[0] || null;
  let apiError = null;

  if (conversationId) {
    try {
      updatePreparationStatus("status.exportApiLoading", "info");
      const response = await fetchConversationByIdCandidates(conversationIdCandidates, {
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        signal: options.signal,
      });
      const payload = normalizeConversationApiResponse(response.data, {
        conversationId: response.conversationId || conversationId,
        url: window.location.href,
        includeRaw,
        completeness: response.completeness,
      });
      if (response.captured) {
        payload.apiDataSource = "captured-page-response";
      }
      return { payload, usedFallback: false, fromCache: false, requiresPartialConsent: false, apiError: null };
    } catch (error) {
      apiError = normalizeExportApiError(error);
      if (apiError.code === "CANCELLED") {
        throw apiError;
      }
    }
  } else {
    apiError = new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
  }

  // A usable index (fresh or stale) always beats DOM-only data: it is the full
  // branch, the DOM only holds the currently mounted window.
  const cachedPayload = prepareConversationExportFromIndex(options, apiError);
  if (cachedPayload) {
    updatePreparationStatus("status.exportCacheUsed", "warn");
    return {
      payload: cachedPayload,
      usedFallback: false,
      fromCache: true,
      requiresPartialConsent: false,
      apiError,
    };
  }

  // Only the loaded page is available: export is possible, but the user has to
  // ask for it explicitly - it is never silently labelled complete.
  if (options.allowPartial) {
    try {
      const payload = collectMessagesFromDomFallback({
        conversationId,
        apiError,
      });
      return {
        payload,
        usedFallback: true,
        fromCache: false,
        requiresPartialConsent: false,
        apiError,
      };
    } catch (fallbackError) {
      throw normalizeExportApiError(
        fallbackError,
        "DOM fallback export failed.",
      );
    }
  }

  updatePreparationStatus("status.exportNeedsConsent", "warn");
  return {
    payload: null,
    usedFallback: false,
    fromCache: false,
    requiresPartialConsent: true,
    apiError,
  };
};

const exportMessages = async (options = {}) => {
  if (exportInProgress) {
    updateStatusByKey("status.exportAlreadyRunning", "warn");
    return null;
  }

  exportInProgress = true;
  exportAbortController = new AbortController();
  try {
    updateStatusByKey("status.exportPreparing", "info");
    await new Promise(resolve => setTimeout(resolve, 0));
    const preparedExport = options.preparedExport?.payload
      ? options.preparedExport
      : await prepareConversationExportPayload({ ...options, signal: exportAbortController.signal });
    exportAbortController.signal.throwIfAborted();
    if (!preparedExport?.payload) {
      updateStatusByKey("status.exportNeedsConsent", "warn");
      return null;
    }
    const payload = applyExportSelection(preparedExport.payload, {
      scope: options.scope,
      selectedTurnIds: options.selectedTurnIds,
      roleFilter: options.roleFilter || TOOLKIT_EXPORT_ROLE,
    });
    if (payload.messageCount === 0) {
      updateStatusByKey("status.exportEmptySelection", "warn");
      return null;
    }

    const format = options.format || TOOLKIT_EXPORT_FORMAT;
    payload.includeImages = options.includeImages ?? TOOLKIT_EXPORT_IMAGES;
    if (payload.includeImages && payload.messages.some((message) => message.images?.length)) {
      return await exportConversationImageArchive(payload, {
        format, signal: exportAbortController.signal, usedFallback: preparedExport.usedFallback,
        onProgress: typeof setExportSelectionImageProgress === "function" ? setExportSelectionImageProgress : undefined,
      });
    }
    if (format === TOOLKIT_EXPORT_FORMAT_PNG) {
      await exportConversationPng(payload, {
        usedFallback: preparedExport.usedFallback,
        signal: exportAbortController.signal,
      });
      return payload;
    }

    downloadConversationExport(payload, format);
    const doneStatusKey = preparedExport.usedFallback
      ? "status.exportFallbackDone"
      : preparedExport.fromCache
        ? "status.exportCacheDone"
        : "status.exportApiDone";
    updateStatusByKey(
      doneStatusKey,
      preparedExport.usedFallback || preparedExport.fromCache ? "warn" : "success",
      { count: payload.messageCount },
    );
    return payload;
  } catch (error) {
    if (error.name === "AbortError" || exportAbortController?.signal.aborted) {
      updateStatusByKey("exportImages.cancelled", "info");
      return null;
    }
    const normalizedError = normalizeExportApiError(error, "Export failed.");
    const failureStatusKey = (options.format || TOOLKIT_EXPORT_FORMAT) === TOOLKIT_EXPORT_FORMAT_PNG
      && typeof getPngExportFailureStatusKey === "function"
      ? getPngExportFailureStatusKey(error)
      : "status.exportFailed";
    updateStatusByKey(failureStatusKey, "warn", {
      reason: normalizedError.message,
    });
    return null;
  } finally {
    exportInProgress = false;
    if (typeof updateExportSelectionProgress === "function") updateExportSelectionProgress();
    exportAbortController = null;
  }
};
