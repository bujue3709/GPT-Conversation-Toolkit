/*
 * ChatGPT Conversation Toolkit - Page-context conversation capture
 */
(() => {
  const PAGE_FLAG = "__chatgptConversationToolkitCapturePageInstalled";
  const MESSAGE_SOURCE = "chatgpt-toolkit-conversation-capture";
  const MAX_CAPTURE_TEXT_LENGTH = 20 * 1024 * 1024;

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
      const response = await originalFetch.apply(this, args);
      const requestUrl =
        typeof args[0] === "string"
          ? args[0]
          : args[0]?.url || "";
      inspectFetchResponse(requestUrl, response);
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
