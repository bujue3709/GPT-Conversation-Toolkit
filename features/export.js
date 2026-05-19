/*
 * ChatGPT Conversation Toolkit - Conversation export
 */
let exportInProgress = false;

const exportMessages = async (options = {}) => {
  if (exportInProgress) {
    updateStatusByKey("status.exportAlreadyRunning", "warn");
    return null;
  }

  exportInProgress = true;
  updateStatusByKey("status.exportPreparing", "info");

  const includeRaw = Boolean(options.includeRaw);
  const conversationIdCandidates = getStrictConversationIdCandidates();
  const conversationId = conversationIdCandidates[0] || null;
  let apiError = null;

  try {
    if (!conversationId) {
      apiError = new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
        fallbackAllowed: true,
      });
      updateStatusByKey("status.exportFallback", "warn");
    } else {
      try {
        updateStatusByKey("status.exportApiLoading", "info");
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
        downloadConversationExport(payload, options.format || TOOLKIT_EXPORT_FORMAT);
        updateStatusByKey("status.exportApiDone", "success", {
          count: payload.messageCount,
        });
        return payload;
      } catch (error) {
        apiError = normalizeExportApiError(error);
        if (!apiError.fallbackAllowed) {
          updateStatusByKey("status.exportFailed", "warn", {
            reason: apiError.message,
          });
          return null;
        }
        updateStatusByKey("status.exportFallback", "warn");
      }
    }

    try {
      const payload = collectMessagesFromDomFallback({
        conversationId,
        apiError,
      });
      downloadConversationExport(payload, options.format || TOOLKIT_EXPORT_FORMAT);
      updateStatusByKey("status.exportFallbackDone", "warn", {
        count: payload.messageCount,
      });
      return payload;
    } catch (fallbackError) {
      const normalizedFallbackError = normalizeExportApiError(
        fallbackError,
        "DOM fallback export failed.",
      );
      updateStatusByKey("status.exportFailed", "warn", {
        reason: normalizedFallbackError.message,
      });
      return null;
    }
  } finally {
    exportInProgress = false;
  }
};
