/*
 * ChatGPT Conversation Toolkit - Conversation export
 */
let exportInProgress = false;
let exportAbortController = null;
const cancelConversationExport = () => exportAbortController?.abort();

const prepareConversationExportPayload = async (options = {}) => {
  const updatePreparationStatus = options.updateStatus === false
    ? () => {}
    : updateStatusByKey;
  updatePreparationStatus("status.exportPreparing", "info");

  const includeRaw = Boolean(options.includeRaw);
  const conversationIdCandidates = getStrictConversationIdCandidates();
  const conversationId = conversationIdCandidates[0] || null;
  let apiError = null;

  if (!conversationId) {
    apiError = new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
    updatePreparationStatus("status.exportFallback", "warn");
  } else {
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
      });
      if (response.captured) {
        payload.apiDataSource = "captured-page-response";
      }
      return { payload, usedFallback: false };
    } catch (error) {
      apiError = normalizeExportApiError(error);
      if (!apiError.fallbackAllowed) {
        throw apiError;
      }
      updatePreparationStatus("status.exportFallback", "warn");
    }
  }

  try {
    const payload = collectMessagesFromDomFallback({
      conversationId,
      apiError,
    });
    return { payload, usedFallback: true };
  } catch (fallbackError) {
    throw normalizeExportApiError(
      fallbackError,
      "DOM fallback export failed.",
    );
  }
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
    updateStatusByKey(
      preparedExport.usedFallback ? "status.exportFallbackDone" : "status.exportApiDone",
      preparedExport.usedFallback ? "warn" : "success",
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
