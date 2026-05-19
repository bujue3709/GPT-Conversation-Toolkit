/*
 * ChatGPT Conversation Toolkit - DOM fallback export
 */
const resolveDomFallbackTitle = () => {
  const rawTitle = document.title || "";
  return rawTitle
    .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
    .replace(/^ChatGPT\s*[-|]\s*/i, "")
    .trim();
};

const collectDomFallbackEntries = () => {
  ensureConversationState();
  const entries = getConversationMessageEntries({
    mode:
      TOOLKIT_MESSAGE_MODE === TOOLKIT_MESSAGE_MODE_EXTENDED
        ? TOOLKIT_MESSAGE_MODE_EXTENDED
        : TOOLKIT_MESSAGE_MODE_LOADED,
    refreshDom: true,
    forceRefresh: true,
  });
  const mergedEntries = [...entries];
  const seenKeys = new Set(entries.map((entry) => entry.key));

  if (state.isCollapsed) {
    state.collapsedNodes.forEach((entry, index) => {
      const node = entry?.node;
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const key = getMessageNodeKey(node, index);
      if (!key || seenKeys.has(key)) {
        return;
      }
      const text = extractMessageText(node);
      if (!text) {
        return;
      }
      seenKeys.add(key);
      mergedEntries.push({
        key,
        role: detectRole(node),
        text,
        order: getMessageNodeOrder(node, index),
        node: node.isConnected ? node : null,
        lastSeenAt: Date.now(),
      });
    });
  }

  return mergedEntries;
};

const normalizeDomFallbackMessage = (message, index) => ({
  index,
  role: message.role || "unknown",
  text: message.text || "",
});

const collectMessagesFromDomFallback = (options = {}) => {
  const entries = collectDomFallbackEntries();
  const messages = buildMessagePayloadFromEntries(entries)
    .map((message, index) => normalizeDomFallbackMessage(message, index + 1));

  if (messages.length === 0) {
    throw new ExportApiError("EMPTY_FALLBACK", "No loaded messages are available to export.", {
      fallbackAllowed: false,
    });
  }

  return buildConversationExportPayload({
    conversationId: options.conversationId || getStrictConversationId() || state.conversationKey || "",
    title: resolveDomFallbackTitle(),
    url: window.location.href,
    source: "dom-fallback",
    completeness: "partial",
    branchMode: EXPORT_BRANCH_MODE_ACTIVE,
    messages,
    warnings: [
      "dom_fallback_only_loaded_or_cached_messages",
      ...(Array.isArray(options.warnings) ? options.warnings : []),
    ],
    apiError: options.apiError || null,
    rawIncluded: false,
  });
};
