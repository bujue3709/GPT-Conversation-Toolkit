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
  // Text caches intentionally omit image-only turns; inspect loaded message
  // containers directly at export time to preserve those turns as well.
  collectMessageNodesFromDom().forEach((node, index) => {
    const key = getMessageNodeKey(node, index);
    if (seenKeys.has(key) || !collectDomExportImages(node).length) return;
    seenKeys.add(key);
    mergedEntries.push({ key, node, role: detectRole(node), text: extractMessageText(node), order: getMessageNodeOrder(node, index) });
  });

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
      if (!text && !collectDomExportImages(node).length) {
        return;
      }
      seenKeys.add(key);
      mergedEntries.push({
        key,
        role: detectRole(node),
        text,
        order: getMessageNodeOrder(node, index),
        node,
        lastSeenAt: Date.now(),
      });
    });
  }

  return mergedEntries.sort((a, b) => (a.order || 0) - (b.order || 0));
};

const normalizeDomFallbackMessage = (message, index) => ({
  index,
  role: message.role || "unknown",
  text: message.text || "",
});

const collectMessagesFromDomFallback = (options = {}) => {
  const entries = collectDomFallbackEntries();
  const messages = entries.map((entry, index) => ({
    ...normalizeDomFallbackMessage(entry, index + 1),
    images: collectDomExportImages(entry.node),
  }));

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
