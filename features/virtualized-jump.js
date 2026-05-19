/*
 * ChatGPT Conversation Toolkit - Virtualized conversation jump helper
 */
const VIRTUAL_JUMP_SETTLE_DELAY_MS = 180;
const VIRTUAL_JUMP_MAX_ATTEMPTS = 24;
const VIRTUAL_JUMP_TEXT_NEEDLE_LIMIT = 120;
const VIRTUAL_JUMP_LARGE_STEP_RATIO = 0.85;
const VIRTUAL_JUMP_SMALL_STEP_RATIO = 0.25;
const VIRTUAL_JUMP_STUCK_STEP_RATIO = 1.4;
const VIRTUAL_JUMP_TEXT_MATCH_THRESHOLD = 0.72;
const VIRTUAL_JUMP_BOUNDARY_MUTATION_TIMEOUT_MS = 2500;
const VIRTUAL_JUMP_BOUNDARY_NUDGE_PX = 24;

const normalizeVirtualJumpText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const normalizeVirtualJumpDirection = (direction) =>
  direction === "up" || direction === -1 || direction < 0 ? -1 : 1;

const getVirtualJumpTargetKey = (target) =>
  target?.messageKey ||
  target?.key ||
  target?.sourceMessage?.key ||
  target?.messageId ||
  "";

const getVirtualJumpTargetMessageId = (target) =>
  target?.messageId ||
  target?.sourceMessage?.messageId ||
  target?.id ||
  "";

const getVirtualJumpTargetIndex = (target) => {
  const candidates = [
    target?.messageIndex,
    target?.branchIndex,
    target?.index,
    target?.sourceMessage?.index,
    target?.order,
  ];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
};

const getVirtualJumpTargetUserOrder = (target) => {
  const candidates = [target?.userOrder, target?.sourceMessage?.userOrder, target?.order];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
};

const getVirtualJumpTargetText = (target) =>
  target?.previewText ||
  target?.text ||
  target?.sourceMessage?.previewText ||
  target?.sourceMessage?.text ||
  "";

const getVirtualJumpTargetRole = (target) =>
  target?.role || target?.sourceMessage?.role || "";

const getVirtualJumpConversationIndex = () =>
  typeof getReadyConversationIndex === "function" ? getReadyConversationIndex() : null;

const getVirtualJumpDomText = (node) =>
  node instanceof HTMLElement && typeof extractMessageText === "function"
    ? normalizeVirtualJumpText(extractMessageText(node))
    : "";

const getVirtualJumpDomRole = (node) =>
  node instanceof HTMLElement && typeof detectRole === "function" ? detectRole(node) : "";

const getDomMessageIdCandidates = (node) => {
  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const candidates = [];
  const addCandidate = (value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text && !candidates.includes(text)) {
      candidates.push(text);
    }
  };

  addCandidate(node.getAttribute("data-message-id"));
  addCandidate(node.getAttribute("data-turn-id"));
  addCandidate(node.getAttribute("data-turn-id-container"));
  addCandidate(node.querySelector("[data-message-id]")?.getAttribute("data-message-id"));
  addCandidate(node.querySelector("[data-turn-id]")?.getAttribute("data-turn-id"));
  addCandidate(node.querySelector("[data-turn-id-container]")?.getAttribute("data-turn-id-container"));

  return candidates;
};

const getTextMatchScore = (leftValue, rightValue) => {
  const left = normalizeVirtualJumpText(leftValue).toLowerCase();
  const right = normalizeVirtualJumpText(rightValue).toLowerCase();
  if (!left || !right) {
    return 0;
  }

  const leftNeedle = left.slice(0, VIRTUAL_JUMP_TEXT_NEEDLE_LIMIT);
  const rightNeedle = right.slice(0, VIRTUAL_JUMP_TEXT_NEEDLE_LIMIT);
  if (left.includes(rightNeedle) || right.includes(leftNeedle)) {
    return 1;
  }

  const leftTokens = new Set(leftNeedle.split(/\s+/).filter((token) => token.length > 1));
  const rightTokens = new Set(rightNeedle.split(/\s+/).filter((token) => token.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    const prefixLength = Math.min(leftNeedle.length, rightNeedle.length);
    let same = 0;
    for (let index = 0; index < prefixLength; index += 1) {
      if (leftNeedle[index] === rightNeedle[index]) {
        same += 1;
      }
    }
    return same / Math.max(leftNeedle.length, rightNeedle.length, 1);
  }

  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  });
  return (shared * 2) / (leftTokens.size + rightTokens.size);
};

