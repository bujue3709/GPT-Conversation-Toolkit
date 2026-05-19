/*
 * ChatGPT Conversation Toolkit - Search
 */

const SEARCH_MARK_CLASS = "chatgpt-toolkit-search-text-match";
const SEARCH_MARK_ACTIVE_CLASS = "chatgpt-toolkit-search-text-active";
const SEARCH_BATCH_SIZE = 80;

let activeSearchToken = 0;
let searchBatchTimer = null;
let searchInProgress = false;
let searchProgressDone = 0;
let searchProgressTotal = 0;

const updateSearchUI = () => {
  const searchResult = document.getElementById("chatgpt-toolkit-search-result");
  const prevBtn = document.getElementById("chatgpt-toolkit-search-prev");
  const nextBtn = document.getElementById("chatgpt-toolkit-search-next");

  if (!searchResult || !prevBtn || !nextBtn) {
    return;
  }

  if (searchInProgress) {
    searchResult.textContent = `${searchProgressDone}/${searchProgressTotal}`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  if (state.searchMatches.length === 0) {
    searchResult.textContent = state.searchQuery ? t("search.noMatch") : "";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  searchResult.textContent = `${state.currentMatchIndex + 1} / ${state.searchMatches.length}`;
  prevBtn.disabled = state.searchMatches.length <= 1;
  nextBtn.disabled = state.searchMatches.length <= 1;
};

const normalizeSearchMode = (mode) =>
  mode === TOOLKIT_MESSAGE_MODE_EXTENDED
    ? TOOLKIT_MESSAGE_MODE_EXTENDED
    : TOOLKIT_MESSAGE_MODE_LOADED;

const getSearchMatchNode = (match) => {
  if (match instanceof HTMLElement) {
    return match;
  }
  if (match?.source === "api" && typeof resolveMessageDomNode === "function") {
    return resolveMessageDomNode(match);
  }
  if (typeof resolveCachedMessageNode === "function") {
    return resolveCachedMessageNode(match);
  }
  return match?.node instanceof HTMLElement && match.node.isConnected ? match.node : null;
};

const getSearchMatchText = (match) => {
  if (match instanceof HTMLElement) {
    return extractMessageText(match);
  }
  return match?.text || "";
};

const getSearchMatchRanges = (text, queryLower) => {
  const ranges = [];
  const lowerText = String(text || "").toLowerCase();
  const queryLength = queryLower.length;
  if (!lowerText || !queryLength) {
    return ranges;
  }

  let index = lowerText.indexOf(queryLower);
  while (index !== -1) {
    ranges.push({
      start: index,
      end: index + queryLength,
    });
    index = lowerText.indexOf(queryLower, index + queryLength);
  }
  return ranges;
};

const createApiSearchMatch = (message, queryLower, resultIndex) => ({
  matchId: `${message.key}:match:${resultIndex + 1}`,
  key: message.key,
  messageKey: message.key,
  messageId: message.messageId || "",
  messageIndex: message.index,
  userOrder: message.userOrder,
  role: message.role || "",
  text: message.text || "",
  previewText: message.previewText || "",
  matchRanges: getSearchMatchRanges(message.text || "", queryLower),
  sourceMessage: message,
  source: "api",
  node: null,
});

const clearTextHighlights = () => {
  const marks = document.querySelectorAll(`.${SEARCH_MARK_CLASS}`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    parent.normalize();
  });
};

const shouldSkipHighlightTextNode = (node) => {
  const parent = node?.parentElement;
  if (!parent) {
    return true;
  }

  const tag = parent.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "BUTTON") {
    return true;
  }

  if (parent.classList?.contains(SEARCH_MARK_CLASS)) {
    return true;
  }

  return Boolean(
    parent.closest(
      [
        "button",
        "textarea",
        "input",
        "select",
        `#${TOOLKIT_ID}`,
        `#${MINIMIZED_ID}`,
        `#${TIMELINE_ID}`,
        `#${PROMPT_MODAL_ID}`,
      ].join(", "),
    ),
  );
};

