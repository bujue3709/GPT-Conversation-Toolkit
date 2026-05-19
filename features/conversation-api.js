/*
 * ChatGPT Conversation Toolkit - Conversation API access
 */
const EXPORT_API_TIMEOUT_MS = 10000;
const EXPORT_API_RETRY_COUNT = 1;

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

const fetchJsonWithTimeout = async (url, options = {}) => {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : EXPORT_API_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
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

const fetchConversationById = async (conversationId, options = {}) => {
  const normalizedId = normalizeStrictConversationId(conversationId || "");
  if (!normalizedId) {
    throw new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
  }

  let lastError = null;
  const candidates = getConversationApiCandidates(normalizedId);
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
    if (captured?.data) {
      return captured;
    }
  }

  let lastError = null;
  for (const conversationId of candidates) {
    try {
      return await fetchConversationById(conversationId, options);
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
