/*
 * ChatGPT Conversation Toolkit - Page network capture bridge
 */
(() => {
  const BRIDGE_FLAG = "__chatgptConversationToolkitCaptureBridgeInstalled";
  const CACHE_KEY = "__chatgptConversationToolkitConversationCache";
  const PAGE_SCRIPT_PATH = "features/conversation-capture-page.js";
  const MESSAGE_SOURCE = "chatgpt-toolkit-conversation-capture";
  const MAX_CAPTURED_CONVERSATIONS = 20;

  if (window[BRIDGE_FLAG]) {
    return;
  }
  window[BRIDGE_FLAG] = true;

  const normalizeCapturedConversationId = (value) => {
    if (typeof value !== "string") {
      return "";
    }
    const candidate = value.trim().split(/[?#/]/)[0];
    return /^[A-Za-z0-9._~-]{6,}$/.test(candidate) ? candidate : "";
  };

  const findCapturedConversationPayload = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 3) {
      return null;
    }

    const mapping = value.mapping || value.conversation?.mapping;
    if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
      return value;
    }

    const keys = ["conversation", "data", "payload", "result"];
    for (const key of keys) {
      const payload = findCapturedConversationPayload(value[key], depth + 1);
      if (payload) {
        return payload;
      }
    }

    return null;
  };

  const getCapturedConversationId = (payload, fallbackUrl = "") => {
    const direct =
      payload?.conversation_id ||
      payload?.conversation?.conversation_id ||
      payload?.id ||
      payload?.conversation?.id ||
      "";
    const directId = normalizeCapturedConversationId(direct);
    if (directId) {
      return directId;
    }

    try {
      const matched = new URL(fallbackUrl || window.location.href).pathname.match(/\/c\/([^/?#]+)/);
      return normalizeCapturedConversationId(matched?.[1] || "");
    } catch (error) {
      return "";
    }
  };

  const getConversationCache = () => {
    if (!window[CACHE_KEY]) {
      window[CACHE_KEY] = {
        items: [],
        byId: {},
      };
    }
    return window[CACHE_KEY];
  };

  const rememberCapturedConversation = ({ data, url = "", href = "", capturedAt = Date.now() }) => {
    const payload = findCapturedConversationPayload(data);
    if (!payload) {
      return false;
    }

    const conversationId = getCapturedConversationId(payload, href || url);
    const entry = {
      conversationId,
      data: payload,
      url,
      href: href || window.location.href,
      capturedAt,
    };

    const cache = getConversationCache();
    cache.items = cache.items.filter((item) => {
      if (conversationId && item.conversationId === conversationId) {
        return false;
      }
      return item.url !== url;
    });
    cache.items.unshift(entry);
    cache.items = cache.items.slice(0, MAX_CAPTURED_CONVERSATIONS);

    if (conversationId) {
      cache.byId[conversationId] = entry;
    }

    try {
      window.dispatchEvent(
        new CustomEvent("chatgpt-toolkit-conversation-captured", {
          detail: {
            conversationId,
            url,
            href: entry.href,
            capturedAt,
          },
        }),
      );
    } catch (error) {}

    return true;
  };

  window.getCapturedConversationApiResponse = (conversationIds = []) => {
    const cache = getConversationCache();
    const candidates = Array.isArray(conversationIds) ? conversationIds : [conversationIds];
    for (const candidate of candidates) {
      const conversationId = normalizeCapturedConversationId(candidate);
      if (conversationId && cache.byId[conversationId]) {
        return {
          data: cache.byId[conversationId].data,
          url: cache.byId[conversationId].url,
          status: 200,
          conversationId,
          captured: true,
        };
      }
    }

    const currentPath = window.location.pathname;
    const matchingPath = cache.items.find((entry) => {
      try {
        return new URL(entry.href || entry.url || window.location.href).pathname === currentPath;
      } catch (error) {
        return false;
      }
    });
    const fallback = matchingPath || cache.items[0];
    if (!fallback) {
      return null;
    }

    return {
      data: fallback.data,
      url: fallback.url,
      status: 200,
      conversationId: fallback.conversationId || "",
      captured: true,
    };
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) {
      return;
    }
    if (event.data?.type !== "conversation") {
      return;
    }
    rememberCapturedConversation(event.data);
  });

  const injectPageCaptureScript = () => {
    if (
      typeof chrome === "undefined" ||
      !chrome?.runtime?.getURL ||
      document.getElementById("chatgpt-toolkit-conversation-capture-page")
    ) {
      return;
    }

    const root = document.documentElement || document.head || document.body;
    if (!root) {
      document.addEventListener("DOMContentLoaded", injectPageCaptureScript, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "chatgpt-toolkit-conversation-capture-page";
    script.src = chrome.runtime.getURL(PAGE_SCRIPT_PATH);
    script.async = false;
    script.onload = () => script.remove();
    root.appendChild(script);
  };

  injectPageCaptureScript();
})();
