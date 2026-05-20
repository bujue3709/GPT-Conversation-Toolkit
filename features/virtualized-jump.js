/*
 * ChatGPT Conversation Toolkit - Virtualized conversation jump helper
 */
const VIRTUAL_JUMP_SETTLE_DELAY_MS = 240;
const VIRTUAL_JUMP_MAX_ATTEMPTS = 24;
const VIRTUAL_JUMP_RETRY_DELAY_MS = 800;
const VIRTUAL_JUMP_MIN_RETRY_DELAY_MS = 600;
const VIRTUAL_JUMP_MAX_RETRY_DELAY_MS = 1000;
const VIRTUAL_JUMP_TEXT_NEEDLE_LIMIT = 120;
const VIRTUAL_JUMP_LARGE_STEP_RATIO = 0.85;
const VIRTUAL_JUMP_SMALL_STEP_RATIO = 0.25;
const VIRTUAL_JUMP_STUCK_STEP_RATIO = 1.4;
const VIRTUAL_JUMP_TEXT_MATCH_THRESHOLD = 0.72;
const VIRTUAL_JUMP_BOUNDARY_MUTATION_TIMEOUT_MS = 2500;
const VIRTUAL_JUMP_BOUNDARY_NUDGE_PX = 24;
const VIRTUALIZER_CALIBRATION_TTL_MS = 5000;
const VIRTUAL_JUMP_NATIVE_SCROLL_ENABLED = false;

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
    target?.index,
    target?.branchIndex,
    target?.sourceMessage?.index,
    target?.sourceMessage?.messageIndex,
    target?.sourceMessage?.branchIndex,
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

const normalizeJumpTarget = (target) => {
  if (target instanceof HTMLElement) {
    return target;
  }

  const sourceMessage = target?.sourceMessage || null;
  const messageIndex = getVirtualJumpTargetIndex(target);
  const messageId = getVirtualJumpTargetMessageId(target);
  const text = getVirtualJumpTargetText(target);
  const role = getVirtualJumpTargetRole(target);

  return {
    ...(target || {}),
    messageId,
    messageIndex,
    index: Number.isFinite(target?.index) ? target.index : messageIndex,
    role,
    text: target?.text || sourceMessage?.text || text,
    previewText: target?.previewText || sourceMessage?.previewText || text,
    sourceMessage,
    originalTarget: target,
  };
};

const cancelVirtualizedJump = () => {
  virtualJumpState.activeToken += 1;
  virtualJumpState.targetKey = "";
  virtualJumpState.attempts = 0;
  virtualJumpState.lastWindowSignature = "";
};

const cancelToolkitVirtualJump = cancelVirtualizedJump;

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
  const preferredIndex = resolveDomNodeApproximateMessageIndex(node);
  return findConversationMessageByText(text, role, { preferredIndex });
};

const resolveDomNodeMessageIndex = (node) => {
  const message = resolveDomNodeConversationMessage(node);
  if (Number.isFinite(message?.index)) {
    return message.index;
  }
  return resolveDomNodeApproximateMessageIndex(node);
};

const parseVirtualJumpInteger = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null;
};

const addVirtualIndexCandidate = (candidates, index, confidence, source) => {
  if (!Number.isFinite(index) || index < 0) {
    return;
  }
  const existing = candidates.find((candidate) => candidate.index === index);
  if (existing) {
    existing.confidence = Math.max(existing.confidence, confidence);
    return;
  }
  candidates.push({ index, confidence, source });
};