const findConversationMessageByText = (text, role = "", options = {}) => {
  const conversationIndex = getVirtualJumpConversationIndex();
  const messages = conversationIndex?.messages || [];
  const normalizedText = normalizeVirtualJumpText(text);
  if (!normalizedText || messages.length === 0) {
    return null;
  }

  const preferredIndex = Number.isFinite(options.preferredIndex) ? options.preferredIndex : null;
  let bestMessage = null;
  let bestScore = 0;
  messages.forEach((message) => {
    if (role && message.role !== role) {
      return;
    }

    const score = getTextMatchScore(normalizedText, message.text || message.markdown || "");
    if (score < VIRTUAL_JUMP_TEXT_MATCH_THRESHOLD) {
      return;
    }

    const indexDistance =
      Number.isFinite(preferredIndex) && Number.isFinite(message.index)
        ? Math.abs(message.index - preferredIndex)
        : 0;
    const adjustedScore = score - Math.min(indexDistance / Math.max(messages.length, 1), 0.18);
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestMessage = message;
    }
  });

  return bestMessage;
};

const resolveDomNodeConversationMessage = (node) => {
  const conversationIndex = getVirtualJumpConversationIndex();
  if (!conversationIndex) {
    return null;
  }

  for (const messageId of getDomMessageIdCandidates(node)) {
    const message = conversationIndex.byMessageId?.get(messageId);
    if (message) {
      return message;
    }
  }

  const role = getVirtualJumpDomRole(node);
  const text = getVirtualJumpDomText(node);
  return findConversationMessageByText(text, role);
};

const resolveDomNodeMessageIndex = (node) => {
  const message = resolveDomNodeConversationMessage(node);
  return Number.isFinite(message?.index) ? message.index : null;
};

const getVirtualJumpMessageRoot = (element) => {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  if (typeof normalizeMessageNode === "function") {
    return normalizeMessageNode(element);
  }

  return (
    element.closest("[data-turn][data-turn-id]") ||
    element.closest("[data-turn-id]") ||
    element.closest("[data-message-id]") ||
    element.closest('[data-testid^="conversation-turn-"]') ||
    element.closest("article") ||
    element
  );
};

const queryMessageNodeById = (messageId) => {
  if (!messageId) {
    return null;
  }

  const candidates = Array.from(
    document.querySelectorAll("[data-message-id], [data-turn-id], [data-turn-id-container]"),
  );
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) {
      continue;
    }
    const value =
      candidate.getAttribute("data-message-id") ||
      candidate.getAttribute("data-turn-id") ||
      candidate.getAttribute("data-turn-id-container") ||
      "";
    if (value === messageId) {
      return getVirtualJumpMessageRoot(candidate);
    }
  }

  return null;
};

const findCachedMessageNodeForTarget = (target, options = {}) => {
  if (!(state.messageCache instanceof Map)) {
    return null;
  }

  const messageId = getVirtualJumpTargetMessageId(target);
  const role = getVirtualJumpTargetRole(target);
  const needle = normalizeVirtualJumpText(getVirtualJumpTargetText(target))
    .slice(0, VIRTUAL_JUMP_TEXT_NEEDLE_LIMIT)
    .toLowerCase();

  let weakMatch = null;
  for (const entry of state.messageCache.values()) {
    if (!entry) {
      continue;
    }

    if (
      messageId &&
      typeof resolveCachedMessageNode === "function" &&
      (entry.key === `mid:${messageId}` || entry.key === `turn:${messageId}`)
    ) {
      const node = resolveCachedMessageNode(entry);
      if (node instanceof HTMLElement) {
        return node;
      }
    }

    if (
      !weakMatch &&
      options.allowWeak !== false &&
      needle &&
      (!role || entry.role === role) &&
      normalizeVirtualJumpText(entry.text).toLowerCase().includes(needle)
    ) {
      weakMatch = entry;
    }
  }

  if (weakMatch && typeof resolveCachedMessageNode === "function") {
    return resolveCachedMessageNode(weakMatch);
  }

  return null;
};

