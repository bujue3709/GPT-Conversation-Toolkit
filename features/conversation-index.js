/*
 * ChatGPT Conversation Toolkit - Shared conversation index
 */
const CONVERSATION_INDEX_SCHEMA_VERSION = 1;
const CONVERSATION_INDEX_CAPTURE_REFRESH_DELAY_MS = 350;

let conversationIndexRefreshTimer = null;

const normalizeConversationIndexText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const truncateConversationIndexPreview = (value, maxLength = 160) => {
  const text = normalizeConversationIndexText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
};

const getConversationIndexIdCandidates = () =>
  typeof getStrictConversationIdCandidates === "function"
    ? getStrictConversationIdCandidates()
    : [];

const getCurrentConversationIndexId = () => getConversationIndexIdCandidates()[0] || "";

const isConversationIndexForCurrentConversation = () => {
  const currentId = getCurrentConversationIndexId();
  return Boolean(currentId && conversationIndexState.conversationId === currentId);
};

const clearConversationIndexMaps = () => {
  conversationIndexState.byMessageId = new Map();
  conversationIndexState.byIndex = new Map();
  conversationIndexState.byUserOrder = new Map();
};

const setConversationIndexFailed = (conversationId, error) => {
  conversationIndexState.conversationId = conversationId || "";
  conversationIndexState.title = "";
  conversationIndexState.source = "";
  conversationIndexState.status = "failed";
  conversationIndexState.messages = [];
  conversationIndexState.userMessages = [];
  conversationIndexState.loadedAt = 0;
  conversationIndexState.warnings = [];
  conversationIndexState.error = normalizeExportApiError(error);
  clearConversationIndexMaps();
};

const indexConversationMessages = (messages) => {
  const byMessageId = new Map();
  const byIndex = new Map();
  const byUserOrder = new Map();
  const userMessages = [];

  messages.forEach((message) => {
    byIndex.set(message.index, message);
    if (message.messageId) {
      byMessageId.set(message.messageId, message);
    }
    if (message.role === "user") {
      userMessages.push(message);
      if (Number.isFinite(message.userOrder)) {
        byUserOrder.set(message.userOrder, message);
      }
    }
  });

  return {
    byMessageId,
    byIndex,
    byUserOrder,
    userMessages,
  };
};

const normalizeConversationIndexMessage = (node, rawIndex, conversationModel, userOrderRef) => {
  const apiMessage = normalizeApiMessage(node, rawIndex, conversationModel);
  if (!apiMessage) {
    return null;
  }

  const messageId = apiMessage.id || node?.id || "";
  const text = normalizeExportMessageText(apiMessage.text || "");
  const markdown = normalizeExportMarkdownText(apiMessage.markdown || apiMessage.text || "");
  const userOrder = apiMessage.role === "user" ? userOrderRef.next++ : null;

  return {
    key: `api:${messageId || rawIndex}`,
    messageId,
    parentId: apiMessage.parentId || "",
    role: apiMessage.role || "unknown",
    index: rawIndex,
    userOrder,
    text,
    markdown,
    previewText: truncateConversationIndexPreview(text || markdown),
    createTime: apiMessage.createTime || "",
    updateTime: apiMessage.updateTime || "",
    status: apiMessage.status || "",
    model: apiMessage.model || "",
    attachments: Array.isArray(apiMessage.attachments) ? apiMessage.attachments : [],
    parts: Array.isArray(apiMessage.parts) ? apiMessage.parts : [],
    metadata: apiMessage.metadata || {},
    source: "api",
    node: null,
  };
};

const buildConversationIndexFromApiResponse = (data, options = {}) => {
  const warnings = [];
  const mapping = getApiMapping(data);
  if (!mapping) {
    throw new ExportApiError("INVALID_RESPONSE", "Conversation API response has no message mapping.", {
      fallbackAllowed: true,
    });
  }

  const currentNodeId = resolveApiCurrentNodeId(data, mapping, warnings);
  if (!currentNodeId) {
    throw new ExportApiError("INVALID_RESPONSE", "Conversation API response has no active message path.", {
      fallbackAllowed: true,
    });
  }

  const conversationModel =
    data?.default_model_slug ||
    data?.model_slug ||
    data?.conversation?.default_model_slug ||
    "";
  const userOrderRef = { next: 1 };
  const messages = buildActiveApiNodePath(mapping, currentNodeId, warnings)
    .map((node, index) => normalizeConversationIndexMessage(node, index + 1, conversationModel, userOrderRef))
    .filter(Boolean)
    .map((message, index) => ({
      ...message,
      index: index + 1,
    }));

  if (messages.length === 0) {
    throw new ExportApiError("EMPTY_INDEX", "Conversation API response has no usable messages.", {
      fallbackAllowed: true,
    });
  }

  let userOrder = 1;
  messages.forEach((message) => {
    if (message.role !== "user") {
      message.userOrder = null;
      return;
    }
    message.userOrder = userOrder;
    userOrder += 1;
  });

  const maps = indexConversationMessages(messages);
  return {
    conversationId: options.conversationId || data?.conversation_id || data?.id || "",
    title: resolveConversationTitleFromApi(data),
    source: "api",
    status: "ready",
    version: CONVERSATION_INDEX_SCHEMA_VERSION,
    messages,
    userMessages: maps.userMessages,
    byMessageId: maps.byMessageId,
    byIndex: maps.byIndex,
    byUserOrder: maps.byUserOrder,
    loadedAt: Date.now(),
    warnings: uniqueExportWarnings(warnings),
    error: null,
  };
};

