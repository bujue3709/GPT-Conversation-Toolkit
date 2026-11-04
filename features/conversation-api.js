/*
 * ChatGPT Conversation Toolkit - Conversation API access
 */
const EXPORT_API_TIMEOUT_MS = 10000;
const EXPORT_API_RETRY_COUNT = 1;
const EXPORT_API_PAGE_NUM_TURNS = 100;
const EXPORT_API_MAX_PAGES = 500;
const EXPORT_API_SESSION_TIMEOUT_MS = 5000;
const EXPORT_API_SESSION_BACKOFF_MS = 30000;
const EXPORT_API_MAX_COOLDOWN_WAIT_MS = 15000;
const EXPORT_API_DEFAULT_COOLDOWN_MS = 20000;
const EXPORT_API_DIAGNOSTIC_LIMIT = 40;

let exportApiAccessTokenPromise = null;

/*
 * Diagnostics deliberately record only request category, status, timing and an
 * explicit Cloudflare challenge marker. Auth headers, cookies and conversation
 * content are never captured, so the log can be shared when reporting a bug.
 */
const exportApiDiagnostics = [];
const conversationAccessState = {
  blocked: false,
  status: 0,
  challenge: false,
  conversationId: "",
  path: "",
  category: "",
  durationMs: 0,
  at: 0,
  cooldownUntil: 0,
  cooldownReason: "",
  sessionBlocked: false,
  sessionStatus: 0,
  sessionPath: "",
  sessionAt: 0,
};
const conversationRequestInflight = new Map();

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

const getConversationApiDiagnosticPath = (url) => {
  if (!url) {
    return "";
  }
  try {
    return new URL(url, window.location.origin).pathname.replace(
      /(\/backend-api\/conversations?\/)[^/]+/,
      "$1:id",
    );
  } catch (error) {
    return "";
  }
};

const recordExportApiDiagnostic = (entry = {}) => {
  const record = {
    at: Date.now(),
    category: entry.category || "conversation",
    path: getConversationApiDiagnosticPath(entry.url),
    status: Number.isFinite(entry.status) ? entry.status : 0,
    durationMs: Math.max(0, Math.round(Number(entry.durationMs) || 0)),
    challenge: entry.challenge === true,
    retry: Number.isFinite(entry.retry) ? entry.retry : 0,
    outcome: entry.outcome || "",
  };
  exportApiDiagnostics.push(record);
  while (exportApiDiagnostics.length > EXPORT_API_DIAGNOSTIC_LIMIT) {
    exportApiDiagnostics.shift();
  }
  return record;
};

const getExportApiDiagnostics = () => exportApiDiagnostics.map((entry) => ({ ...entry }));
const clearExportApiDiagnostics = () => {
  exportApiDiagnostics.length = 0;
};

const isExportApiChallengeResponse = (response) =>
  response?.headers?.get?.("cf-mitigated") === "challenge";

const parseExportApiRetryAfterMs = (value) => {
  if (!value) {
    return 0;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(600000, Math.round(seconds * 1000));
  }
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.min(600000, Math.max(0, timestamp - Date.now()));
  }
  return 0;
};

const getConversationApiCooldownRemainingMs = () =>
  Math.max(0, conversationAccessState.cooldownUntil - Date.now());

const setConversationApiCooldown = (ms, reason = "rate-limited") => {
  const duration = Math.min(
    600000,
    Math.max(1000, Math.round(Number(ms) || EXPORT_API_DEFAULT_COOLDOWN_MS)),
  );
  conversationAccessState.cooldownUntil = Math.max(
    conversationAccessState.cooldownUntil,
    Date.now() + duration,
  );
  conversationAccessState.cooldownReason = reason;
  return duration;
};

const clearConversationApiCooldown = () => {
  conversationAccessState.cooldownUntil = 0;
  conversationAccessState.cooldownReason = "";
};

