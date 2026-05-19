/*
 * ChatGPT Conversation Toolkit - DOM utilities
 */
const getConversationKey = () => {
  const domConversationId =
    document
      .querySelector("[data-conversation-id]")
      ?.getAttribute("data-conversation-id") ||
    document
      .querySelector("[data-message-id][data-conversation-id]")
      ?.getAttribute("data-conversation-id");
  if (domConversationId) {
    return domConversationId;
  }

  const match = window.location.pathname.match(/\/c\/([^/]+)/);
  if (match) {
    return match[1];
  }
  return `${window.location.pathname}${window.location.search}`;
};

const normalizeStrictConversationId = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const candidate = value.trim().split(/[?#/]/)[0];
  if (!candidate || candidate.length < 6) {
    return null;
  }

  return /^[A-Za-z0-9._~-]+$/.test(candidate) ? candidate : null;
};

const getStrictConversationIdCandidates = () => {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (value) => {
    const normalized = normalizeStrictConversationId(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  document.querySelectorAll("[data-conversation-id]").forEach((node) => {
    addCandidate(node.getAttribute("data-conversation-id"));
  });

  document.querySelectorAll("[data-message-id][data-conversation-id]").forEach((node) => {
    addCandidate(node.getAttribute("data-conversation-id"));
  });

  const urlMatch = window.location.pathname.match(/\/c\/([^/?#]+)/);
  addCandidate(urlMatch?.[1] || "");

  return candidates;
};

const getStrictConversationId = () => {
  const candidates = getStrictConversationIdCandidates();
  return candidates[0] || null;
};

const MESSAGE_TURN_SELECTOR = [
  "section[data-turn][data-turn-id]",
  "[data-turn][data-turn-id]",
  '[data-testid^="conversation-turn-"]',
].join(", ");

const MESSAGE_ROLE_SELECTOR = [
  "[data-message-author-role]",
  '[data-testid="user-message"]',
  '[data-testid="assistant-message"]',
  '[data-testid^="user-message"]',
  '[data-testid^="assistant-message"]',
].join(", ");

const MESSAGE_ROOT_SELECTOR = [
  MESSAGE_TURN_SELECTOR,
  "[data-turn-id-container]",
  "[data-message-id]",
  "article",
  MESSAGE_ROLE_SELECTOR,
].join(", ");

const MESSAGE_CONTENT_SELECTOR = [
  MESSAGE_ROLE_SELECTOR,
  '[data-testid="message-content"]',
  '[data-testid^="message-content"]',
  ".markdown",
  ".whitespace-pre-wrap",
].join(", ");
const MESSAGE_CACHE_LIMIT = 1500;
const MESSAGE_STORE_REFRESH_MIN_INTERVAL_MS = 90;
const COLLAPSED_MESSAGE_ATTR = "data-chatgpt-toolkit-collapsed-message";

const getConversationMain = () =>
  document.querySelector("#thread") ||
  document.querySelector("main#main") ||
  document.querySelector('[data-scroll-root] main') ||
  document.querySelector("main") ||
  document.querySelector('[role="main"]');

const getSidebarHistoryRoot = () =>
  document.querySelector("#history") ||
  document.querySelector('nav[aria-label] #history') ||
  document.querySelector('[id*="history"]');

const isConversationDocumentScrollRoot = (root) =>
  root === document.scrollingElement ||
  root === document.documentElement ||
  root === document.body;

const resolveConversationScrollRoot = () => {
  const main = getConversationMain();
  if (main instanceof HTMLElement) {
    const mainRoot = main.closest("[data-scroll-root]");
    if (mainRoot instanceof HTMLElement) {
      return mainRoot;
    }

    const scopedRoots = Array.from(document.querySelectorAll("[data-scroll-root]")).filter(
      (root) =>
        root instanceof HTMLElement &&
        (root.contains(main) || main.contains(root)),
    );
    const scopedScrollableRoot = scopedRoots.find(
      (root) => root.scrollHeight > root.clientHeight + 24,
    );
    if (scopedScrollableRoot instanceof HTMLElement) {
      return scopedScrollableRoot;
    }
    if (scopedRoots[0] instanceof HTMLElement) {
      return scopedRoots[0];
    }

    let current = main.parentElement;
    while (current instanceof HTMLElement && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style?.overflowY || "";
      if (
        (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
        current.scrollHeight > current.clientHeight + 24
      ) {
        return current;
      }
      current = current.parentElement;
    }
  }

  const explicitScrollableRoot = Array.from(document.querySelectorAll("[data-scroll-root]")).find(
    (root) =>
      root instanceof HTMLElement &&
      root.scrollHeight > root.clientHeight + 24,
  );
  if (explicitScrollableRoot instanceof HTMLElement) {
    return explicitScrollableRoot;
  }

  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
};

const scrollElementIntoConversationView = (element, options = {}) => {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const { behavior = "smooth", block = "center" } = options;
  const scrollRoot = resolveConversationScrollRoot();
  if (!(scrollRoot instanceof HTMLElement) || isConversationDocumentScrollRoot(scrollRoot)) {
    element.scrollIntoView({ behavior, block });
    return;
  }

  const rootRect = scrollRoot.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (!(rootRect.height > 0) || !(elementRect.height >= 0)) {
    element.scrollIntoView({ behavior, block });
    return;
  }

  let top = scrollRoot.scrollTop + (elementRect.top - rootRect.top);
  if (block === "center") {
    top -= Math.max(0, (scrollRoot.clientHeight - elementRect.height) / 2);
  } else if (block === "end") {
    top -= Math.max(0, scrollRoot.clientHeight - elementRect.height);
  } else if (block === "nearest") {
    if (elementRect.top >= rootRect.top && elementRect.bottom <= rootRect.bottom) {
      return;
    }
    top = elementRect.top < rootRect.top
      ? scrollRoot.scrollTop + (elementRect.top - rootRect.top)
      : scrollRoot.scrollTop + (elementRect.bottom - rootRect.bottom);
  }

  const maxTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
  scrollRoot.scrollTo({
    top: Math.min(Math.max(0, top), maxTop),
    behavior,
  });
};

const toUniqueOutermostElements = (elements) => {
  const unique = [];
  elements.forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (unique.some((existing) => existing === element || existing.contains(element))) {
      return;
    }
    for (let index = unique.length - 1; index >= 0; index -= 1) {
      if (element.contains(unique[index])) {
        unique.splice(index, 1);
      }
    }
    unique.push(element);
  });
  return unique;
};

const resetConversationState = () => {
  state.isCollapsed = false;
  state.collapsedNodes = [];
  state.anchorNode = null;
  state.anchorParent = null;
  if (state.messageCache instanceof Map) {
    state.messageCache.clear();
  } else {
    state.messageCache = new Map();
  }
  state.messageCacheRevision += 1;
  state.messageStoreLastRefreshAt = 0;
  state.messageStoreLastConversationKey = "";
  state.searchQuery = '';
  state.searchMatches = [];
  state.currentMatchIndex = -1;

  if (typeof timelineState !== "undefined" && timelineState) {
    timelineState.items = [];
    timelineState.sourceNodes = [];
    timelineState.sourceSignature = "";
    timelineState.totalUserCount = 0;
    timelineState.activeIndex = -1;
    timelineState.hoverIndex = -1;
    timelineState.signature = "";
    timelineState.contentHeight = 0;
    timelineState.rendered = false;
    timelineState.refreshPending = false;
    timelineState.sourceCheckAt = 0;
  }
};

const ensureConversationState = () => {
  const nextKey = getConversationKey();
  const changed = state.conversationKey !== nextKey;
  if (changed) {
    state.conversationKey = nextKey;
    resetConversationState();
  }
  return changed;
};

const normalizeMessageNode = (node) => {
  if (!(node instanceof Element)) {
    return null;
  }
  const nestedTurn = node.matches("[data-turn-id-container]")
    ? node.querySelector(MESSAGE_TURN_SELECTOR)
    : null;
  return (
    node.closest(MESSAGE_TURN_SELECTOR) ||
    nestedTurn ||
    node.closest("article") ||
    node.closest("[data-message-id]") ||
    (node.matches(MESSAGE_ROLE_SELECTOR) ? node : node.closest(MESSAGE_ROLE_SELECTOR)) ||
    node
  );
};

const getNodeConversationId = (node) =>
  node?.getAttribute("data-conversation-id") ||
  node?.dataset?.conversationId ||
  node?.querySelector("[data-conversation-id]")?.getAttribute("data-conversation-id") ||
  null;

const getMessageNodeKey = (node, index) => {
  const turnId =
    node?.getAttribute?.("data-turn-id") ||
    node?.querySelector?.("[data-turn-id]")?.getAttribute("data-turn-id") ||
    node?.getAttribute?.("data-turn-id-container") ||
    node?.querySelector?.("[data-turn-id-container]")?.getAttribute("data-turn-id-container") ||
    "";
  if (turnId) {
    return `turn:${turnId}`;
  }

  const messageId =
    node?.getAttribute?.("data-message-id") ||
    node?.querySelector?.("[data-message-id]")?.getAttribute("data-message-id") ||
    "";
  if (messageId) {
    return `mid:${messageId}`;
  }

  const testId =
    node?.getAttribute?.("data-testid") ||
    node?.querySelector?.('[data-testid^="conversation-turn-"]')?.getAttribute("data-testid") ||
    "";
  if (testId) {
    return `tid:${testId}`;
  }

  return node || `message-${index}`;
};

const getMessageNodeOrder = (node, fallbackIndex = 0) => {
  const candidates = [
    node?.getAttribute?.("data-testid") || "",
    node?.querySelector?.('[data-testid^="conversation-turn-"]')?.getAttribute("data-testid") || "",
  ];

  for (const candidate of candidates) {
    const match = candidate.match(/conversation-turn-(\d+)/i);
    if (match) {
      const order = Number(match[1]);
      if (Number.isFinite(order)) {
        return order;
      }
    }
  }

  return fallbackIndex + 1;
};

const isToolkitCollapsedMessageNode = (node) =>
  node instanceof HTMLElement && node.getAttribute(COLLAPSED_MESSAGE_ATTR) === "1";

const releaseDisconnectedCachedMessageNodes = () => {
  if (!(state.messageCache instanceof Map)) {
    return false;
  }

  let changed = false;
  state.messageCache.forEach((entry) => {
    if (entry?.node instanceof HTMLElement && !entry.node.isConnected) {
      entry.node = null;
      changed = true;
    }
  });

  if (changed) {
    state.messageCacheRevision += 1;
  }

  return changed;
};

const syncMessageCacheFromNodes = (nodes) => {
  if (!Array.isArray(nodes)) {
    return [];
  }
  if (!(state.messageCache instanceof Map)) {
    state.messageCache = new Map();
  }

  let changed = false;
  const now = Date.now();
  const entries = [];
  nodes.forEach((node, index) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    const key = getMessageNodeKey(node, index);
    if (!key) {
      return;
    }

    const text = extractMessageText(node);
    if (!text) {
      return;
    }

    const role = detectRole(node);
    const order = getMessageNodeOrder(node, index);
    const liveNode = node.isConnected ? node : null;
    const previous = state.messageCache.get(key);
    const entry = {
      key,
      role,
      text,
      order,
      node: liveNode,
      lastSeenAt: now,
    };
    entries.push(entry);

    if (
      !previous ||
      previous.role !== role ||
      previous.text !== text ||
      previous.order !== order ||
      previous.node !== liveNode
    ) {
      changed = true;
    }
    state.messageCache.set(key, entry);
  });

  if (state.messageCache.size > MESSAGE_CACHE_LIMIT) {
    const overflow = state.messageCache.size - MESSAGE_CACHE_LIMIT;
    Array.from(state.messageCache.entries())
      .sort((left, right) => (left[1].lastSeenAt || 0) - (right[1].lastSeenAt || 0))
      .slice(0, overflow)
      .forEach(([key]) => {
        state.messageCache.delete(key);
        changed = true;
      });
  }

  if (changed) {
    state.messageCacheRevision += 1;
  }

  return entries;
};

const sortMessageEntries = (entries) =>
  entries.slice().sort((left, right) => {
    const leftOrder = Number.isFinite(left?.order) ? left.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right?.order) ? right.order : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return (left?.lastSeenAt || 0) - (right?.lastSeenAt || 0);
  });

const isLiveMessageEntry = (entry) =>
  entry?.node instanceof HTMLElement && entry.node.isConnected;

const normalizeMessageMode = (mode) =>
  mode === TOOLKIT_MESSAGE_MODE_EXTENDED ? TOOLKIT_MESSAGE_MODE_EXTENDED : TOOLKIT_MESSAGE_MODE_LOADED;

const getLiveCachedMessageEntries = (options = {}) => {
  const { role = "" } = options;
  if (!(state.messageCache instanceof Map)) {
    state.messageCache = new Map();
  }
  releaseDisconnectedCachedMessageNodes();
  return sortMessageEntries(
    Array.from(state.messageCache.values()).filter(
      (entry) => (!role || entry.role === role) && isLiveMessageEntry(entry),
    ),
  );
};

const getConversationMessageEntries = (options = {}) => {
  const {
    role = "",
    mode = TOOLKIT_MESSAGE_MODE,
    refreshDom = true,
    forceRefresh = false,
  } = options;

  if (refreshDom) {
    getMessageNodes({ forceRefresh });
  } else {
    ensureConversationState();
  }

  if (!(state.messageCache instanceof Map)) {
    state.messageCache = new Map();
  }
  releaseDisconnectedCachedMessageNodes();

  const normalizedMode = normalizeMessageMode(mode);
  const includeDetached = normalizedMode === TOOLKIT_MESSAGE_MODE_EXTENDED;
  return sortMessageEntries(
    Array.from(state.messageCache.values()).filter((entry) => {
      if (role && entry.role !== role) {
        return false;
      }
      if (!includeDetached && !isLiveMessageEntry(entry)) {
        return false;
      }
      return true;
    }),
  );
};

const getLoadedMessageEntries = (options = {}) =>
  getConversationMessageEntries({
    ...options,
    mode: TOOLKIT_MESSAGE_MODE_LOADED,
  });

const getMessageStoreStats = () => {
  const entries = getConversationMessageEntries({
    mode: TOOLKIT_MESSAGE_MODE_EXTENDED,
    refreshDom: false,
  });
  const loadedCount = entries.filter((entry) => isLiveMessageEntry(entry)).length;
  return {
    conversationKey: state.conversationKey || "",
    totalCount: entries.length,
    loadedCount,
    detachedCount: Math.max(0, entries.length - loadedCount),
    revision: state.messageCacheRevision || 0,
    mode: normalizeMessageMode(TOOLKIT_MESSAGE_MODE),
    lastRefreshAt: state.messageStoreLastRefreshAt || 0,
  };
};

const getCachedMessageEntries = (options = {}) => {
  const { role = "", mode = TOOLKIT_MESSAGE_MODE, refreshDom = true } = options;
  return getConversationMessageEntries({
    role,
    mode,
    refreshDom,
  });
};

const resolveCachedMessageNode = (entry) => {
  if (entry?.node instanceof HTMLElement && entry.node.isConnected) {
    return entry.node;
  }
  if (entry?.node instanceof HTMLElement) {
    entry.node = null;
    state.messageCacheRevision += 1;
  }

  const key = entry?.key || "";
  if (!key) {
    return null;
  }

  const nodes = getMessageNodes({ forceRefresh: true });
  const liveNode = nodes.find((node, index) => getMessageNodeKey(node, index) === key);
  if (liveNode instanceof HTMLElement) {
    entry.node = liveNode;
    return liveNode;
  }

  return null;
};

const collectMessageNodesFromDom = () => {
  const main = getConversationMain();
  if (!main) {
    return [];
  }

  const candidates = Array.from(main.querySelectorAll(MESSAGE_ROOT_SELECTOR));
  const normalized = candidates
    .map((node) => normalizeMessageNode(node))
    .filter((node) => node instanceof HTMLElement);

  const filteredByConversation = (() => {
    if (!state.conversationKey) {
      return normalized;
    }
    const scoped = normalized.filter((node) => {
      const nodeConversationId = getNodeConversationId(node);
      return !nodeConversationId || nodeConversationId === state.conversationKey;
    });
    return scoped.length > 0 ? scoped : normalized;
  })();

  const uniqueNodes = [];
  const seen = new Set();
  filteredByConversation.forEach((node, index) => {
    const key = getMessageNodeKey(node, index);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    if (detectRole(node) !== "unknown" || extractMessageText(node)) {
      uniqueNodes.push(node);
    }
  });

  return uniqueNodes;
};

const getMessageNodes = (options = {}) => {
  const { forceRefresh = false, syncCache = true } = options;
  ensureConversationState();

  const conversationKey = state.conversationKey || "";
  const now = Date.now();
  const conversationChanged = state.messageStoreLastConversationKey !== conversationKey;
  const shouldThrottle =
    !forceRefresh &&
    !conversationChanged &&
    now - (state.messageStoreLastRefreshAt || 0) < MESSAGE_STORE_REFRESH_MIN_INTERVAL_MS;

  if (shouldThrottle) {
    return getLiveCachedMessageEntries().map((entry) => entry.node).filter(Boolean);
  }

  const uniqueNodes = collectMessageNodesFromDom();
  if (syncCache) {
    syncMessageCacheFromNodes(uniqueNodes);
    state.messageStoreLastRefreshAt = now;
    state.messageStoreLastConversationKey = conversationKey;
  }
  return uniqueNodes;
};

const runDomAdapterHealthCheck = (options = {}) => {
  const { refreshMessages = false } = options;
  ensureConversationState();
  const conversationMain = getConversationMain();
  const sidebarHistory = getSidebarHistoryRoot();
  const messageCount = refreshMessages
    ? getMessageNodes({ forceRefresh: true, syncCache: false }).length
    : getLoadedMessageEntries({ refreshDom: false }).length;

  const issues = [];
  if (!(conversationMain instanceof HTMLElement)) {
    issues.push("conversation-main-missing");
  }
  if (!(sidebarHistory instanceof HTMLElement)) {
    issues.push("sidebar-history-missing");
  }

  const health = {
    ok: issues.length === 0,
    checkedAt: Date.now(),
    conversationMainFound: conversationMain instanceof HTMLElement,
    conversationMessageCount: messageCount,
    sidebarHistoryFound: sidebarHistory instanceof HTMLElement,
    issues,
  };

  const signature = JSON.stringify({
    ok: health.ok,
    conversationMainFound: health.conversationMainFound,
    sidebarHistoryFound: health.sidebarHistoryFound,
    conversationMessageCount: health.conversationMessageCount > 0 ? 1 : 0,
    issues: health.issues,
  });

  state.domAdapterHealth = health;
  state.domAdapterHealthSignature = signature;
  return health;
};

const readRoleFromElement = (element) => {
  if (!(element instanceof Element)) {
    return "";
  }

  const explicitRole =
    element.getAttribute("data-message-author-role") ||
    element.getAttribute("data-turn") ||
    element.getAttribute("data-author-role") ||
    element.dataset?.messageAuthorRole ||
    element.dataset?.turn ||
    "";
  if (explicitRole === "user" || explicitRole === "assistant" || explicitRole === "system") {
    return explicitRole;
  }

  const testId = (element.getAttribute("data-testid") || "").toLowerCase();
  if (testId.includes("user-message") || testId.includes("message-user")) {
    return "user";
  }
  if (testId.includes("assistant-message") || testId.includes("message-assistant")) {
    return "assistant";
  }

  return "";
};

const detectRole = (node) => {
  const directRole = readRoleFromElement(node);
  if (directRole) {
    return directRole;
  }

  const roleNodes = Array.from(node?.querySelectorAll?.(MESSAGE_ROLE_SELECTOR) || []);
  for (const roleNode of roleNodes) {
    const role = readRoleFromElement(roleNode);
    if (role) {
      return role;
    }
  }

  if (node?.querySelector('[data-turn="user"], [data-message-author-role="user"], [data-testid="user-message"], [data-testid^="user-message"]')) {
    return "user";
  }
  if (node?.querySelector('[data-turn="assistant"], [data-message-author-role="assistant"], [data-testid="assistant-message"], [data-testid^="assistant-message"]')) {
    return "assistant";
  }
  if (node?.querySelector('img[alt*="ChatGPT"], svg[aria-label*="ChatGPT"], svg[aria-label*="Assistant"]')) {
    return "assistant";
  }
  if (node?.querySelector('img[alt*="User"], svg[aria-label*="User"]')) {
    return "user";
  }
  return "unknown";
};

const getMessageTextContainers = (node) => {
  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const roleContainers = toUniqueOutermostElements([
    ...(node.matches(MESSAGE_ROLE_SELECTOR) ? [node] : []),
    ...Array.from(node.querySelectorAll(MESSAGE_ROLE_SELECTOR)),
  ]);
  if (roleContainers.length > 0) {
    return roleContainers;
  }

  const contentContainers = toUniqueOutermostElements([
    ...(node.matches(MESSAGE_CONTENT_SELECTOR) ? [node] : []),
    ...Array.from(node.querySelectorAll(MESSAGE_CONTENT_SELECTOR)),
  ]);
  return contentContainers.length > 0 ? contentContainers : [node];
};

const getElementReadableText = (element) => {
  if (!(element instanceof HTMLElement)) {
    return "";
  }
  const clone = element.cloneNode(true);
  clone
    .querySelectorAll(
      [
        "button",
        "script",
        "style",
        "textarea",
        "input",
        "select",
        ".sr-only",
        "[aria-hidden='true']",
        "[role='group']",
        "[data-testid$='turn-action-button']",
        `#${TOOLKIT_ID}`,
        `#${MINIMIZED_ID}`,
        `#${TIMELINE_ID}`,
        `#${PROMPT_MODAL_ID}`,
      ].join(", "),
    )
    .forEach((child) => child.remove());
  return (clone.textContent || "").trim();
};

const extractMessageText = (node) => {
  if (!node) return "";
  return getMessageTextContainers(node)
    .map((container) => getElementReadableText(container))
    .filter((text) => text.length > 0)
    .join("\n\n");
};

const getUserMessageNodes = () =>
  getLoadedMessageEntries({ role: "user" })
    .map((entry) => entry.node)
    .filter((node) => node instanceof HTMLElement);

const isConversationMessageElement = (element) => {
  if (!(element instanceof Element)) {
    return false;
  }
  return Boolean(
    element.matches?.(MESSAGE_ROOT_SELECTOR) ||
    element.closest?.(MESSAGE_ROOT_SELECTOR) ||
    element.querySelector?.(MESSAGE_ROOT_SELECTOR),
  );
};

const buildMessagePayload = (nodes) => {
  const seenIds = new Set();
  return nodes
    .map((node) => {
      const roleNode = node.matches(MESSAGE_ROLE_SELECTOR)
        ? node
        : node.querySelector(MESSAGE_ROLE_SELECTOR) || node;
      const messageId =
        roleNode?.getAttribute("data-message-id") ||
        node.getAttribute("data-message-id") ||
        node.querySelector("[data-message-id]")?.getAttribute("data-message-id");
      if (messageId && seenIds.has(messageId)) {
        return null;
      }
      if (messageId) {
        seenIds.add(messageId);
      }

      const role = detectRole(roleNode);
      const text = extractMessageText(node);

      if (!text) {
        return null;
      }

      return { role, text };
    })
    .filter(Boolean)
    .map((message, index) => ({
      index: index + 1,
      role: message.role,
      text: message.text,
    }));
};

const buildMessagePayloadFromEntries = (entries) =>
  sortMessageEntries(
    (Array.isArray(entries) ? entries : []).filter(
      (entry) => entry && typeof entry.text === "string" && entry.text.trim(),
    ),
  ).map((entry, index) => ({
    index: index + 1,
    role: typeof entry.role === "string" ? entry.role : "unknown",
    text: entry.text,
  }));

const updateStatus = (message, tone = "info") => {
  const status = document.getElementById(STATUS_ID);
  if (!status) {
    return;
  }
  delete status.dataset.i18nKey;
  delete status.dataset.i18nParams;
  status.textContent = message;
  status.dataset.tone = tone;
};

const updateStatusByKey = (key, tone = "info", params = {}) => {
  const status = document.getElementById(STATUS_ID);
  if (!status) {
    return;
  }
  status.dataset.i18nKey = key;
  status.dataset.i18nParams = JSON.stringify(params);
  status.textContent = t(key, params);
  status.dataset.tone = tone;
};

const refreshStatusLocalization = () => {
  const status = document.getElementById(STATUS_ID);
  if (!status) {
    return;
  }

  const key = status.dataset.i18nKey;
  if (!key) {
    return;
  }

  let params = {};
  try {
    params = status.dataset.i18nParams ? JSON.parse(status.dataset.i18nParams) : {};
  } catch (error) {
    params = {};
  }

  status.textContent = t(key, params);
};

const createRafDragController = (applyPosition) => {
  let frameId = 0;
  let pendingPosition = null;

  const flush = () => {
    frameId = 0;
    if (!pendingPosition) {
      return;
    }
    const nextPosition = pendingPosition;
    pendingPosition = null;
    applyPosition(nextPosition);
  };

  return {
    schedule(position) {
      pendingPosition = position;
      if (frameId) {
        return;
      }
      frameId = requestAnimationFrame(flush);
    },
    flush() {
      if (!pendingPosition) {
        return;
      }
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      const nextPosition = pendingPosition;
      pendingPosition = null;
      applyPosition(nextPosition);
    },
    cancel() {
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      pendingPosition = null;
    },
  };
};

const applyDragTransform = (element, translateX, translateY, baseTransform = "") => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  const translate = `translate3d(${Math.round(translateX)}px, ${Math.round(translateY)}px, 0)`;
  element.style.transform =
    baseTransform && baseTransform !== "none"
      ? `${baseTransform} ${translate}`
      : translate;
};

const resetDragTransform = (element, baseTransform = "") => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.style.transform = baseTransform && baseTransform !== "none" ? baseTransform : "";
};
