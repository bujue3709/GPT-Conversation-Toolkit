/*
 * ChatGPT Conversation Toolkit - Page-context conversation capture
 */
(() => {
  const PAGE_FLAG = "__chatgptConversationToolkitCapturePageInstalled";
  const MESSAGE_SOURCE = "chatgpt-toolkit-conversation-capture";
  const MAX_CAPTURE_TEXT_LENGTH = 20 * 1024 * 1024;
  const MAX_REQUEST_TEXT_LENGTH = 256 * 1024;

  if (window[PAGE_FLAG]) {
    return;
  }
  window[PAGE_FLAG] = true;

  const hasConversationMapping = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 3) {
      return false;
    }
    const mapping = value.mapping || value.conversation?.mapping;
    if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
      return true;
    }
    return ["conversation", "data", "payload", "result"].some((key) =>
      hasConversationMapping(value[key], depth + 1),
    );
  };

  const shouldInspectResponse = (url, response) => {
    const textUrl = String(url || "");
    if (
      textUrl.includes("/backend-api/") ||
      textUrl.includes("/conversation") ||
      textUrl.includes("conversation")
    ) {
      return true;
    }

    const contentType = response?.headers?.get?.("content-type") || "";
    return contentType.includes("application/json");
  };

  const parseMaybeJson = (text) => {
    if (!text || text.length > MAX_CAPTURE_TEXT_LENGTH) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  };

  const hashString = (value) => {
    const text = String(value || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
  };

  const normalizeRequestUrl = (input) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input?.url || "";
      return new URL(url, window.location.href);
    } catch (error) {
      return null;
    }
  };

  const isConversationSendUrl = (url) =>
    Boolean(url && url.pathname.includes("/backend-api/conversation"));

  const getFetchMethod = (input, init) =>
    String(init?.method || input?.method || "GET").toUpperCase();

  const extractQuotaRequestBodyText = async (input, init) => {
    const body = init?.body;
    if (typeof body === "string") {
      return body.length <= MAX_REQUEST_TEXT_LENGTH ? body : "";
    }
    if (body instanceof URLSearchParams) {
      const text = body.toString();
      return text.length <= MAX_REQUEST_TEXT_LENGTH ? text : "";
    }
    if (body instanceof FormData) {
      return "";
    }
    if (input instanceof Request && typeof input.clone === "function") {
      try {
        const text = await input.clone().text();
        return text.length <= MAX_REQUEST_TEXT_LENGTH ? text : "";
      } catch (error) {
        return "";
      }
    }
    return "";
  };

  const findQuotaUserMessage = (data) => {
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    return (
      messages.find((message) => {
        const role =
          message?.author?.role ||
          message?.message?.author?.role ||
          message?.role ||
          "";
        return role === "user";
      }) || null
    );
  };

  const buildQuotaSendEvent = async (input, init) => {
    const url = normalizeRequestUrl(input);
    if (!isConversationSendUrl(url) || getFetchMethod(input, init) !== "POST") {
      return null;
    }

    const bodyText = await extractQuotaRequestBodyText(input, init);
    const data = parseMaybeJson(bodyText);
    if (!data || typeof data !== "object") {
      return null;
    }

    const userMessage = findQuotaUserMessage(data);
    if (!userMessage) {
      return null;
    }

    const conversationId =
      data.conversation_id ||
      data.conversationId ||
      "";
    const parentMessageId =
      data.parent_message_id ||
      data.parentMessageId ||
      "";
    const messageId =
      userMessage.id ||
      userMessage.message?.id ||
      "";
    const modelKey =
      data.model ||
      data.model_slug ||
      data.modelSlug ||
      data.conversation_mode?.kind ||
      "default";
    const dedupeKey =
      messageId ||
      [conversationId, parentMessageId, hashString(bodyText)].filter(Boolean).join(":") ||
      `${url.pathname}:${hashString(bodyText)}:${Date.now()}`;

    return {
      source: MESSAGE_SOURCE,
      type: "quota-message-sent",
      url: url.href,
      href: window.location.href,
      conversationId,
      messageId,
      parentMessageId,
      modelKey: String(modelKey || "default"),
      dedupeKey: String(dedupeKey),
      sentAt: Date.now(),
    };
  };

  const postQuotaSendEvent = (eventData) => {
    if (!eventData) {
      return;
    }
    window.postMessage(eventData, window.location.origin);
  };

  const postConversationData = (data, url) => {
    if (!hasConversationMapping(data)) {
      return;
    }

    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "conversation",
        data,
        url: String(url || ""),
        href: window.location.href,
        capturedAt: Date.now(),
      },
      window.location.origin,
    );
  };

  const inspectFetchResponse = (url, response) => {
    if (!response || !shouldInspectResponse(url, response)) {
      return;
    }

    response
      .clone()
      .text()
      .then((text) => {
        const data = parseMaybeJson(text);
        if (data) {
          postConversationData(data, url);
        }
      })
      .catch(() => {});
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function patchedFetch(...args) {
      const quotaEventPromise = buildQuotaSendEvent(args[0], args[1]).catch(() => null);
      const response = await originalFetch.apply(this, args);
      const requestUrl =
        typeof args[0] === "string"
          ? args[0]
          : args[0]?.url || "";
      inspectFetchResponse(requestUrl, response);
      quotaEventPromise
        .then((quotaEvent) => {
          if (quotaEvent && response && response.status < 400) {
            postQuotaSendEvent(quotaEvent);
          }
        })
        .catch(() => {});
      return response;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (typeof OriginalXHR === "function") {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__chatgptToolkitCaptureUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    OriginalXHR.prototype.send = function patchedSend(...args) {
      this.addEventListener("loadend", () => {
        const url = this.__chatgptToolkitCaptureUrl || "";
        if (!String(url).includes("conversation") && !String(url).includes("/backend-api/")) {
          return;
        }
        if (this.responseType && this.responseType !== "text" && this.responseType !== "json") {
          return;
        }

        const data =
          this.responseType === "json"
            ? this.response
            : parseMaybeJson(this.responseText || "");
        if (data) {
          postConversationData(data, url);
        }
      });
      return originalSend.apply(this, args);
    };
  }
})();