const getDomVirtualIndexCandidates = (node) => {
  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const candidates = [];
  const dataIndexElement =
    node.hasAttribute("data-index") ? node : node.closest("[data-index]") || node.querySelector("[data-index]");
  const dataIndex = parseVirtualJumpInteger(dataIndexElement?.getAttribute("data-index"));
  if (Number.isFinite(dataIndex)) {
    addVirtualIndexCandidate(candidates, dataIndex, 0.9, "data-index");
  }

  const ariaElement =
    node.hasAttribute("aria-posinset")
      ? node
      : node.closest("[aria-posinset]") || node.querySelector("[aria-posinset]");
  const ariaPosInset = parseVirtualJumpInteger(ariaElement?.getAttribute("aria-posinset"));
  if (Number.isFinite(ariaPosInset)) {
    addVirtualIndexCandidate(candidates, Math.max(0, ariaPosInset - 1), 0.85, "aria-posinset");
  }

  const turnTestId =
    node.getAttribute("data-testid") ||
    node.querySelector('[data-testid^="conversation-turn-"]')?.getAttribute("data-testid") ||
    "";
  const turnMatch = turnTestId.match(/conversation-turn-(\d+)/i);
  if (turnMatch) {
    const turnIndex = parseVirtualJumpInteger(turnMatch[1]);
    if (Number.isFinite(turnIndex)) {
      addVirtualIndexCandidate(candidates, Math.max(0, turnIndex - 1), 0.45, "conversation-turn");
    }
  }

  return candidates;
};

function resolveDomNodeApproximateMessageIndex(node) {
  const candidates = getDomVirtualIndexCandidates(node)
    .slice()
    .sort((left, right) => right.confidence - left.confidence);
  const best = candidates[0];
  if (!best || !Number.isFinite(best.index)) {
    return null;
  }

  const calibration = getVirtualizerCalibrationState();
  const offset = calibration?.confidence > 0.6 ? calibration.offset : 0;
  const messageIndex = best.index + 1 - offset;
  return Number.isFinite(messageIndex) && messageIndex > 0 ? Math.trunc(messageIndex) : null;
}

const getVirtualizerCalibrationState = () =>
  typeof virtualizerCalibrationState !== "undefined" ? virtualizerCalibrationState : null;

const calibrateVirtualIndexOffset = () => {
  const calibration = getVirtualizerCalibrationState();
  if (!calibration) {
    return null;
  }

  const nodes = typeof getMessageNodes === "function" ? getMessageNodes({ forceRefresh: true }) : [];
  const groups = new Map();

  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement) || !node.isConnected) {
      return;
    }
    const message = resolveDomNodeConversationMessage(node);
    if (!message || !Number.isFinite(message.index)) {
      return;
    }

    const messageVirtualBase = message.index - 1;
    getDomVirtualIndexCandidates(node).forEach((candidate) => {
      const offset = candidate.index - messageVirtualBase;
      if (!Number.isFinite(offset) || Math.abs(offset) > 5000) {
        return;
      }
      const key = String(offset);
      const previous = groups.get(key) || {
        offset,
        count: 0,
        weight: 0,
        highConfidenceCount: 0,
      };
      previous.count += 1;
      previous.weight += candidate.confidence;
      if (candidate.confidence >= 0.75) {
        previous.highConfidenceCount += 1;
      }
      groups.set(key, previous);
    });
  });

  const best = Array.from(groups.values()).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return right.weight - left.weight;
  })[0];

  if (
    best &&
    best.count >= 3 &&
    (best.highConfidenceCount >= 3 || best.weight >= 2.4)
  ) {
    calibration.offset = best.offset;
    calibration.confidence = best.highConfidenceCount >= 3 ? 0.85 : 0.61;
    calibration.updatedAt = Date.now();
    return calibration;
  }

  calibration.offset = 0;
  calibration.confidence = 0;
  calibration.updatedAt = Date.now();
  return calibration;
};

const getCurrentVirtualizerCalibration = () => {
  const calibration = getVirtualizerCalibrationState();
  if (!calibration) {
    return null;
  }

  if (
    !calibration.updatedAt ||
    Date.now() - calibration.updatedAt > VIRTUALIZER_CALIBRATION_TTL_MS
  ) {
    return calibrateVirtualIndexOffset();
  }

  return calibration;
};