const waitForConversationApiCooldown = async (signal) => {
  const remaining = getConversationApiCooldownRemainingMs();
  if (remaining <= 0) {
    return 0;
  }
  if (remaining > EXPORT_API_MAX_COOLDOWN_WAIT_MS) {
    throw new ExportApiError(
      "RATE_LIMITED",
      `ChatGPT asked to wait ${Math.ceil(remaining / 1000)}s before the next request.`,
      { status: 429, fallbackAllowed: false, details: { retryAfterMs: remaining } },
    );
  }
  await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortError = new Error("Conversation export cancelled.");
      abortError.name = "AbortError";
      reject(abortError);
      return;
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timerId);
      cleanup();
      const abortError = new Error("Conversation export cancelled.");
      abortError.name = "AbortError";
      reject(abortError);
    };
    const timerId = setTimeout(() => {
      cleanup();
      resolve();
    }, remaining);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return remaining;
};

const markConversationAccessBlocked = ({
  status = 0,
  challenge = false,
  conversationId = "",
  url = "",
  category = "",
  durationMs = 0,
} = {}) => {
  conversationAccessState.blocked = true;
  conversationAccessState.status = status;
  conversationAccessState.challenge = challenge === true;
  conversationAccessState.conversationId = conversationId || "";
  conversationAccessState.path = getConversationApiDiagnosticPath(url);
  conversationAccessState.category = category || "";
  conversationAccessState.durationMs = Number(durationMs) || 0;
  conversationAccessState.at = Date.now();
};

const isConversationAccessBlocked = (conversationId = "") => {
  if (!conversationAccessState.blocked) {
    return false;
  }
  const blockedId = conversationAccessState.conversationId;
  // A block recorded for one conversation must not starve another one.
  return !blockedId || !conversationId || blockedId === conversationId;
};

const clearConversationAccessBlock = () => {
  conversationAccessState.blocked = false;
  conversationAccessState.status = 0;
  conversationAccessState.challenge = false;
  conversationAccessState.conversationId = "";
  conversationAccessState.path = "";
  conversationAccessState.category = "";
  conversationAccessState.durationMs = 0;
  conversationAccessState.at = 0;
  conversationAccessState.sessionBlocked = false;
  conversationAccessState.sessionStatus = 0;
  conversationAccessState.sessionPath = "";
  conversationAccessState.sessionAt = 0;
};

const getConversationAccessStatus = () => ({ ...conversationAccessState });

const CONVERSATION_API_ERROR_TEXT_KEYS = Object.freeze({
  ACCESS_BLOCKED: "exportAccess.blocked",
  ACCESS_CHALLENGE: "exportAccess.challenge",
  ACCESS_UNAUTHORIZED: "exportAccess.unauthorized",
  RATE_LIMITED: "exportAccess.rateLimited",
  AUTH_SESSION: "exportAccess.session",
  AUTH_SESSION_TIMEOUT: "exportAccess.sessionTimeout",
  TIMEOUT: "exportAccess.timeout",
  NETWORK: "exportAccess.network",
  INCOMPLETE_RESPONSE: "exportAccess.incomplete",
  INVALID_RESPONSE: "exportAccess.invalidResponse",
  INVALID_JSON: "exportAccess.invalidResponse",
  PAGINATION_STALLED: "exportAccess.paginationStalled",
  NO_CONVERSATION_ID: "exportAccess.noConversationId",
  AUTH_REQUIRED: "exportAccess.authRequired",
  CANCELLED: "exportAccess.cancelled",
});

const getExportApiErrorText = (error, fallback = "") => {
  const normalized = normalizeExportApiError(error);
  const textKey = CONVERSATION_API_ERROR_TEXT_KEYS[normalized.code];
  const retryAfterMs =
    normalized.details?.retryAfterMs || getConversationApiCooldownRemainingMs();
  if (textKey && typeof t === "function") {
    return t(textKey, {
      status: normalized.status || 0,
      seconds: Math.max(1, Math.ceil((retryAfterMs || 0) / 1000)),
      challenge: normalized.details?.challenge === true ? " · Cloudflare challenge" : "",
    });
  }
  return normalized.message || fallback;
};

const canFallbackFromExportApiError = (error) => {
  const normalized = normalizeExportApiError(error);
  if (normalized.fallbackAllowed !== true) {
    return false;
  }
  // A rate limit is a shared cooldown, never a signal to try another endpoint.
  return normalized.code !== "RATE_LIMITED";
};