const applyConversationIndex = (index) => {
  conversationIndexState.conversationId = index.conversationId || "";
  conversationIndexState.title = index.title || "";
  conversationIndexState.source = index.source || "";
  conversationIndexState.status = index.status || "ready";
  conversationIndexState.version += 1;
  conversationIndexState.messages = index.messages || [];
  conversationIndexState.userMessages = index.userMessages || [];
  conversationIndexState.byMessageId = index.byMessageId || new Map();
  conversationIndexState.byIndex = index.byIndex || new Map();
  conversationIndexState.byUserOrder = index.byUserOrder || new Map();
  conversationIndexState.loadedAt = index.loadedAt || Date.now();
  conversationIndexState.warnings = index.warnings || [];
  conversationIndexState.error = index.error || null;
};

const invalidateConversationIndex = () => {
  conversationIndexState.activeToken += 1;
  conversationIndexState.loadingPromise = null;
  conversationIndexState.conversationId = "";
  conversationIndexState.title = "";
  conversationIndexState.source = "";
  conversationIndexState.status = "idle";
  conversationIndexState.messages = [];
  conversationIndexState.userMessages = [];
  conversationIndexState.loadedAt = 0;
  conversationIndexState.warnings = [];
  conversationIndexState.error = null;
  clearConversationIndexMaps();
};

const getReadyConversationIndex = () => {
  if (
    conversationIndexState.status === "ready" &&
    conversationIndexState.messages.length > 0 &&
    isConversationIndexForCurrentConversation()
  ) {
    return conversationIndexState;
  }
  return null;
};

const loadConversationIndex = async (options = {}) => {
  const conversationIdCandidates = getConversationIndexIdCandidates();
  const conversationId = conversationIdCandidates[0] || "";
  if (!conversationId) {
    const error = new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
    setConversationIndexFailed("", error);
    throw error;
  }

  const readyIndex = getReadyConversationIndex();
  if (!options.force && readyIndex) {
    return readyIndex;
  }

  if (
    !options.force &&
    conversationIndexState.loadingPromise &&
    conversationIndexState.conversationId === conversationId
  ) {
    return conversationIndexState.loadingPromise;
  }

  const token = conversationIndexState.activeToken + 1;
  conversationIndexState.activeToken = token;
  conversationIndexState.conversationId = conversationId;
  conversationIndexState.status = "loading";
  conversationIndexState.error = null;

  const loadingPromise = fetchConversationByIdCandidates(conversationIdCandidates, {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  })
    .then((response) => {
      if (token !== conversationIndexState.activeToken) {
        return conversationIndexState;
      }
      const nextIndex = buildConversationIndexFromApiResponse(response.data, {
        conversationId: response.conversationId || conversationId,
      });
      if (response.captured) {
        nextIndex.dataSource = "captured-page-response";
      }
      applyConversationIndex(nextIndex);
      return conversationIndexState;
    })
    .catch((error) => {
      if (token === conversationIndexState.activeToken) {
        setConversationIndexFailed(conversationId, error);
      }
      throw normalizeExportApiError(error);
    })
    .finally(() => {
      if (token === conversationIndexState.activeToken) {
        conversationIndexState.loadingPromise = null;
      }
    });

  conversationIndexState.loadingPromise = loadingPromise;
  return loadingPromise;
};

const getConversationIndex = (options = {}) => loadConversationIndex(options);

const scheduleConversationIndexRefresh = (options = {}) => {
  if (conversationIndexRefreshTimer) {
    clearTimeout(conversationIndexRefreshTimer);
  }

  conversationIndexRefreshTimer = setTimeout(() => {
    conversationIndexRefreshTimer = null;
    loadConversationIndex({ ...options, force: true })
      .then(() => {
        if (timelineState.visible && typeof scheduleTimelineRefresh === "function") {
          scheduleTimelineRefresh();
        }
        if (state.searchQuery && typeof performSearch === "function") {
          performSearch(state.searchQuery);
        }
      })
      .catch(() => {
        if (timelineState.visible && typeof scheduleTimelineRefresh === "function") {
          scheduleTimelineRefresh();
        }
      });
  }, CONVERSATION_INDEX_CAPTURE_REFRESH_DELAY_MS);
};

window.addEventListener("chatgpt-toolkit-conversation-captured", (event) => {
  const capturedId = event?.detail?.conversationId || "";
  const currentId = getCurrentConversationIndexId();
  if (capturedId && currentId && capturedId !== currentId) {
    return;
  }
  scheduleConversationIndexRefresh({ timeoutMs: EXPORT_API_TIMEOUT_MS });
});
