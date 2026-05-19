/*
 * ChatGPT Conversation Toolkit - Content-script virtualizer bridge
 */
const VIRTUALIZER_BRIDGE_CONTENT_SOURCE = "CGPT_TOOLKIT";
const VIRTUALIZER_BRIDGE_PAGE_SOURCE = "CGPT_TOOLKIT_PAGE";
const VIRTUALIZER_BRIDGE_REQUEST_TYPE = "VIRTUALIZER_SCROLL_TO_INDEX";
const VIRTUALIZER_BRIDGE_RESULT_TYPE = "VIRTUALIZER_SCROLL_TO_INDEX_RESULT";
const VIRTUALIZER_BRIDGE_TIMEOUT_MS = 1200;

const virtualizerBridgeState = {
  injected: false,
  injectPromise: null,
  listenerBound: false,
  requestSeq: 0,
  pending: new Map(),
};

const handleVirtualizerBridgeMessage = (event) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data;
  if (!data || data.source !== VIRTUALIZER_BRIDGE_PAGE_SOURCE) {
    return;
  }

  if (data.type === VIRTUALIZER_BRIDGE_RESULT_TYPE) {
    const request = virtualizerBridgeState.pending.get(data.requestId);
    if (!request) {
      return;
    }

    clearTimeout(request.timeoutId);
    virtualizerBridgeState.pending.delete(data.requestId);
    request.resolve({
      ok: Boolean(data.ok),
      method: data.method || "",
      attemptedIndex: Number.isFinite(data.attemptedIndex) ? data.attemptedIndex : null,
      reason: data.reason || "",
    });
    return;
  }
};

const bindVirtualizerBridgeListener = () => {
  if (virtualizerBridgeState.listenerBound) {
    return;
  }
  window.addEventListener("message", handleVirtualizerBridgeMessage);
  virtualizerBridgeState.listenerBound = true;
};

const injectVirtualizerBridgePageScript = () =>
  new Promise((resolve) => {
    if (virtualizerBridgeState.injected) {
      resolve(true);
      return;
    }

    if (
      typeof chrome === "undefined" ||
      !chrome.runtime?.getURL ||
      !(document.documentElement instanceof HTMLElement)
    ) {
      resolve(false);
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("features/virtualizer-bridge-page.js");
    script.onload = () => {
      virtualizerBridgeState.injected = true;
      script.remove();
      resolve(true);
    };
    script.onerror = () => {
      script.remove();
      resolve(false);
    };
    (document.head || document.documentElement).appendChild(script);
  });

const initVirtualizerBridge = () => {
  bindVirtualizerBridgeListener();
  if (!virtualizerBridgeState.injectPromise) {
    virtualizerBridgeState.injectPromise = injectVirtualizerBridgePageScript();
  }
  return virtualizerBridgeState.injectPromise;
};

const normalizeVirtualizerIndexCandidates = (candidates) => {
  const rawCandidates = Array.isArray(candidates) ? candidates : [candidates];
  const normalized = [];
  rawCandidates.forEach((candidate) => {
    const numberValue = Number(candidate);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
      return;
    }
    const index = Math.trunc(numberValue);
    if (!normalized.includes(index)) {
      normalized.push(index);
    }
  });
  return normalized;
};

const requestVirtualizerScrollToIndex = async (candidates, options = {}) => {
  const normalizedCandidates = normalizeVirtualizerIndexCandidates(candidates);
  if (normalizedCandidates.length === 0) {
    return { ok: false, reason: "invalid_index" };
  }

  const injected = await initVirtualizerBridge();
  if (!injected) {
    return { ok: false, reason: "bridge_injection_failed" };
  }

  const requestId = `virtualizer:${Date.now()}:${virtualizerBridgeState.requestSeq + 1}`;
  virtualizerBridgeState.requestSeq += 1;

  return new Promise((resolve) => {
    const timeoutMs = Math.max(100, Math.trunc(options.timeoutMs || VIRTUALIZER_BRIDGE_TIMEOUT_MS));
    const timeoutId = setTimeout(() => {
      virtualizerBridgeState.pending.delete(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);

    virtualizerBridgeState.pending.set(requestId, {
      timeoutId,
      resolve,
    });

    window.postMessage(
      {
        source: VIRTUALIZER_BRIDGE_CONTENT_SOURCE,
        type: VIRTUALIZER_BRIDGE_REQUEST_TYPE,
        requestId,
        index: normalizedCandidates[0],
        candidates: normalizedCandidates,
        options: {
          ...options,
          align: options.align || "center",
          behavior: "auto",
        },
      },
      "*",
    );
  });
};