const resolveByPreviewText = (target, options = {}) => {
  const targetText = normalizeVirtualJumpText(getVirtualJumpTargetText(target));
  if (!targetText) {
    return null;
  }

  const role = getVirtualJumpTargetRole(target);
  const preferredIndex = getVirtualJumpTargetIndex(target);
  const nodes = typeof getMessageNodes === "function" ? getMessageNodes({ forceRefresh: true }) : [];
  let bestNode = null;
  let bestScore = 0;

  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const nodeRole = getVirtualJumpDomRole(node);
    if (role && nodeRole && nodeRole !== role) {
      return;
    }

    const nodeText = getVirtualJumpDomText(node);
    const score = getTextMatchScore(targetText, nodeText);
    if (score < (options.threshold || VIRTUAL_JUMP_TEXT_MATCH_THRESHOLD)) {
      return;
    }

    const nodeIndex = resolveDomNodeMessageIndex(node);
    const indexDistance =
      Number.isFinite(preferredIndex) && Number.isFinite(nodeIndex)
        ? Math.abs(nodeIndex - preferredIndex)
        : 0;
    const adjustedScore = score - Math.min(indexDistance / 1000, 0.12);
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestNode = node;
    }
  });

  return bestNode;
};

const resolveMessageDomNode = (target, options = {}) => {
  if (target instanceof HTMLElement) {
    return target.isConnected ? target : null;
  }
  if (target?.node instanceof HTMLElement && target.node.isConnected) {
    return target.node;
  }
  if (target?.sourceMessage?.node instanceof HTMLElement && target.sourceMessage.node.isConnected) {
    target.node = target.sourceMessage.node;
    return target.node;
  }

  const messageId = getVirtualJumpTargetMessageId(target);
  const byId = queryMessageNodeById(messageId);
  if (byId instanceof HTMLElement && byId.isConnected) {
    target.node = byId;
    if (target?.sourceMessage) {
      target.sourceMessage.node = byId;
    }
    return byId;
  }

  const cachedNode = findCachedMessageNodeForTarget(target, options);
  if (cachedNode instanceof HTMLElement && cachedNode.isConnected) {
    target.node = cachedNode;
    if (target?.sourceMessage) {
      target.sourceMessage.node = cachedNode;
    }
    return cachedNode;
  }

  if (options.allowWeak === false) {
    return null;
  }

  const weakNode = resolveByPreviewText(target);
  if (weakNode instanceof HTMLElement && weakNode.isConnected) {
    target.node = weakNode;
    if (target?.sourceMessage) {
      target.sourceMessage.node = weakNode;
    }
    return weakNode;
  }

  return null;
};

const getVirtualJumpScrollController = () => {
  const root =
    typeof resolveConversationScrollRoot === "function"
      ? resolveConversationScrollRoot()
      : document.scrollingElement;
  if (!(root instanceof HTMLElement)) {
    return null;
  }

  const documentLike =
    typeof isConversationDocumentScrollRoot === "function" &&
    isConversationDocumentScrollRoot(root);

  const getTop = () =>
    documentLike
      ? window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0
      : root.scrollTop;
  const getHeight = () =>
    documentLike
      ? window.innerHeight || document.documentElement?.clientHeight || root.clientHeight || 1
      : root.clientHeight || 1;
  const getScrollHeight = () =>
    documentLike
      ? Math.max(
          document.documentElement?.scrollHeight || 0,
          document.body?.scrollHeight || 0,
          root.scrollHeight || 0,
        )
      : root.scrollHeight || 0;
  const getMaxTop = () => Math.max(0, getScrollHeight() - getHeight());
  const setTop = (top, behavior = "auto") => {
    const clampedTop = Math.min(Math.max(0, top), getMaxTop());
    if (documentLike) {
      window.scrollTo({ top: clampedTop, behavior });
      return;
    }
    root.scrollTo({ top: clampedTop, behavior });
  };

  return {
    root,
    getTop,
    getHeight,
    getMaxTop,
    setTop,
  };
};

const scrollConversationToVirtualRatio = (ratio, behavior = "auto") => {
  const controller = getVirtualJumpScrollController();
  if (!controller) {
    return false;
  }

  const safeRatio = Math.min(Math.max(Number.isFinite(ratio) ? ratio : 0, 0), 1);
  controller.setTop(controller.getMaxTop() * safeRatio, behavior);
  return true;
};

const scrollConversationByVirtualPage = (direction, scale = VIRTUAL_JUMP_LARGE_STEP_RATIO) => {
  const controller = getVirtualJumpScrollController();
  if (!controller) {
    return false;
  }

  const step = Math.max(160, controller.getHeight() * Math.max(0.1, scale));
  controller.setTop(controller.getTop() + normalizeVirtualJumpDirection(direction) * step, "auto");
  return true;
};

