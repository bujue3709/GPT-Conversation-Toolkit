/*
 * ChatGPT Conversation Toolkit - Conversation API access
 */
const EXPORT_API_TIMEOUT_MS = 10000;
const EXPORT_API_RETRY_COUNT = 1;
const EXPORT_API_PAGE_NUM_TURNS = 100;
const EXPORT_API_MAX_PAGES = 500;
const EXPORT_API_SESSION_TIMEOUT_MS = 5000;

let exportApiAccessTokenPromise = null;

class ExportApiError extends Error {
  constructor(code, message, options = {}) {
    super(message || code || "Export API error");
    this.name = "ExportApiError";
    this.code = code || "UNKNOWN";
    this.status = Number.isFinite(options.status) ? options.status : 0;
    this.fallbackAllowed = options.fallbackAllowed !== false;
    this.url = typeof options.url === "string" ? options.url : "";
    this.details = options.details || null;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

const normalizeExportApiError = (error, fallbackMessage = "Conversation API request failed.") => {
  if (error instanceof ExportApiError) {
    return error;
  }

  return new ExportApiError("UNKNOWN", error?.message || fallbackMessage, {
    fallbackAllowed: true,
    cause: error,
  });
};

const serializeExportApiError = (error) => {
  if (!error) {
    return null;
  }

  const normalized = normalizeExportApiError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    status: normalized.status || undefined,
    fallbackAllowed: normalized.fallbackAllowed,
    url: normalized.url || undefined,
  };
};

const getConversationApiCandidates = (conversationId) => {
  const encodedId = encodeURIComponent(conversationId);
  const currentOrigin = window.location.origin;
  const alternateOrigin =
    window.location.hostname === "chatgpt.com"
      ? "https://chat.openai.com"
      : window.location.hostname === "chat.openai.com"
        ? "https://chatgpt.com"
        : "";
  const origins = [currentOrigin, alternateOrigin].filter(Boolean);
  const candidates = [];
  const seen = new Set();

  origins.forEach((origin) => {
    [
      `${origin}/backend-api/conversation/${encodedId}?include_full_conversation=true`,
      `${origin}/backend-api/conversation/${encodedId}`,
      `${origin}/backend-api/conversation/${encodedId}?offset=0&limit=100000`,
    ].forEach((url) => {
      if (seen.has(url)) {
        return;
      }
      seen.add(url);
      candidates.push(url);
    });
  });

  return candidates;
};

const getConversationMappingValue = (data) => {
  const mapping = data?.mapping || data?.conversation?.mapping;
  return mapping && typeof mapping === "object" && !Array.isArray(mapping) ? mapping : null;
};

const isCompleteConversationMapping = (data) => {
  const mapping = getConversationMappingValue(data);
  if (!mapping) {
    return false;
  }

  const currentNodeId =
    data?.current_node ||
    data?.current_node_id ||
    data?.conversation?.current_node ||
    data?.conversation?.current_node_id ||
    "";
  if (!currentNodeId || !mapping[currentNodeId]) {
    return false;
  }

  const seen = new Set();
  let nextId = currentNodeId;
  while (nextId) {
    if (seen.has(nextId) || !mapping[nextId]) {
      return false;
    }
    seen.add(nextId);
    nextId = mapping[nextId]?.parent || "";
  }
  return true;
};

const getPaginatedConversationApiUrl = (origin, conversationId, before = "") => {
  const encodedId = encodeURIComponent(conversationId);
  const path = before
    ? `/backend-api/conversations/${encodedId}/messages`
    : `/backend-api/conversations/${encodedId}`;
  const url = new URL(path, origin);
  if (before) {
    url.searchParams.set("before", before);
  }
  url.searchParams.set("include_has_versions", "true");
  url.searchParams.set("num_turns", String(EXPORT_API_PAGE_NUM_TURNS));
  return url.toString();
};

const getPaginatedConversationCursor = (data) => {
  const pageInfo = data?.page_info || data?.pageInfo || {};
  const hasPreviousPage =
    pageInfo.has_previous_page === true || pageInfo.hasPreviousPage === true;
  const cursor = pageInfo.start_cursor || pageInfo.startCursor || "";
  return hasPreviousPage && typeof cursor === "string" ? cursor : "";
};

const mergePaginatedConversationMessages = (olderMessages, newerMessages) => {
  const merged = [];
  const seen = new Set();
  [...olderMessages, ...newerMessages].forEach((message) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const id = typeof message.id === "string" ? message.id : "";
    const key = id || `message-offset-${merged.length}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(message);
  });
  return merged;
};

const buildConversationMappingFromMessages = (messages, conversationId, currentNodeId = "") => {
  const rootId = `paginated-root:${conversationId}`;
  const mapping = {
    [rootId]: {
      id: rootId,
      parent: "",
      children: [],
    },
  };
  let parentId = rootId;

  messages.forEach((message, index) => {
    let messageId = typeof message?.id === "string" && message.id
      ? message.id
      : `paginated-message-${index + 1}`;
    if (mapping[messageId]) {
      messageId = `paginated-message-${index + 1}-${messageId}`;
    }
    const node = {
      id: messageId,
      parent: parentId,
      children: [],
      message: message.id === messageId ? message : { ...message, id: messageId },
    };
    mapping[parentId].children = [messageId];
    mapping[messageId] = node;
    parentId = messageId;
  });

  return {
    mapping,
    currentNodeId: currentNodeId && mapping[currentNodeId] ? currentNodeId : parentId,
  };
};

const getNormalizedConversationIdCandidates = (conversationIds) => {
  const values = Array.isArray(conversationIds) ? conversationIds : [conversationIds];
  const candidates = [];
  const seen = new Set();
  values.forEach((conversationId) => {
    const normalizedId = normalizeStrictConversationId(conversationId || "");
    if (!normalizedId || seen.has(normalizedId)) {
      return;
    }
    seen.add(normalizedId);
    candidates.push(normalizedId);
  });
  return candidates;
};

const shouldRetryExportApiRequest = (error) =>
  error?.code === "NETWORK" ||
  error?.code === "TIMEOUT" ||
  (Number.isFinite(error?.status) && error.status >= 500 && error.status < 600);

const getExportApiAccessToken = async (options = {}) => {
  if (options.forceRefresh) {
    exportApiAccessTokenPromise = null;
  }
  if (exportApiAccessTokenPromise) {
    return exportApiAccessTokenPromise;
  }

  exportApiAccessTokenPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXPORT_API_SESSION_TIMEOUT_MS);
    const sessionUrl = new URL("/api/auth/session", window.location.origin).toString();
    try {
      const response = await fetch(sessionUrl, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ExportApiError(
          "AUTH_SESSION",
          `ChatGPT session API returned HTTP ${response.status}.`,
          { status: response.status, fallbackAllowed: true, url: sessionUrl },
        );
      }
      const session = await response.json();
      const accessToken = session?.accessToken || session?.access_token || "";
      if (typeof accessToken !== "string" || accessToken.length < 20) {
        throw new ExportApiError(
          "AUTH_SESSION",
          "ChatGPT session API returned no access token.",
          { fallbackAllowed: true, url: sessionUrl },
        );
      }
      return accessToken;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new ExportApiError("AUTH_SESSION_TIMEOUT", "ChatGPT session request timed out.", {
          fallbackAllowed: true,
          url: sessionUrl,
          cause: error,
        });
      }
      throw normalizeExportApiError(error, "Unable to read the ChatGPT session.");
    } finally {
      clearTimeout(timeoutId);
    }
  })().catch((error) => {
    exportApiAccessTokenPromise = null;
    throw error;
  });

  return exportApiAccessTokenPromise;
};

const getAuthenticatedExportApiHeaders = async (url, headers = {}) => {
  const normalizedHeaders = { ...headers };
  let isBackendApi = false;
  try {
    isBackendApi = new URL(url, window.location.origin).pathname.startsWith("/backend-api/");
  } catch (error) {}
  if (!isBackendApi || Object.keys(normalizedHeaders).some(
    (name) => name.toLowerCase() === "authorization",
  )) {
    return normalizedHeaders;
  }

  try {
    const accessToken = await getExportApiAccessToken();
    normalizedHeaders.Authorization = `Bearer ${accessToken}`;
  } catch (error) {
    // Keep the cookie-only request as a compatibility fallback. The resulting
    // HTTP error is more useful than failing before the conversation request.
  }
  return normalizedHeaders;
};

const fetchJsonWithTimeout = async (url, options = {}) => {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : EXPORT_API_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const authenticatedHeaders = await getAuthenticatedExportApiHeaders(url, options.headers || {});
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        Accept: "application/json",
        ...authenticatedHeaders,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "AUTH"
          : response.status === 404
            ? "NOT_FOUND"
            : "HTTP_STATUS";
      throw new ExportApiError(code, `Conversation API returned HTTP ${response.status}.`, {
        status: response.status,
        fallbackAllowed: true,
        url,
      });
    }

    try {
      return {
        data: await response.json(),
        status: response.status,
        url,
      };
    } catch (error) {
      throw new ExportApiError("INVALID_JSON", "Conversation API returned invalid JSON.", {
        status: response.status,
        fallbackAllowed: true,
        url,
        cause: error,
      });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ExportApiError("TIMEOUT", "Conversation API request timed out.", {
        fallbackAllowed: true,
        url,
        cause: error,
      });
    }
    if (error instanceof ExportApiError) {
      throw error;
    }
    throw new ExportApiError("NETWORK", error?.message || "Conversation API request failed.", {
      fallbackAllowed: true,
      url,
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchPaginatedConversationById = async (conversationId, options = {}) => {
  const origins = [
    window.location.origin,
    window.location.hostname === "chatgpt.com"
      ? "https://chat.openai.com"
      : window.location.hostname === "chat.openai.com"
        ? "https://chatgpt.com"
        : "",
  ].filter(Boolean);
  let lastError = null;

  for (const origin of origins) {
    try {
      const firstResponse = await fetchJsonWithTimeout(
        getPaginatedConversationApiUrl(origin, conversationId),
        { timeoutMs: options.timeoutMs },
      );
      const firstData = firstResponse.data;
      if (!Array.isArray(firstData?.messages)) {
        throw new ExportApiError(
          "INVALID_RESPONSE",
          "Paginated conversation API returned no messages.",
          { status: firstResponse.status, fallbackAllowed: true, url: firstResponse.url },
        );
      }

      let messages = mergePaginatedConversationMessages([], firstData.messages);
      let cursor = getPaginatedConversationCursor(firstData);
      const seenCursors = new Set();
      let pageCount = 1;

      while (cursor) {
        if (seenCursors.has(cursor) || pageCount >= EXPORT_API_MAX_PAGES) {
          throw new ExportApiError(
            "PAGINATION_STALLED",
            "Paginated conversation API did not reach the oldest message.",
            { fallbackAllowed: true, url: firstResponse.url },
          );
        }
        seenCursors.add(cursor);

        const pageResponse = await fetchJsonWithTimeout(
          getPaginatedConversationApiUrl(origin, conversationId, cursor),
          { timeoutMs: options.timeoutMs },
        );
        if (!Array.isArray(pageResponse.data?.messages)) {
          throw new ExportApiError(
            "INVALID_RESPONSE",
            "Paginated conversation message page returned no messages.",
            { status: pageResponse.status, fallbackAllowed: true, url: pageResponse.url },
          );
        }
        messages = mergePaginatedConversationMessages(pageResponse.data.messages, messages);
        cursor = getPaginatedConversationCursor(pageResponse.data);
        pageCount += 1;
      }

      if (messages.length === 0) {
        throw new ExportApiError("EMPTY_EXPORT", "Paginated conversation API returned no messages.", {
          fallbackAllowed: true,
          url: firstResponse.url,
        });
      }

      const rebuilt = buildConversationMappingFromMessages(
        messages,
        conversationId,
        firstData.current_node || firstData.current_node_id || "",
      );
      return {
        data: {
          ...firstData,
          conversation_id: firstData.conversation_id || conversationId,
          current_node: rebuilt.currentNodeId,
          mapping: rebuilt.mapping,
        },
        status: firstResponse.status,
        url: firstResponse.url,
        conversationId,
        paginated: true,
        pageCount,
      };
    } catch (error) {
      lastError = normalizeExportApiError(error);
      if (!lastError.fallbackAllowed) {
        throw lastError;
      }
    }
  }

  throw lastError || new ExportApiError(
    "UNKNOWN",
    "Paginated conversation API request failed.",
    { fallbackAllowed: true },
  );
};

const fetchConversationById = async (conversationId, options = {}) => {
  const normalizedId = normalizeStrictConversationId(conversationId || "");
  if (!normalizedId) {
    throw new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
  }

  let lastError = null;
  const candidates = getConversationApiCandidates(normalizedId).filter((url) => {
    const isFullConversationRequest = url.includes("include_full_conversation=true");
    if (options.fullConversationOnly) {
      return isFullConversationRequest;
    }
    if (options.legacyOnly) {
      return !isFullConversationRequest;
    }
    return true;
  });
  const retryCount = Number.isFinite(options.retries)
    ? Math.max(0, Math.trunc(options.retries))
    : EXPORT_API_RETRY_COUNT;
  for (const url of candidates) {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const response = await fetchJsonWithTimeout(url, {
          timeoutMs: options.timeoutMs,
        });
        if (!response.data || typeof response.data !== "object") {
          throw new ExportApiError("INVALID_RESPONSE", "Conversation API returned an empty response.", {
            status: response.status,
            fallbackAllowed: true,
            url,
          });
        }
        if (!isCompleteConversationMapping(response.data)) {
          throw new ExportApiError(
            "INCOMPLETE_RESPONSE",
            "Conversation API returned only part of the active message path.",
            {
              status: response.status,
              fallbackAllowed: true,
              url,
            },
          );
        }
        return {
          ...response,
          conversationId: normalizedId,
        };
      } catch (error) {
        lastError = normalizeExportApiError(error);
        if (
          !lastError.fallbackAllowed ||
          attempt >= retryCount ||
          !shouldRetryExportApiRequest(lastError)
        ) {
          break;
        }
      }
    }

    if (lastError && !lastError.fallbackAllowed) {
      throw lastError;
    }
  }

  throw lastError || new ExportApiError("UNKNOWN", "Conversation API request failed.", {
    fallbackAllowed: true,
  });
};

const fetchConversationByIdCandidates = async (conversationIds, options = {}) => {
  const candidates = getNormalizedConversationIdCandidates(conversationIds);
  if (candidates.length === 0) {
    throw new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
  }

  if (typeof getCapturedConversationApiResponse === "function") {
    const captured = getCapturedConversationApiResponse(candidates);
    if (captured?.data && isCompleteConversationMapping(captured.data)) {
      return captured;
    }
  }

  let lastError = null;
  for (const conversationId of candidates) {
    try {
      return await fetchConversationById(conversationId, {
        ...options,
        fullConversationOnly: true,
      });
    } catch (error) {
      lastError = normalizeExportApiError(error);
      if (!lastError.fallbackAllowed) {
        throw lastError;
      }
    }

    try {
      return await fetchPaginatedConversationById(conversationId, options);
    } catch (error) {
      lastError = normalizeExportApiError(error);
      if (!lastError.fallbackAllowed) {
        throw lastError;
      }
    }

    try {
      return await fetchConversationById(conversationId, {
        ...options,
        legacyOnly: true,
      });
    } catch (error) {
      lastError = normalizeExportApiError(error);
      if (!lastError.fallbackAllowed) {
        throw lastError;
      }
    }
  }

  throw lastError || new ExportApiError("UNKNOWN", "Conversation API request failed.", {
    fallbackAllowed: true,
  });
};