const resolveVirtualIndexCandidates = (target) => {
  const targetIndex = getVirtualJumpTargetIndex(target);
  if (!Number.isFinite(targetIndex)) {
    return [];
  }

  const calibration = getCurrentVirtualizerCalibration();
  const offset = calibration?.confidence > 0.6 ? calibration.offset : 0;
  const base = targetIndex - 1 + offset;
  const deltas = [0, -1, 1, -2, 2, -5, 5, -10, 10];
  const candidates = [];

  deltas.forEach((delta) => {
    const candidate = Math.trunc(base + delta);
    if (Number.isFinite(candidate) && candidate >= 0 && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  });

  return candidates;
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

const resolveMessageNodeByPreviewText = (target, options = {}) => {
  const targetText = normalizeVirtualJumpText(getVirtualJumpTargetText(target));
  if (!targetText) {
    return null;
  }

  const role = getVirtualJumpTargetRole(target);
  const preferredIndex = getVirtualJumpTargetIndex(target);
  const targetNeedle = targetText
    .slice(0, options.needleLength || VIRTUAL_JUMP_TEXT_NEEDLE_LIMIT)
    .toLowerCase();
  const viewportCenter = (window.innerHeight || document.documentElement?.clientHeight || 0) / 2;
  const nodes = typeof getMessageNodes === "function" ? getMessageNodes({ forceRefresh: true }) : [];
  let bestNode = null;
  let bestScore = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const nodeRole = getVirtualJumpDomRole(node);
    if (role && nodeRole !== role) {
      return;
    }

    const nodeText = getVirtualJumpDomText(node);
    const normalizedNodeText = nodeText.toLowerCase();
    const score = normalizedNodeText.includes(targetNeedle)
      ? 1
      : getTextMatchScore(targetText, nodeText);
    if (score < (options.threshold || VIRTUAL_JUMP_TEXT_MATCH_THRESHOLD)) {
      return;
    }

    const nodeIndex = resolveDomNodeMessageIndex(node);
    const indexDistance =
      Number.isFinite(preferredIndex) && Number.isFinite(nodeIndex)
        ? Math.abs(nodeIndex - preferredIndex)
        : 0;
    const adjustedScore = score - Math.min(indexDistance / 1000, 0.12);
    const rect = node.getBoundingClientRect();
    const viewportDistance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter);
    if (adjustedScore > bestScore || (adjustedScore === bestScore && viewportDistance < bestDistance)) {
      bestScore = adjustedScore;
      bestDistance = viewportDistance;
      bestNode = node;
    }
  });

  return bestNode;
};

const resolveByPreviewText = resolveMessageNodeByPreviewText;

const isVirtualJumpNodeRoleCompatible = (node, target) => {
  const targetRole = getVirtualJumpTargetRole(target);
  if (!targetRole) {
    return true;
  }
  const nodeRole = getVirtualJumpDomRole(node);
  return !nodeRole || nodeRole === "unknown" || nodeRole === targetRole;
};

const isDomNodeLikelyJumpTarget = (node, target, options = {}) => {
  if (!(node instanceof HTMLElement) || !node.isConnected) {
    return false;
  }

  const messageId = getVirtualJumpTargetMessageId(target);
  if (messageId) {
    const domIds = getDomMessageIdCandidates(node);
    if (domIds.includes(messageId)) {
      return true;
    }

    const message = resolveDomNodeConversationMessage(node);
    if (
      message?.messageId === messageId ||
      message?.id === messageId ||
      message?.key === messageId
    ) {
      return true;
    }
  }

  const targetIndex = getVirtualJumpTargetIndex(target);
  if (Number.isFinite(targetIndex)) {
    const message = resolveDomNodeConversationMessage(node);
    const nodeIndex = Number.isFinite(message?.index)
      ? message.index
      : resolveDomNodeApproximateMessageIndex(node);
    if (Number.isFinite(nodeIndex) && nodeIndex === targetIndex && isVirtualJumpNodeRoleCompatible(node, target)) {
      return true;
    }
  }

  if (options.allowWeak === false) {
    return false;
  }

  const targetText = getVirtualJumpTargetText(target);
  const nodeText = getVirtualJumpDomText(node);
  if (!targetText || !nodeText) {
    return false;
  }

  const targetRole = getVirtualJumpTargetRole(target);
  const nodeRole = getVirtualJumpDomRole(node);
  if (targetRole && nodeRole !== targetRole) {
    return false;
  }

  return getTextMatchScore(targetText, nodeText) >= (options.threshold || VIRTUAL_JUMP_TEXT_MATCH_THRESHOLD);
};

