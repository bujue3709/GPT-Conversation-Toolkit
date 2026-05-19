/*
 * ChatGPT Conversation Toolkit - Page-world virtualizer bridge
 */
(() => {
  if (window.__CGPT_TOOLKIT_VIRTUALIZER_PAGE_BRIDGE__) {
    return;
  }
  window.__CGPT_TOOLKIT_VIRTUALIZER_PAGE_BRIDGE__ = true;

  const CONTENT_SOURCE = "CGPT_TOOLKIT";
  const PAGE_SOURCE = "CGPT_TOOLKIT_PAGE";
  const REQUEST_TYPE = "VIRTUALIZER_SCROLL_TO_INDEX";
  const RESULT_TYPE = "VIRTUALIZER_SCROLL_TO_INDEX_RESULT";
  const CACHE_TTL_MS = 5000;
  const MAX_SCAN_OBJECTS = 4200;
  const MAX_SCAN_DEPTH = 8;
  const MAX_GENERIC_KEYS_PER_OBJECT = 90;

  const REACT_PROPERTY_PREFIXES = [
    "__reactFiber$",
    "__reactProps$",
    "__reactContainer$",
    "__reactInternalInstance$",
  ];

  const PRIORITY_FIELDS = [
    "stateNode",
    "memoizedProps",
    "memoizedState",
    "ref",
    "updateQueue",
    "return",
    "child",
    "sibling",
    "alternate",
    "dependencies",
  ];

  const VIRTUALIZER_HINTS = [
    "scrollToIndex",
    "scrollToItem",
    "scrollToOffset",
    "getVirtualItems",
    "getTotalSize",
    "measureElement",
    "followOutput",
    "rangeChanged",
    "firstItemIndex",
    "atBottom",
  ];

  const START_SELECTOR = [
    "#thread",
    "main",
    "[data-scroll-root]",
    "section[data-turn]",
    '[data-testid^="conversation-turn-"]',
  ].join(", ");

  let cachedVirtualizerApi = null;
  let cachedAt = 0;

  const isObjectLike = (value) =>
    (typeof value === "object" || typeof value === "function") && value !== null;

  const safeGet = (object, key) => {
    try {
      return object?.[key];
    } catch (error) {
      return undefined;
    }
  };

  const hasOwnFunction = (object, key) => typeof safeGet(object, key) === "function";

  const hasHint = (object) =>
    VIRTUALIZER_HINTS.some((key) => {
      const value = safeGet(object, key);
      return typeof value === "function" || typeof value === "boolean" || Number.isFinite(value);
    });

  const getPreferredMethod = (object) => {
    if (hasOwnFunction(object, "scrollToIndex")) {
      return "scrollToIndex";
    }
    if (hasOwnFunction(object, "scrollToItem")) {
      return "scrollToItem";
    }
    if (hasOwnFunction(object, "scrollToOffset")) {
      return "scrollToOffset";
    }
    return "";
  };

  const getVirtualizerScore = (object) => {
    const method = getPreferredMethod(object);
    if (!method) {
      return 0;
    }

    const methodScore =
      method === "scrollToIndex" ? 300 : method === "scrollToItem" ? 200 : 100;
    const hintScore = VIRTUALIZER_HINTS.reduce((score, key) => {
      const value = safeGet(object, key);
      return score + (typeof value === "function" || value !== undefined ? 1 : 0);
    }, 0);

    return methodScore + hintScore;
  };

  const getOwnKeys = (object) => {
    try {
      return [
        ...Object.getOwnPropertyNames(object),
        ...Object.getOwnPropertySymbols(object),
      ];
    } catch (error) {
      return [];
    }
  };

  const isReactPropertyKey = (key) =>
    typeof key === "string" && REACT_PROPERTY_PREFIXES.some((prefix) => key.startsWith(prefix));

  const getReactObjectsFromElement = (element) => {
    if (!(element instanceof Element)) {
      return [];
    }

    return getOwnKeys(element)
      .filter(isReactPropertyKey)
      .map((key) => safeGet(element, key))
      .filter(isObjectLike);
  };

  const collectStartObjects = () => {
    const starts = [];
    const seenElements = new Set();

    const addElement = (element) => {
      if (!(element instanceof Element) || seenElements.has(element)) {
        return;
      }
      seenElements.add(element);
      getReactObjectsFromElement(element).forEach((value) => starts.push(value));
    };

    document.querySelectorAll(START_SELECTOR).forEach((element) => {
      addElement(element);
      let parent = element.parentElement;
      let depth = 0;
      while (parent instanceof Element && depth < 4) {
        addElement(parent);
        parent = parent.parentElement;
        depth += 1;
      }
    });

    addElement(document.documentElement);
    addElement(document.body);
    return starts;
  };

  const shouldSkipGenericKey = (key) => {
    const text = typeof key === "symbol" ? key.description || "" : String(key);
    return (
      text === "__proto__" ||
      text === "constructor" ||
      text === "prototype" ||
      text === "ownerDocument" ||
      text === "parentNode" ||
      text === "children" ||
      text === "childNodes" ||
      text === "firstChild" ||
      text === "lastChild" ||
      text === "nextSibling" ||
      text === "previousSibling" ||
      text === "style" ||
      text === "classList"
    );
  };

  const isRelevantKey = (key) => {
    const text = (typeof key === "symbol" ? key.description || "" : String(key)).toLowerCase();
    return (
      text.includes("virtual") ||
      text.includes("scroll") ||
      text.includes("list") ||
      text.includes("range") ||
      text.includes("index") ||
      text.includes("item") ||
      text.includes("ref") ||
      text.includes("state") ||
      text.includes("props")
    );
  };

  const enqueueObject = (queue, value, depth) => {
    if (isObjectLike(value) && depth <= MAX_SCAN_DEPTH) {
      queue.push({ value, depth });
    }
  };

  const scanObjectGraph = (starts) => {
    const seen = new WeakSet();
    const queue = [];
    let best = null;
    let bestScore = 0;
    let scanned = 0;

    starts.forEach((value) => enqueueObject(queue, value, 0));

    while (queue.length > 0 && scanned < MAX_SCAN_OBJECTS) {
      const { value, depth } = queue.shift();
      if (!isObjectLike(value) || seen.has(value)) {
        continue;
      }
      seen.add(value);
      scanned += 1;

      const score = getVirtualizerScore(value);
      if (score > bestScore) {
        bestScore = score;
        best = {
          api: value,
          method: getPreferredMethod(value),
          score,
        };
        if (best.method === "scrollToIndex" && score >= 305) {
          break;
        }
      }

      if (depth >= MAX_SCAN_DEPTH) {
        continue;
      }

      PRIORITY_FIELDS.forEach((key) => {
        const child = safeGet(value, key);
        enqueueObject(queue, child, depth + 1);
        if (key === "ref") {
          enqueueObject(queue, safeGet(child, "current"), depth + 1);
        }
      });

      const keys = getOwnKeys(value).slice(0, MAX_GENERIC_KEYS_PER_OBJECT);
      keys.forEach((key) => {
        if (shouldSkipGenericKey(key)) {
          return;
        }
        const child = safeGet(value, key);
        if (!isObjectLike(child)) {
          return;
        }
        if (depth <= 2 || isRelevantKey(key) || hasHint(child)) {
          enqueueObject(queue, child, depth + 1);
        }
      });
    }

    return best;
  };

  const clearCachedVirtualizerApi = () => {
    cachedVirtualizerApi = null;
    cachedAt = 0;
  };

  const findVirtualizerApi = () => {
    const now = Date.now();
    if (cachedVirtualizerApi && now - cachedAt < CACHE_TTL_MS) {
      return cachedVirtualizerApi;
    }

    const starts = collectStartObjects();
    const found = scanObjectGraph(starts);
    cachedVirtualizerApi = found || null;
    cachedAt = found ? now : 0;
    return cachedVirtualizerApi;
  };

  const normalizeOptions = (options = {}) => ({
    align: options.align || "center",
    behavior: "auto",
  });

  const tryCall = async (callback) => {
    const result = callback();
    if (result && typeof result.then === "function") {
      await result;
    }
  };

  const callScrollToIndex = async (api, index, options) => {
    const method = safeGet(api, "scrollToIndex");
    await tryCall(() => method.call(api, { index, ...options }));
    return { ok: true, method: "scrollToIndex", attemptedIndex: index };
  };

  const callScrollToIndexFallbacks = async (api, index, options) => {
    const method = safeGet(api, "scrollToIndex");
    const attempts = [
      () => method.call(api, { index, ...options }),
      () => method.call(api, index, options),
      () => method.call(api, index),
    ];
    let lastError = null;

    for (const attempt of attempts) {
      try {
        await tryCall(attempt);
        return { ok: true, method: "scrollToIndex", attemptedIndex: index };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("scrollToIndex_failed");
  };

  const callScrollToItem = async (api, index) => {
    const method = safeGet(api, "scrollToItem");
    const attempts = [
      () => method.call(api, index, "center"),
      () => method.call(api, index),
    ];
    let lastError = null;

    for (const attempt of attempts) {
      try {
        await tryCall(attempt);
        return { ok: true, method: "scrollToItem", attemptedIndex: index };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("scrollToItem_failed");
  };

  const callScrollToOffset = async (api, offset) => {
    const method = safeGet(api, "scrollToOffset");
    await tryCall(() => method.call(api, offset));
    return { ok: true, method: "scrollToOffset", attemptedIndex: null };
  };

  const callVirtualizerApi = async (apiInfo, index, options) => {
    const api = apiInfo?.api;
    if (!api) {
      return { ok: false, reason: "virtualizer_api_not_found" };
    }

    if (hasOwnFunction(api, "scrollToIndex")) {
      try {
        return await callScrollToIndex(api, index, options);
      } catch (error) {
        return callScrollToIndexFallbacks(api, index, options);
      }
    }
    if (hasOwnFunction(api, "scrollToItem")) {
      return callScrollToItem(api, index);
    }
    if (hasOwnFunction(api, "scrollToOffset") && Number.isFinite(options.offset)) {
      return callScrollToOffset(api, options.offset);
    }

    return { ok: false, reason: "virtualizer_api_not_found" };
  };

  const normalizeCandidates = (data) => {
    const rawCandidates = Array.isArray(data?.candidates) ? data.candidates : [data?.index];
    const candidates = [];
    rawCandidates.forEach((candidate) => {
      const numberValue = Number(candidate);
      if (!Number.isFinite(numberValue) || numberValue < 0) {
        return;
      }
      const index = Math.trunc(numberValue);
      if (!candidates.includes(index)) {
        candidates.push(index);
      }
    });
    return candidates;
  };

  const postResult = (requestId, result) => {
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: RESULT_TYPE,
        requestId,
        ok: Boolean(result?.ok),
        method: result?.method || "",
        attemptedIndex: Number.isFinite(result?.attemptedIndex) ? result.attemptedIndex : null,
        reason: result?.reason || "",
      },
      "*",
    );
  };

  window.addEventListener("message", async (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== CONTENT_SOURCE || data.type !== REQUEST_TYPE) {
      return;
    }

    const requestId = data.requestId || "";
    const candidates = normalizeCandidates(data);
    if (!requestId || candidates.length === 0) {
      postResult(requestId, { ok: false, reason: "invalid_index" });
      return;
    }

    let apiInfo = findVirtualizerApi();
    if (!apiInfo) {
      postResult(requestId, { ok: false, reason: "virtualizer_api_not_found" });
      return;
    }

    const options = normalizeOptions(data.options || {});
    let lastReason = "";
    for (const index of candidates) {
      try {
        const result = await callVirtualizerApi(apiInfo, index, options);
        if (result.ok) {
          postResult(requestId, result);
          return;
        }
        lastReason = result.reason || "call_failed";
      } catch (error) {
        lastReason = error?.message || "call_failed";
        clearCachedVirtualizerApi();
        apiInfo = findVirtualizerApi();
        if (!apiInfo) {
          break;
        }
      }
    }

    postResult(requestId, {
      ok: false,
      reason: lastReason || "virtualizer_scroll_failed",
    });
  });
})();
