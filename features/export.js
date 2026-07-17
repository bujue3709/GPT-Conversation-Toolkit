/*
 * ChatGPT Conversation Toolkit - Conversation export
 */
let exportInProgress = false;

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
  try {
    const preparedExport = options.preparedExport?.payload
      ? options.preparedExport
      : await prepareConversationExportPayload(options);
    const payload = applyExportSelection(preparedExport.payload, {
      scope: options.scope,
      selectedTurnIds: options.selectedTurnIds,
      roleFilter: options.roleFilter || TOOLKIT_EXPORT_ROLE,
    });
    if (payload.messageCount === 0) {
      updateStatusByKey("status.exportEmptySelection", "warn");
      return null;
    }

    downloadConversationExport(payload, options.format || TOOLKIT_EXPORT_FORMAT);
    updateStatusByKey(
      preparedExport.usedFallback ? "status.exportFallbackDone" : "status.exportApiDone",
      preparedExport.usedFallback ? "warn" : "success",
      { count: payload.messageCount },
    );
    return payload;
  } catch (error) {
    const normalizedError = normalizeExportApiError(error, "Export failed.");
    updateStatusByKey("status.exportFailed", "warn", {
      reason: normalizedError.message,
    });
    return null;
  } finally {
    exportInProgress = false;
  }
};