const rememberResolvedJumpNode = (target, node) => {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  target.node = node;
  if (target?.sourceMessage) {
    target.sourceMessage.node = node;
  }
};

const clearStaleJumpNode = (target, node) => {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  if (target?.node === node) {
    target.node = null;
  }
  if (target?.sourceMessage?.node === node) {
    target.sourceMessage.node = null;
  }
};

const resolveMessageDomNode = (target, options = {}) => {
  if (target instanceof HTMLElement) {
    return target.isConnected ? target : null;
  }
  if (
    target?.node instanceof HTMLElement &&
    target.node.isConnected &&
    isDomNodeLikelyJumpTarget(target.node, target, options)
  ) {
    return target.node;
  }
  if (target?.node instanceof HTMLElement) {
    clearStaleJumpNode(target, target.node);
  }
  if (
    target?.sourceMessage?.node instanceof HTMLElement &&
    target.sourceMessage.node.isConnected &&
    isDomNodeLikelyJumpTarget(target.sourceMessage.node, target, options)
  ) {
    rememberResolvedJumpNode(target, target.sourceMessage.node);
    return target.node;
  }
  if (target?.sourceMessage?.node instanceof HTMLElement) {
    clearStaleJumpNode(target, target.sourceMessage.node);
  }

  const messageId = getVirtualJumpTargetMessageId(target);
  const byId = queryMessageNodeById(messageId);
  if (byId instanceof HTMLElement && byId.isConnected) {
    rememberResolvedJumpNode(target, byId);
    return byId;
  }

  const cachedNode = findCachedMessageNodeForTarget(target, options);
  if (
    cachedNode instanceof HTMLElement &&
    cachedNode.isConnected &&
    isDomNodeLikelyJumpTarget(cachedNode, target, options)
  ) {
    rememberResolvedJumpNode(target, cachedNode);
    return cachedNode;
  }

  if (options.allowWeak === false) {
    return null;
  }

  const weakNode = resolveByPreviewText(target);
  if (weakNode instanceof HTMLElement && weakNode.isConnected) {
    rememberResolvedJumpNode(target, weakNode);
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
    const messageIndex = Number.isFinite(message?.index)
      ? message.index
      : resolveDomNodeApproximateMessageIndex(node);
    if (!Number.isFinite(messageIndex)) {
      return;
    }

    const key =
      message?.key ||
      message?.messageId ||
      getDomMessageIdCandidates(node)[0] ||
      `idx:${messageIndex}`;
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    messageIndexes.push(messageIndex);
    renderedItems.push({
      key,
      node,
      message: message || null,
      index: messageIndex,
      userOrder: message?.userOrder,
      role: message?.role || getVirtualJumpDomRole(node) || "",
    });
    if (message?.role === "user" && Number.isFinite(message.userOrder)) {
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
  const windowSignature = `${minIndex || ""}:${maxIndex || ""}:${messageIndexes.length}:${scrollTop}`;

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
    signature: windowSignature,
  };
};

const sleepForVirtualJump = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const getVirtualJumpRetryDelayMs = (delayMs) => {
  const value = Number.isFinite(delayMs) ? delayMs : VIRTUAL_JUMP_RETRY_DELAY_MS;
  return Math.min(
    VIRTUAL_JUMP_MAX_RETRY_DELAY_MS,
    Math.max(VIRTUAL_JUMP_MIN_RETRY_DELAY_MS, value),
  );
};

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
  if (typeof getMessageNodes === "function") {
    getMessageNodes({ forceRefresh: true });
  }
};

const waitAfterVirtualJumpScroll = async (options = {}) => {
  await waitForVirtualListSettle(options.settleDelayMs);
  await sleepForVirtualJump(getVirtualJumpRetryDelayMs(options.retryDelayMs));
  if (typeof getMessageNodes === "function") {
    getMessageNodes({ forceRefresh: true });
  }
};