const getConversationApiCandidates = (conversationId) => {
  const encodedId = encodeURIComponent(conversationId);
  const origin = window.location.origin;
  return [
    `${origin}/backend-api/conversation/${encodedId}`,
    `${origin}/backend-api/conversation/${encodedId}?include_full_conversation=true`,
  ];
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

const getConversationPageInfo = (data) =>
  data?.page_info ||
  data?.pageInfo ||
  data?.conversation?.page_info ||
  data?.conversation?.pageInfo ||
  null;

/*
 * The message chain reaching the root only proves the active branch is
 * self-consistent. A paginated response can stop at a server page boundary on
 * the newest side, so completeness has to combine the chain walk with the
 * paging metadata the server returned for the oldest page.
 */
const assessConversationCompleteness = (data, meta = {}) => {
  const chainComplete = isCompleteConversationMapping(data);
  const pageInfo = getConversationPageInfo(data);
  const paginated = meta.paginated === true || Boolean(pageInfo);
  let paginationComplete = true;
  if (paginated) {
    if (meta.paginationComplete === true) {
      paginationComplete = true;
    } else if (meta.paginationComplete === false) {
      paginationComplete = false;
    } else {
      paginationComplete = pageInfo?.has_previous_page !== true;
    }
  }
  return {
    chainComplete,
    paginated,
    paginationComplete,
    complete: chainComplete && paginationComplete,
    pageCount: Number.isFinite(meta.pageCount) ? meta.pageCount : 0,
    source: meta.source || (paginated ? "paginated" : "conversation"),
  };
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
    conversationAccessState.sessionBlocked = false;
    conversationAccessState.sessionStatus = 0;
    conversationAccessState.sessionPath = "";
    conversationAccessState.sessionAt = 0;
  }
  if (exportApiAccessTokenPromise) {
    return exportApiAccessTokenPromise;
  }
  // Do not hit a refusing session endpoint again for a while: the caller falls
  // back to cookie-only requests in the meantime.
  if (
    conversationAccessState.sessionBlocked &&
    Date.now() - conversationAccessState.sessionAt < EXPORT_API_SESSION_BACKOFF_MS
  ) {
    throw new ExportApiError(
      "ACCESS_BLOCKED",
      `ChatGPT session endpoint refused earlier (HTTP ${conversationAccessState.sessionStatus}); using cookie-only requests.`,
      {
        status: conversationAccessState.sessionStatus,
        fallbackAllowed: false,
        url: conversationAccessState.sessionPath,
        details: { category: "session", backoff: true },
      },
    );
  }

  exportApiAccessTokenPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXPORT_API_SESSION_TIMEOUT_MS);
    const sessionUrl = new URL("/api/auth/session", window.location.origin).toString();
    const startedAt = Date.now();
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
      const challenge = isExportApiChallengeResponse(response);
      const durationMs = Date.now() - startedAt;
      if (response.status === 429) {
        const cooldownMs = setConversationApiCooldown(
          parseExportApiRetryAfterMs(response.headers.get("retry-after")),
          "session-rate-limited",
        );
        recordExportApiDiagnostic({
          category: "session",
          url: sessionUrl,
          status: 429,
          durationMs,
          challenge,
          outcome: "rate-limited",
        });
        throw new ExportApiError(
          "RATE_LIMITED",
          `ChatGPT session endpoint is rate limited (HTTP 429). Retry in about ${Math.ceil(cooldownMs / 1000)}s.`,
          { status: 429, fallbackAllowed: false, url: sessionUrl, details: { retryAfterMs: cooldownMs } },
        );
      }
      if ([401, 403].includes(response.status) || challenge) {
        // A refused session endpoint does not imply the conversation endpoint is
        // refused: record it, back off from the session endpoint, and let the
        // caller continue with cookies only.
        conversationAccessState.sessionBlocked = true;
        conversationAccessState.sessionStatus = response.status;
        conversationAccessState.sessionPath = getConversationApiDiagnosticPath(sessionUrl);
        conversationAccessState.sessionAt = Date.now();
        recordExportApiDiagnostic({
          category: "session",
          url: sessionUrl,
          status: response.status,
          durationMs,
          challenge,
          outcome: challenge ? "challenge" : "blocked",
        });
        throw new ExportApiError(
          "ACCESS_BLOCKED",
          `ChatGPT session endpoint refused (HTTP ${response.status}); continuing with cookie-only requests.`,
          {
            status: response.status,
            fallbackAllowed: false,
            url: sessionUrl,
            details: { challenge, category: "session", durationMs },
          },
        );
      }
      if (!response.ok) {
        recordExportApiDiagnostic({
          category: "session",
          url: sessionUrl,
          status: response.status,
          durationMs,
          challenge,
          outcome: "http-error",
        });
        throw new ExportApiError(
          "AUTH_SESSION",
          `ChatGPT session API returned HTTP ${response.status}.`,
          { status: response.status, fallbackAllowed: true, url: sessionUrl },
        );
      }
      const session = await response.json();
      const accessToken = session?.accessToken || session?.access_token || "";
      if (typeof accessToken !== "string" || accessToken.length < 20) {
        recordExportApiDiagnostic({
          category: "session",
          url: sessionUrl,
          status: response.status,
          durationMs,
          outcome: "no-token",
        });
        throw new ExportApiError(
          "AUTH_SESSION",
          "ChatGPT session API returned no access token.",
          { fallbackAllowed: true, url: sessionUrl },
        );
      }
      recordExportApiDiagnostic({
        category: "session",
        url: sessionUrl,
        status: response.status,
        durationMs,
        challenge,
        outcome: "ok",
      });
      conversationAccessState.sessionBlocked = false;
      conversationAccessState.sessionStatus = 0;
      conversationAccessState.sessionPath = "";
      conversationAccessState.sessionAt = 0;
      return accessToken;
    } catch (error) {
      if (error?.name === "AbortError") {
        recordExportApiDiagnostic({
          category: "session",
          url: sessionUrl,
          durationMs: Date.now() - startedAt,
          outcome: "timeout",
        });
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
    // The session endpoint is a *separate* surface from the conversation
    // endpoint: when it refuses (403/challenge), the same-origin page requests
    // still work with cookies alone. Fall back to cookie-only instead of
    // declaring the whole conversation unreadable.
    if (error.code !== "CANCELLED") {
      recordExportApiDiagnostic({
        category: "session-fallback",
        url,
        status: Number(error.status) || 0,
        durationMs: Number(error.details?.durationMs) || 0,
        challenge: error.details?.challenge === true,
        outcome: "cookie-only",
      });
    }
  }
  return normalizedHeaders;
};