const nudgeVirtualScroll = (direction, pixels = VIRTUAL_JUMP_BOUNDARY_NUDGE_PX) => {
  const controller = getVirtualJumpScrollController();
  if (!controller) {
    return false;
  }

  controller.setTop(controller.getTop() + normalizeVirtualJumpDirection(direction) * Math.max(1, pixels), "auto");
  return true;
};

const getRenderedMessageWindow = () => {
  const nodes = typeof getMessageNodes === "function" ? getMessageNodes({ forceRefresh: true }) : [];

  const messageIndexes = [];
  const userOrders = [];
  const renderedItems = [];
  const seenKeys = new Set();
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement) || !node.isConnected) {
      return;
    }

    const message = resolveDomNodeConversationMessage(node);
    if (!message || !Number.isFinite(message.index)) {
      return;
    }

    const key = message.key || message.messageId || String(message.index);
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    messageIndexes.push(message.index);
    renderedItems.push({
      key,
      node,
      message,
      index: message.index,
      userOrder: message.userOrder,
      role: message.role || "",
    });
    if (message.role === "user" && Number.isFinite(message.userOrder)) {
      userOrders.push(message.userOrder);
    }
  });

  const minIndex = messageIndexes.length ? Math.min(...messageIndexes) : null;
  const maxIndex = messageIndexes.length ? Math.max(...messageIndexes) : null;
  const minUserOrder = userOrders.length ? Math.min(...userOrders) : null;
  const maxUserOrder = userOrders.length ? Math.max(...userOrders) : null;
  const controller = getVirtualJumpScrollController();
  const scrollTop = controller ? Math.round(controller.getTop()) : 0;
  const orderedItems = renderedItems
    .slice()
    .sort((left, right) => {
      const leftIndex = Number.isFinite(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isFinite(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  const messageSignature = `${minIndex || ""}:${maxIndex || ""}:${orderedItems
    .map((item) => item.key)
    .join(",")}`;

  return {
    minIndex,
    maxIndex,
    minMessageIndex: minIndex,
    maxMessageIndex: maxIndex,
    minUserOrder,
    maxUserOrder,
    renderedCount: messageIndexes.length,
    items: orderedItems,
    scrollTop,
    messageSignature,
    signature: `${messageSignature}:${scrollTop}`,
  };
};

const sleepForVirtualJump = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const nextVirtualJumpFrame = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });

const waitForVirtualListSettle = async (delayMs = VIRTUAL_JUMP_SETTLE_DELAY_MS) => {
  await nextVirtualJumpFrame();
  await nextVirtualJumpFrame();
  await sleepForVirtualJump(delayMs);
};

const getVirtualJumpMutationRoot = () => {
  const controller = getVirtualJumpScrollController();
  if (controller?.root instanceof HTMLElement) {
    const documentLike =
      typeof isConversationDocumentScrollRoot === "function" &&
      isConversationDocumentScrollRoot(controller.root);
    if (!documentLike) {
      return controller.root;
    }
  }

  if (typeof getConversationMain === "function") {
    const main = getConversationMain();
    if (main instanceof HTMLElement) {
      return main;
    }
  }

  return document.body instanceof HTMLElement ? document.body : document.documentElement;
};

const waitForMessageWindowMutation = (previousMessageSignature, timeoutMs = VIRTUAL_JUMP_BOUNDARY_MUTATION_TIMEOUT_MS) =>
  new Promise((resolve) => {
    const root = getVirtualJumpMutationRoot();
    if (!(root instanceof HTMLElement)) {
      resolve(false);
      return;
    }

    let finished = false;
    let timeoutId = 0;
    let settleTimer = 0;
    const finish = (changed) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      observer.disconnect();
      resolve(Boolean(changed));
    };

    const checkWindow = (mutationChanged = false) => {
      const nextWindow = getRenderedMessageWindow();
      if (
        mutationChanged ||
        (nextWindow.messageSignature && nextWindow.messageSignature !== previousMessageSignature)
      ) {
        finish(true);
      }
    };

    const observer = new MutationObserver((mutations) => {
      const mutationChanged = mutations.some(
        (mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0,
      );
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(() => checkWindow(mutationChanged), 40);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    timeoutId = setTimeout(() => {
      const nextWindow = getRenderedMessageWindow();
      finish(nextWindow.messageSignature !== previousMessageSignature);
    }, timeoutMs);
  });

const getRenderedBoundaryMessageNode = (direction, renderedWindow = getRenderedMessageWindow()) => {
  const items = Array.isArray(renderedWindow?.items) ? renderedWindow.items : [];
  if (items.length === 0) {
    return null;
  }

  const item = normalizeVirtualJumpDirection(direction) < 0 ? items[0] : items[items.length - 1];
  return item?.node instanceof HTMLElement && item.node.isConnected ? item.node : null;
};

const boundaryProbe = async (direction, options = {}) => {
  const normalizedDirection = normalizeVirtualJumpDirection(direction);
  const beforeWindow = getRenderedMessageWindow();
  const boundaryNode = getRenderedBoundaryMessageNode(normalizedDirection, beforeWindow);
  if (!(boundaryNode instanceof HTMLElement)) {
    return false;
  }

  boundaryNode.scrollIntoView({
    behavior: "auto",
    block: normalizedDirection < 0 ? "start" : "end",
  });
  nudgeVirtualScroll(normalizedDirection);

  const mutated = await waitForMessageWindowMutation(
    beforeWindow.messageSignature,
    options.boundaryTimeoutMs || VIRTUAL_JUMP_BOUNDARY_MUTATION_TIMEOUT_MS,
  );
  await waitForVirtualListSettle(options.settleDelayMs);

  const afterWindow = getRenderedMessageWindow();
  if (afterWindow.messageSignature !== beforeWindow.messageSignature) {
    return true;
  }

  if (!mutated) {
    scrollConversationByVirtualPage(normalizedDirection, VIRTUAL_JUMP_STUCK_STEP_RATIO);
    await waitForVirtualListSettle(options.settleDelayMs);
    return getRenderedMessageWindow().messageSignature !== beforeWindow.messageSignature;
  }

  return mutated;
};

const jumpToConversationMessage = async (target, options = {}) => {
  const token = virtualJumpState.activeToken + 1;
  virtualJumpState.activeToken = token;
  virtualJumpState.targetKey = getVirtualJumpTargetKey(target);
  virtualJumpState.attempts = 0;
  virtualJumpState.lastWindowSignature = "";

  const isActive = () => token === virtualJumpState.activeToken;
  const resolveAndFinish = (node) => {
    if (!isActive() || !(node instanceof HTMLElement) || !node.isConnected) {
      return false;
    }
    if (typeof scrollElementIntoConversationView === "function") {
      scrollElementIntoConversationView(node, {
        behavior: options.behavior || "smooth",
        block: options.block || "center",
      });
    } else {
      node.scrollIntoView({ behavior: options.behavior || "smooth", block: options.block || "center" });
    }
    options.onResolved?.(node);
    return true;
  };

  options.onBeforeJump?.(target);

  const directNode = resolveMessageDomNode(target, { allowWeak: false });
  if (resolveAndFinish(directNode)) {
    return { ok: true, node: directNode, reason: "resolved" };
  }

  const targetIndex = getVirtualJumpTargetIndex(target);
  const readyIndex = getVirtualJumpConversationIndex();
  const totalMessages =
    options.totalMessages ||
    readyIndex?.messages?.length ||
    (Number.isFinite(targetIndex) ? targetIndex : 0);

  if (Number.isFinite(targetIndex) && totalMessages > 1) {
    const ratio = (targetIndex - 1) / Math.max(1, totalMessages - 1);
    if (scrollConversationToVirtualRatio(ratio, "auto")) {
      options.onApproximateScroll?.({ ratio, targetIndex, totalMessages });
      await waitForVirtualListSettle(options.settleDelayMs);
      if (!isActive()) {
        return { ok: false, reason: "cancelled" };
      }
      const resolvedAfterRatio = resolveMessageDomNode(target, { allowWeak: false });
      if (resolveAndFinish(resolvedAfterRatio)) {
        return { ok: true, node: resolvedAfterRatio, reason: "resolved-after-ratio" };
      }
    }
  }

  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts || VIRTUAL_JUMP_MAX_ATTEMPTS));
  let stagnantWindows = 0;
  let lastDirection = Number.isFinite(targetIndex) ? 0 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!isActive()) {
      return { ok: false, reason: "cancelled" };
    }

    virtualJumpState.attempts = attempt;
    const resolvedAtAttemptStart = resolveMessageDomNode(target, { allowWeak: false });
    if (resolveAndFinish(resolvedAtAttemptStart)) {
      return { ok: true, node: resolvedAtAttemptStart, reason: "resolved-before-probe" };
    }

    const renderedWindow = getRenderedMessageWindow();
    options.onProgress?.({ attempt, renderedWindow });

    if (renderedWindow.signature === virtualJumpState.lastWindowSignature) {
      stagnantWindows += 1;
    } else {
      stagnantWindows = 0;
      virtualJumpState.lastWindowSignature = renderedWindow.signature;
    }

    let direction = 0;
    let targetInsideRenderedWindow = false;
    if (
      Number.isFinite(targetIndex) &&
      Number.isFinite(renderedWindow.minIndex) &&
      Number.isFinite(renderedWindow.maxIndex)
    ) {
      if (targetIndex < renderedWindow.minIndex) {
        direction = -1;
      } else if (targetIndex > renderedWindow.maxIndex) {
        direction = 1;
      } else {
        targetInsideRenderedWindow = true;
        const weakNode = resolveByPreviewText(target, { threshold: 0.62 });
        if (resolveAndFinish(weakNode)) {
          return { ok: true, node: weakNode, reason: "resolved-by-preview" };
        }
      }
    }

    if (direction === 0) {
      const userOrder = getVirtualJumpTargetUserOrder(target);
      if (
        Number.isFinite(userOrder) &&
        Number.isFinite(renderedWindow.minUserOrder) &&
        Number.isFinite(renderedWindow.maxUserOrder)
      ) {
        if (userOrder < renderedWindow.minUserOrder) {
          direction = -1;
        } else if (userOrder > renderedWindow.maxUserOrder) {
          direction = 1;
        }
      }
    }

    if (direction === 0) {
      direction = targetInsideRenderedWindow
        ? (attempt % 2 === 0 ? -1 : 1)
        : lastDirection || (attempt % 2 === 0 ? -1 : 1);
    }

    let stepScale = VIRTUAL_JUMP_LARGE_STEP_RATIO;
    if (
      Number.isFinite(targetIndex) &&
      Number.isFinite(renderedWindow.minIndex) &&
      Number.isFinite(renderedWindow.maxIndex) &&
      targetIndex >= renderedWindow.minIndex - 3 &&
      targetIndex <= renderedWindow.maxIndex + 3
    ) {
      stepScale = VIRTUAL_JUMP_SMALL_STEP_RATIO;
    }

    if (stagnantWindows === 1) {
      stepScale = VIRTUAL_JUMP_STUCK_STEP_RATIO;
    } else if (stagnantWindows === 2) {
      direction = -direction;
      stepScale = VIRTUAL_JUMP_SMALL_STEP_RATIO;
    } else if (stagnantWindows >= 3) {
      stepScale = VIRTUAL_JUMP_STUCK_STEP_RATIO;
    }

    lastDirection = direction;
    const shouldProbeBoundary = stagnantWindows > 0 || (attempt > 3 && attempt % 4 === 0);
    if (shouldProbeBoundary) {
      options.onBoundaryProbe?.({ attempt, direction, renderedWindow });
      const boundaryMoved = await boundaryProbe(direction, {
        settleDelayMs: options.settleDelayMs,
        boundaryTimeoutMs: options.boundaryTimeoutMs,
      });
      if (!isActive()) {
        return { ok: false, reason: "cancelled" };
      }
      const resolvedAfterBoundary = resolveMessageDomNode(target, { allowWeak: false });
      if (resolveAndFinish(resolvedAfterBoundary)) {
        return { ok: true, node: resolvedAfterBoundary, reason: "resolved-after-boundary" };
      }
      if (boundaryMoved) {
        const nextWindow = getRenderedMessageWindow();
        virtualJumpState.lastWindowSignature = nextWindow.signature;
        stagnantWindows = 0;
        continue;
      }
    }

    scrollConversationByVirtualPage(direction, stepScale);
    await waitForVirtualListSettle(options.settleDelayMs);
    const resolvedNode = resolveMessageDomNode(target, { allowWeak: false });
    if (resolveAndFinish(resolvedNode)) {
      return { ok: true, node: resolvedNode, reason: "resolved-after-probe" };
    }
  }

  if (isActive()) {
    options.onFailed?.({ reason: "not-rendered", target });
  }
  return { ok: false, reason: "not-rendered" };
};