const getVirtualJumpViewportRect = () => {
  const controller = getVirtualJumpScrollController();
  const root = controller?.root;
  const isDocumentRoot =
    !(root instanceof HTMLElement) ||
    (typeof isConversationDocumentScrollRoot === "function" &&
      isConversationDocumentScrollRoot(root));

  if (isDocumentRoot) {
    const height = window.innerHeight || document.documentElement?.clientHeight || 0;
    return height > 0
      ? {
          top: 0,
          bottom: height,
          height,
          center: height / 2,
        }
      : null;
  }

  const rect = root.getBoundingClientRect();
  if (!(rect.height > 0)) {
    return null;
  }

  return {
    top: rect.top,
    bottom: rect.bottom,
    height: rect.height,
    center: (rect.top + rect.bottom) / 2,
  };
};

const isVirtualJumpNodeCentered = (node) => {
  if (!(node instanceof HTMLElement) || !node.isConnected) {
    return false;
  }

  const viewportRect = getVirtualJumpViewportRect();
  const nodeRect = node.getBoundingClientRect();
  if (!viewportRect || !(nodeRect.height >= 0)) {
    return false;
  }

  if (nodeRect.top <= viewportRect.center && nodeRect.bottom >= viewportRect.center) {
    return true;
  }

  const nodeCenter = (nodeRect.top + nodeRect.bottom) / 2;
  const tolerance = Math.min(Math.max(viewportRect.height * 0.18, 80), 220);
  return Math.abs(nodeCenter - viewportRect.center) <= tolerance;
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

const requestImperativeVirtualizerJump = async (target, options = {}) => {
  if (!options.tryNativeVirtualizer && !VIRTUAL_JUMP_NATIVE_SCROLL_ENABLED) {
    return { ok: false, reason: "native_virtualizer_disabled" };
  }
  if (typeof requestVirtualizerScrollToIndex !== "function") {
    return { ok: false, reason: "bridge_unavailable" };
  }

  const candidates = resolveVirtualIndexCandidates(target);
  if (candidates.length === 0) {
    return { ok: false, reason: "invalid_index" };
  }

  try {
    const timeoutMs =
      options.virtualizerTimeoutMs ||
      (typeof VIRTUALIZER_BRIDGE_TIMEOUT_MS !== "undefined" ? VIRTUALIZER_BRIDGE_TIMEOUT_MS : 1200);
    const result = await requestVirtualizerScrollToIndex(candidates, {
      align: "center",
      behavior: "auto",
      timeoutMs,
    });
    return result || { ok: false, reason: "empty_result" };
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || "virtualizer_request_failed",
    };
  }
};

