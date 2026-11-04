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
    const contentType = response?.headers?.get?.("content-type") || "";
    try {
      const parsed = new URL(String(url || ""), window.location.href);
      return parsed.origin === window.location.origin &&
        /^\/backend-api\/conversations?\/[A-Za-z0-9._~-]+(?:\/messages)?$/.test(parsed.pathname) &&
        contentType.toLowerCase().includes("application/json");
    } catch { return false; }
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

  let captureInProgress = false;
  const inspectFetchResponse = async (url, response) => {
    if (captureInProgress || !response || !shouldInspectResponse(url, response)) {
      return;
    }
    if (Number(response.headers.get("content-length")) > MAX_CAPTURE_TEXT_LENGTH) return;
    captureInProgress = true;
    let reader;
    let complete = false;
    try {
      reader = response.clone().body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      const pieces = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) { complete = true; break; }
        bytes += value.byteLength;
        if (bytes > MAX_CAPTURE_TEXT_LENGTH) return;
        pieces.push(decoder.decode(value, { stream: true }));
      }
      pieces.push(decoder.decode());
      const data = parseMaybeJson(pieces.join(""));
      if (data) postConversationData(data, url);
    } catch {} finally {
      // Cancelling a tee branch can wait for the original response consumer.
      // Do not await it or cancel ChatGPT's original response.
      if (reader && !complete) reader.cancel().catch(() => {});
      reader?.releaseLock();
      captureInProgress = false;
    }
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
        if (!shouldInspectResponse(url, { headers: { get: () => this.getResponseHeader("content-type") } })) {
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