const readConversationInaccessibleDetail = async (response) => {
  if (typeof response?.clone !== "function") {
    return false;
  }
  try {
    const text = await response.clone().text();
    return text.length > 0 && text.length <= 8192 && text.includes("conversation_inaccessible");
  } catch {
    return false;
  }
};

const fetchJsonWithTimeout = async (url, options = {}) => {
  const {
    category = "conversation",
    retry = 0,
    timeoutMs = EXPORT_API_TIMEOUT_MS,
    signal,
    conversationId = "",
    /*
     * A single endpoint variant can be refused while the conversation itself is
     * readable. Callers that try several variants pass markBlocked:false so one
     * 403 cannot stop the whole conversation; the caller decides afterwards.
     */
    markBlocked = true,
    ...fetchInit
  } = options;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) ? timeoutMs : EXPORT_API_TIMEOUT_MS,
  );
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();

  let recorded = false;
  const record = (outcome, extra = {}) => {
    if (recorded) {
      return;
    }
    recorded = true;
    recordExportApiDiagnostic({
      category,
      url,
      retry,
      durationMs: Date.now() - startedAt,
      outcome,
      ...extra,
    });
  };

  try {
    signal?.throwIfAborted();
    try {
      await waitForConversationApiCooldown(signal);
    } catch (cooldownError) {
      record("cooldown", { status: cooldownError?.status || 429 });
      throw cooldownError;
    }

    const authenticatedHeaders = await getAuthenticatedExportApiHeaders(url, fetchInit.headers || {});
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...fetchInit,
      headers: {
        Accept: "application/json",
        ...authenticatedHeaders,
      },
      signal: controller.signal,
    });

    const challenge = isExportApiChallengeResponse(response);
    const retryAfterMs = parseExportApiRetryAfterMs(response.headers.get("retry-after"));
    const durationMs = Date.now() - startedAt;

    if (response.status === 429) {
      const cooldownMs = setConversationApiCooldown(retryAfterMs, "rate-limited");
      record("rate-limited", { status: 429, challenge });
      throw new ExportApiError(
        "RATE_LIMITED",
        `ChatGPT rate limited this request (HTTP 429). Retry in about ${Math.ceil(cooldownMs / 1000)}s.`,
        {
          status: 429,
          fallbackAllowed: false,
          url,
          details: { retryAfterMs: cooldownMs, challenge },
        },
      );
    }

    if ([401, 403].includes(response.status) || challenge) {
      const code = challenge
        ? "ACCESS_CHALLENGE"
        : response.status === 401
          ? "ACCESS_UNAUTHORIZED"
          : "ACCESS_BLOCKED";
      if (!markBlocked && !challenge) {
        record(challenge ? "challenge" : "endpoint-refused", {
          status: response.status,
          challenge,
        });
        throw new ExportApiError(
          code,
          `Conversation endpoint refused this request (HTTP ${response.status}).`,
          {
            status: response.status,
            fallbackAllowed: true,
            url,
            details: {
              challenge,
              endpointRefused: true,
              category,
              durationMs,
              conversationId,
            },
          },
        );
      }
      markConversationAccessBlocked({
        status: response.status,
        challenge,
        conversationId,
        url,
        category,
        durationMs,
      });
      record(challenge ? "challenge" : "blocked", { status: response.status, challenge });
      throw new ExportApiError(
        code,
        `Conversation access blocked (HTTP ${response.status}). Check ChatGPT access and retry later.`,
        { status: response.status, fallbackAllowed: false, url, details: { challenge } },
      );
    }

    if (!response.ok) {
      record("http-error", { status: response.status, challenge });
      const code = response.status === 404 ? "NOT_FOUND" : "HTTP_STATUS";
      /*
       * ChatGPT answers 404 with `conversation_inaccessible` when the request
       * carried no usable credentials, even though the page itself is signed in.
       * That is an authentication problem, not a missing conversation.
       */
      if (response.status === 404) {
        const unauthenticated = await readConversationInaccessibleDetail(response);
        if (unauthenticated) {
          throw new ExportApiError(
            "AUTH_REQUIRED",
            "ChatGPT requires a signed-in session to read this conversation.",
            {
              status: 404,
              fallbackAllowed: true,
              url,
              details: { conversationInaccessible: true, category },
            },
          );
        }
      }
      throw new ExportApiError(code, `Conversation API returned HTTP ${response.status}.`, {
        status: response.status,
        fallbackAllowed: true,
        url,
      });
    }

    try {
      const data = await response.json();
      record("ok", { status: response.status, challenge });
      return {
        data,
        status: response.status,
        url,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      record("invalid-json", { status: response.status, challenge });
      throw new ExportApiError("INVALID_JSON", "Conversation API returned invalid JSON.", {
        status: response.status,
        fallbackAllowed: true,
        url,
        cause: error,
      });
    }
  } catch (error) {
    if (signal?.aborted) {
      record("cancelled");
      throw new ExportApiError("CANCELLED", "Conversation export cancelled.", {
        fallbackAllowed: false,
      });
    }
    if (error?.name === "AbortError") {
      record("timeout");
      throw new ExportApiError("TIMEOUT", "Conversation API request timed out.", {
        fallbackAllowed: true,
        url,
        cause: error,
      });
    }
    if (error instanceof ExportApiError) {
      throw error;
    }
    record("network");
    throw new ExportApiError("NETWORK", error?.message || "Conversation API request failed.", {
      fallbackAllowed: true,
      url,
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
};

const fetchPaginatedConversationById = async (conversationId, options = {}) => {
  const origins = [window.location.origin];
  let lastError = null;

  for (const origin of origins) {
    try {
      const firstResponse = await fetchJsonWithTimeout(
        getPaginatedConversationApiUrl(origin, conversationId),
        {
          timeoutMs: options.timeoutMs,
          signal: options.signal,
          category: "conversation-paginated",
          conversationId,
          markBlocked: false,
        },
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
      // The oldest page decides whether pagination really reached the beginning.
      let lastPageData = firstData;

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
          {
            timeoutMs: options.timeoutMs,
            signal: options.signal,
            category: "conversation-paginated-page",
            conversationId,
            markBlocked: false,
          },
        );
        if (!Array.isArray(pageResponse.data?.messages)) {
          throw new ExportApiError(
            "INVALID_RESPONSE",
            "Paginated conversation message page returned no messages.",
            { status: pageResponse.status, fallbackAllowed: true, url: pageResponse.url },
          );
        }
        messages = mergePaginatedConversationMessages(pageResponse.data.messages, messages);
        lastPageData = pageResponse.data;
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
      const paginationComplete = getConversationPageInfo(lastPageData)?.has_previous_page !== true;
      const data = {
        ...firstData,
        conversation_id: firstData.conversation_id || conversationId,
        current_node: rebuilt.currentNodeId,
        mapping: rebuilt.mapping,
      };
      return {
        data,
        status: firstResponse.status,
        url: firstResponse.url,
        conversationId,
        paginated: true,
        pageCount,
        paginationComplete,
        completeness: assessConversationCompleteness(data, {
          paginated: true,
          paginationComplete,
          pageCount,
          source: "paginated",
        }),
      };
    } catch (error) {
      lastError = normalizeExportApiError(error);
      if (!canFallbackFromExportApiError(lastError)) {
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

  if (isConversationAccessBlocked(normalizedId)) {
    const accessState = getConversationAccessStatus();
    throw new ExportApiError(
      accessState.challenge ? "ACCESS_CHALLENGE" : "ACCESS_BLOCKED",
      "Conversation access is blocked; automatic retries and endpoint switching are stopped.",
      {
        status: accessState.status,
        fallbackAllowed: false,
        details: {
          blocked: true,
          at: accessState.at,
          challenge: accessState.challenge,
          path: accessState.path,
        },
      },
    );
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
    const category = url.includes("include_full_conversation=true")
      ? "conversation-full"
      : "conversation-legacy";
    let authRetried = false;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const response = await fetchJsonWithTimeout(url, {
          timeoutMs: options.timeoutMs,
          signal: options.signal,
          category,
          retry: attempt,
          conversationId: normalizedId,
          markBlocked: false,
        });
        if (!response.data || typeof response.data !== "object") {
          throw new ExportApiError("INVALID_RESPONSE", "Conversation API returned an empty response.", {
            status: response.status,
            fallbackAllowed: true,
            url,
          });
        }
        const completeness = assessConversationCompleteness(response.data, { source: category });
        if (!completeness.chainComplete) {
          throw new ExportApiError(
            "INCOMPLETE_RESPONSE",
            "Conversation API returned only part of the active message path.",
            {
              status: response.status,
              fallbackAllowed: true,
              url,
              details: { completeness },
            },
          );
        }
        return {
          ...response,
          conversationId: normalizedId,
          completeness,
        };
      } catch (error) {
        lastError = normalizeExportApiError(error);
        /*
         * The page is signed in but this request looked anonymous: refresh the
         * bearer token once and retry the same candidate instead of concluding
         * that the conversation is unreadable.
         */
        if (lastError.code === "AUTH_REQUIRED" && !authRetried) {
          authRetried = true;
          try {
            await getExportApiAccessToken({ forceRefresh: true });
          } catch {
            // A cookie-only retry is still worth one attempt.
          }
          attempt -= 1;
          continue;
        }
        if (
          !canFallbackFromExportApiError(lastError) ||
          attempt >= retryCount ||
          !shouldRetryExportApiRequest(lastError)
        ) {
          break;
        }
      }
    }

    if (lastError && !canFallbackFromExportApiError(lastError)) {
      throw lastError;
    }
  }

  throw lastError || new ExportApiError("UNKNOWN", "Conversation API request failed.", {
    fallbackAllowed: true,
  });
};

const fetchConversationByIdCandidatesInternal = async (candidates, options = {}) => {
  if (typeof getCapturedConversationApiResponse === "function") {
    for (const conversationId of candidates) {
      const captured = getCapturedConversationApiResponse([conversationId]);
      if (!captured?.data) {
        continue;
      }
      const completeness = assessConversationCompleteness(captured.data, {
        source: "captured-page-response",
      });
      if (completeness.chainComplete) {
        return {
          ...captured,
          completeness,
        };
      }
    }
  }

  let lastError = null;
  /*
   * Only the plain conversation endpoint is tried first: `include_full_conversation`
   * is refused with 403 on accounts where the plain endpoint answers 200, and a
   * single refused variant must never stop the other variants.
   */
  const phases = [
    { label: "conversation-legacy", options: { legacyOnly: true } },
    { label: "conversation-paginated", paginated: true },
    { label: "conversation-full", options: { fullConversationOnly: true } },
  ];
  const refusals = [];
  let lastNonRefusalError = null;

  for (const conversationId of candidates) {
    for (const phase of phases) {
      try {
        if (phase.paginated) {
          return await fetchPaginatedConversationById(conversationId, options);
        }
        return await fetchConversationById(conversationId, {
          ...options,
          ...phase.options,
        });
      } catch (error) {
        lastError = normalizeExportApiError(error);
        if (lastError.details?.endpointRefused) {
          refusals.push(lastError);
        } else {
          lastNonRefusalError = lastError;
        }
        if (!canFallbackFromExportApiError(lastError)) {
          throw lastError;
        }
      }
    }
  }

  /*
   * Two or more refused endpoints means the whole conversation is closed to this
   * session (a single refused variant only means that variant is unavailable).
   */
  if (refusals.length >= 2) {
    const worst = refusals[refusals.length - 1];
    markConversationAccessBlocked({
      status: worst.status || 0,
      challenge: worst.details?.challenge === true,
      conversationId: worst.details?.conversationId || candidates[0] || "",
      url: worst.url || "",
      category: worst.details?.category || "conversation",
      durationMs: Number(worst.details?.durationMs) || 0,
    });
    throw new ExportApiError(
      worst.details?.challenge ? "ACCESS_CHALLENGE" : "ACCESS_BLOCKED",
      "Conversation access blocked; automatic retries and endpoint switching are stopped.",
      {
        status: worst.status,
        fallbackAllowed: false,
        url: worst.url,
        details: { ...worst.details, blocked: true },
      },
    );
  }

  throw lastNonRefusalError || lastError || new ExportApiError(
    "UNKNOWN",
    "Conversation API request failed.",
    { fallbackAllowed: true },
  );
};

const getConversationRequestKey = (candidates, options = {}) =>
  [
    candidates.join(","),
    options.fullConversationOnly ? "full" : options.legacyOnly ? "legacy" : "any",
    options.timeoutMs ?? EXPORT_API_TIMEOUT_MS,
    options.retries ?? EXPORT_API_RETRY_COUNT,
  ].join("|");

const awaitPromiseWithSignal = (promise, signal) => {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(
      new ExportApiError("CANCELLED", "Conversation export cancelled.", { fallbackAllowed: false }),
    );
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(
        new ExportApiError("CANCELLED", "Conversation export cancelled.", {
          fallbackAllowed: false,
        }),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
};

/* A consumer can detach without interrupting other readers. Once nobody is
 * waiting, abort the underlying fetch and stop pagination too. */
const fetchConversationByIdCandidates = async (conversationIds, options = {}) => {
  if (options.signal?.aborted) throw new ExportApiError("CANCELLED", "Conversation export cancelled.", { fallbackAllowed: false });
  const candidates = getNormalizedConversationIdCandidates(conversationIds);
  if (!candidates.length) {
    throw new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
  }
  const key = getConversationRequestKey(candidates, options);
  let entry = conversationRequestInflight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, consumers: 0, settled: false, promise: null };
    entry.promise = fetchConversationByIdCandidatesInternal(candidates, {
      ...options, signal: controller.signal,
    }).finally(() => {
      entry.settled = true;
      if (conversationRequestInflight.get(key) === entry) conversationRequestInflight.delete(key);
    });
    conversationRequestInflight.set(key, entry);
  }
  entry.consumers += 1;
  try {
    return await awaitPromiseWithSignal(entry.promise, options.signal);
  } finally {
    entry.consumers -= 1;
    if (!entry.consumers && !entry.settled) {
      if (conversationRequestInflight.get(key) === entry) conversationRequestInflight.delete(key);
      entry.controller.abort();
    }
  }
};