const jumpToConversationMessage = async (target, options = {}) => {
  const normalizedTarget = normalizeJumpTarget(target);
  cancelVirtualizedJump();
  const token = virtualJumpState.activeToken;
  virtualJumpState.targetKey = getVirtualJumpTargetKey(normalizedTarget);
  virtualJumpState.attempts = 0;
  virtualJumpState.lastWindowSignature = "";

  const isActive = () => token === virtualJumpState.activeToken;
  const failJump = (reason) => {
    if (isActive()) {
      options.onFailed?.(reason, { reason, target: normalizedTarget });
    }
    return { ok: false, reason };
  };
  const resolveAndFinish = async (node, method, metadata = {}) => {
    if (!isActive() || !(node instanceof HTMLElement) || !node.isConnected) {
      return false;
    }
    if (typeof scrollElementIntoConversationView === "function") {
      scrollElementIntoConversationView(node, {
        behavior: options.finalBehavior || "auto",
        block: options.block || "center",
      });
    } else {
      node.scrollIntoView({ behavior: options.finalBehavior || "auto", block: options.block || "center" });
    }
    await nextVirtualJumpFrame();
    if (!isActive() || !isVirtualJumpNodeCentered(node)) {
      return false;
    }
    options.onResolved?.(node, {
      method,
      target: normalizedTarget,
      ...metadata,
    });
    return true;
  };

  options.onBeforeJump?.(normalizedTarget);

  const directNode = resolveMessageDomNode(normalizedTarget, { allowWeak: false });
  if (await resolveAndFinish(directNode, "direct")) {
    return { ok: true, node: directNode, reason: "resolved" };
  }

  const targetIndex = getVirtualJumpTargetIndex(normalizedTarget);
  const readyIndex = getVirtualJumpConversationIndex();
  const totalMessages =
    options.totalMessages ||
    readyIndex?.messages?.length ||
    (Number.isFinite(targetIndex) ? targetIndex : 0);

  const imperativeResult = await requestImperativeVirtualizerJump(normalizedTarget, options);
  options.onImperativeScroll?.(imperativeResult);
  if (!isActive()) {
    return { ok: false, reason: "cancelled" };
  }
  if (imperativeResult.ok) {
    await waitAfterVirtualJumpScroll(options);
    if (!isActive()) {
      return { ok: false, reason: "cancelled" };
    }
    const resolvedAfterImperative = resolveMessageDomNode(normalizedTarget);
    if (await resolveAndFinish(resolvedAfterImperative, "native-virtualizer", { virtualizer: imperativeResult })) {
      return {
        ok: true,
        node: resolvedAfterImperative,
        reason: "resolved-after-virtualizer",
        virtualizer: imperativeResult,
      };
    }
  }

  if (Number.isFinite(targetIndex) && totalMessages > 1) {
    const ratio = (targetIndex - 1) / Math.max(1, totalMessages - 1);
    if (scrollConversationToVirtualRatio(ratio, "auto")) {
      options.onApproximateScroll?.({ ratio, targetIndex, totalMessages });
      await waitAfterVirtualJumpScroll(options);
      if (!isActive()) {
        return { ok: false, reason: "cancelled" };
      }
      const resolvedAfterRatio = resolveMessageDomNode(normalizedTarget);
      if (await resolveAndFinish(resolvedAfterRatio, "ratio", { ratio, targetIndex, totalMessages })) {
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
    const resolvedAtAttemptStart = resolveMessageDomNode(normalizedTarget);
    if (await resolveAndFinish(resolvedAtAttemptStart, "probe", { attempt })) {
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
        const weakNode = resolveByPreviewText(normalizedTarget, { threshold: 0.62 });
        if (await resolveAndFinish(weakNode, "weak-match", { attempt, renderedWindow })) {
          return { ok: true, node: weakNode, reason: "resolved-by-preview" };
        }
      }
    }

    if (direction === 0) {
      const userOrder = getVirtualJumpTargetUserOrder(normalizedTarget);
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
      await sleepForVirtualJump(getVirtualJumpRetryDelayMs(options.retryDelayMs));
      if (!isActive()) {
        return { ok: false, reason: "cancelled" };
      }
      const resolvedAfterBoundary = resolveMessageDomNode(normalizedTarget);
      if (await resolveAndFinish(resolvedAfterBoundary, "boundary-probe", { attempt, renderedWindow })) {
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
    await waitAfterVirtualJumpScroll(options);
    const resolvedNode = resolveMessageDomNode(normalizedTarget);
    if (await resolveAndFinish(resolvedNode, "probe", { attempt })) {
      return { ok: true, node: resolvedNode, reason: "resolved-after-probe" };
    }
  }

  return failJump("target_not_mounted_after_probe");
};

const scrollToMessageIndex = (messageIndex, options = {}) =>
  jumpToConversationMessage(
    {
      messageIndex,
      index: messageIndex,
      role: options.role || "",
      messageId: options.messageId || "",
      previewText: options.previewText || "",
      text: options.text || "",
    },
    options,
  );

window.__CGPT_TOOLKIT_VIRTUALIZER__ = {
  jumpToConversationMessage,
  scrollToMessageIndex,
  resolveMessageDomNode,
  getRenderedMessageWindow,
  cancelToolkitVirtualJump,
};