const injectTextHighlights = (containerNode, query) => {
  if (!query || !(containerNode instanceof HTMLElement)) {
    return;
  }

  const walker = document.createTreeWalker(containerNode, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipHighlightTextNode(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  let current;
  while ((current = walker.nextNode())) {
    textNodes.push(current);
  }

  const lowerQuery = query.toLowerCase();
  const queryLength = query.length;

  textNodes.forEach((textNode) => {
    const text = textNode.textContent || "";
    const lowerText = text.toLowerCase();
    if (!lowerText.includes(lowerQuery)) {
      return;
    }

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let matchIndex = lowerText.indexOf(lowerQuery, lastIndex);

    while (matchIndex !== -1) {
      if (matchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
      }

      const mark = document.createElement("mark");
      mark.className = SEARCH_MARK_CLASS;
      mark.textContent = text.slice(matchIndex, matchIndex + queryLength);
      fragment.appendChild(mark);

      lastIndex = matchIndex + queryLength;
      matchIndex = lowerText.indexOf(lowerQuery, lastIndex);
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  });
};

const updateActiveTextMark = () => {
  document.querySelectorAll(`.${SEARCH_MARK_ACTIVE_CLASS}`).forEach((element) => {
    element.classList.remove(SEARCH_MARK_ACTIVE_CLASS);
  });

  if (state.currentMatchIndex < 0 || state.currentMatchIndex >= state.searchMatches.length) {
    return;
  }

  const node = getSearchMatchNode(state.searchMatches[state.currentMatchIndex]);
  if (!(node instanceof HTMLElement)) {
    return;
  }

  node.querySelectorAll(`.${SEARCH_MARK_CLASS}`).forEach((mark) => {
    mark.classList.add(SEARCH_MARK_ACTIVE_CLASS);
  });
};

const clearSearchHighlight = () => {
  document.querySelectorAll(".chatgpt-toolkit-search-highlight").forEach((element) => {
    element.classList.remove("chatgpt-toolkit-search-highlight");
  });
};

const renderCurrentMatchTextHighlight = () => {
  clearTextHighlights();

  if (state.currentMatchIndex < 0 || state.currentMatchIndex >= state.searchMatches.length) {
    return;
  }

  const node = getSearchMatchNode(state.searchMatches[state.currentMatchIndex]);
  if (!(node instanceof HTMLElement)) {
    return;
  }

  getMessageTextContainers(node).forEach((container) => {
    injectTextHighlights(container, state.searchQuery);
  });
};

const highlightCurrentMatch = () => {
  clearSearchHighlight();

  if (state.currentMatchIndex >= 0 && state.currentMatchIndex < state.searchMatches.length) {
    const node = getSearchMatchNode(state.searchMatches[state.currentMatchIndex]);
    if (node instanceof HTMLElement) {
      node.classList.add("chatgpt-toolkit-search-highlight");
    }
  }

  renderCurrentMatchTextHighlight();
  updateActiveTextMark();
};

const getSearchSources = (mode) =>
  typeof getConversationMessageEntries === "function"
    ? getConversationMessageEntries({
        mode,
        refreshDom: true,
        forceRefresh: true,
      })
    : typeof getCachedMessageEntries === "function"
      ? getCachedMessageEntries({ mode })
      : getMessageNodes();

const hasPotentialUnloadedMessagesAbove = () => {
  const scrollRoot =
    typeof resolveConversationScrollRoot === "function"
      ? resolveConversationScrollRoot()
      : null;
  if (!(scrollRoot instanceof HTMLElement)) {
    return false;
  }

  const documentLike =
    typeof isConversationDocumentScrollRoot === "function" &&
    isConversationDocumentScrollRoot(scrollRoot);
  if (documentLike) {
    const top = window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0;
    return top > 8;
  }

  return scrollRoot.scrollTop > 8;
};

const clearPendingSearchBatch = () => {
  if (searchBatchTimer) {
    clearTimeout(searchBatchTimer);
    searchBatchTimer = null;
  }
};

const cancelSearchRun = () => {
  activeSearchToken += 1;
  searchInProgress = false;
  searchProgressDone = 0;
  searchProgressTotal = 0;
  clearPendingSearchBatch();
};

const finalizeSearchRun = (token, mode, matches) => {
  if (token !== activeSearchToken) {
    return;
  }

  searchInProgress = false;
  searchProgressDone = searchProgressTotal;
  state.searchMatches = matches;
  state.currentMatchIndex = matches.length > 0 ? 0 : -1;

  if (matches.length > 0) {
    if (mode === "api") {
      updateStatusByKey("status.searchApiDone", "success", {
        count: matches.length,
      });
    }
    scrollToCurrentMatch();
  } else if (mode === TOOLKIT_MESSAGE_MODE_LOADED && hasPotentialUnloadedMessagesAbove()) {
    updateStatusByKey("status.searchNeedLoadMore", "info");
  } else {
    updateStatusByKey("status.searchNoMatch", "info");
  }

  updateSearchUI();
};

const performSearch = async (query) => {
  cancelSearchRun();

  state.searchQuery = (query || "").trim().toLowerCase();
  state.searchMatches = [];
  state.currentMatchIndex = -1;

  clearTextHighlights();
  clearSearchHighlight();

  if (state.isCollapsed) {
    updateStatusByKey("status.searchRestoreFirst", "info");
    updateSearchUI();
    return;
  }

  if (!state.searchQuery) {
    updateSearchUI();
    return;
  }

  const token = ++activeSearchToken;
  const queryLower = state.searchQuery;
  let mode = "api";
  let sources = [];
  let apiSearchError = null;

  searchInProgress = true;
  searchProgressDone = 0;
  searchProgressTotal = 0;
  updateStatusByKey("status.searchApiLoading", "info");
  updateSearchUI();

  if (typeof getConversationIndex === "function") {
    try {
      const conversationIndex = await getConversationIndex();
      if (token !== activeSearchToken) {
        return;
      }
      if (conversationIndex?.status === "ready" && Array.isArray(conversationIndex.messages)) {
        sources = conversationIndex.messages;
      }
    } catch (error) {
      apiSearchError = error;
    }
  }

  if (token !== activeSearchToken) {
    return;
  }

  if (sources.length === 0) {
    mode = normalizeSearchMode(TOOLKIT_MESSAGE_MODE);
    sources = getSearchSources(mode);
    if (apiSearchError) {
      updateStatusByKey("status.searchApiFallback", "warn");
    }
  }

  if (sources.length === 0) {
    searchInProgress = false;
    if (mode === TOOLKIT_MESSAGE_MODE_LOADED && hasPotentialUnloadedMessagesAbove()) {
      updateStatusByKey("status.searchNeedLoadMore", "info");
    } else {
      updateStatusByKey("status.searchNoMatch", "info");
    }
    updateSearchUI();
    return;
  }

  const matches = [];
  let cursor = 0;

  searchProgressDone = 0;
  searchProgressTotal = sources.length;
  updateStatusByKey(mode === "api" ? "status.searchApiScanning" : "status.searchScanning", "info", {
    done: searchProgressDone,
    total: searchProgressTotal,
  });
  updateSearchUI();

  const runBatch = () => {
    if (token !== activeSearchToken) {
      return;
    }

    const end = Math.min(cursor + SEARCH_BATCH_SIZE, sources.length);
    for (let index = cursor; index < end; index += 1) {
      const source = sources[index];
      const text = getSearchMatchText(source).toLowerCase();
      if (!text || !text.includes(queryLower)) {
        continue;
      }
      matches.push(
        mode === "api"
          ? createApiSearchMatch(source, queryLower, matches.length)
          : source,
      );
    }
    cursor = end;
    searchProgressDone = cursor;
    updateStatusByKey(mode === "api" ? "status.searchApiScanning" : "status.searchScanning", "info", {
      done: searchProgressDone,
      total: searchProgressTotal,
    });
    updateSearchUI();

    if (cursor >= sources.length) {
      finalizeSearchRun(token, mode, matches);
      return;
    }

    searchBatchTimer = setTimeout(() => {
      searchBatchTimer = null;
      runBatch();
    }, 0);
  };

  runBatch();
};

const scrollToCurrentMatch = async () => {
  if (state.currentMatchIndex < 0 || state.currentMatchIndex >= state.searchMatches.length) {
    return;
  }

  const match = state.searchMatches[state.currentMatchIndex];

  clearTextHighlights();
  clearSearchHighlight();

  if (typeof jumpToConversationMessage === "function") {
    await jumpToConversationMessage(match, {
      totalMessages:
        typeof getReadyConversationIndex === "function"
          ? getReadyConversationIndex()?.messages?.length
          : 0,
      onBeforeJump() {
        updateStatusByKey("status.searchJumping", "info");
      },
      onResolved(resolvedNode) {
        if (state.searchMatches[state.currentMatchIndex] !== match) {
          return;
        }
        match.node = resolvedNode;
        resolvedNode.classList.add("chatgpt-toolkit-search-highlight");
        renderCurrentMatchTextHighlight();
        updateActiveTextMark();
        updateStatusByKey("status.searchJumpDone", "success");

        const firstMark = resolvedNode.querySelector(`.${SEARCH_MARK_CLASS}`);
        const scrollTarget = firstMark || resolvedNode;
        if (typeof scrollElementIntoConversationView === "function") {
          scrollElementIntoConversationView(scrollTarget, { behavior: "smooth", block: "center" });
        } else {
          scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      },
      onFailed(reason) {
        if (state.searchMatches[state.currentMatchIndex] === match) {
          updateStatusByKey("status.searchJumpFailed", "warn", {
            reason: reason || "not-rendered",
          });
        }
      },
    });
    return;
  }

  const node = getSearchMatchNode(match);
  if (!(node instanceof HTMLElement)) {
    updateStatusByKey("status.searchMatchNotLoaded", "info");
    return;
  }

  node.classList.add("chatgpt-toolkit-search-highlight");
  renderCurrentMatchTextHighlight();
  updateActiveTextMark();
  const firstMark = node.querySelector(`.${SEARCH_MARK_CLASS}`);
  const scrollTarget = firstMark || node;
  if (typeof scrollElementIntoConversationView === "function") {
    scrollElementIntoConversationView(scrollTarget, { behavior: "smooth", block: "center" });
  } else {
    scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

const navigateToPrevMatch = () => {
  if (searchInProgress) {
    return;
  }
  if (state.isCollapsed) {
    updateStatusByKey("status.searchRestoreFirst", "info");
    return;
  }
  if (state.searchMatches.length === 0) {
    return;
  }

  state.currentMatchIndex =
    (state.currentMatchIndex - 1 + state.searchMatches.length) % state.searchMatches.length;
  scrollToCurrentMatch();
  updateSearchUI();
};

const navigateToNextMatch = () => {
  if (searchInProgress) {
    return;
  }
  if (state.isCollapsed) {
    updateStatusByKey("status.searchRestoreFirst", "info");
    return;
  }
  if (state.searchMatches.length === 0) {
    return;
  }

  state.currentMatchIndex = (state.currentMatchIndex + 1) % state.searchMatches.length;
  scrollToCurrentMatch();
  updateSearchUI();
};
