/**
 * ChatGPT Conversation Toolkit - Conversation collapse
 */
const COLLAPSE_AUTO_APPLY_DELAY_MS = 180;
const COLLAPSE_ARCHIVE_CHECK_DELAY_MS = 240;
const COLLAPSE_ARCHIVE_CHECK_RETRIES = 6;
const COLLAPSE_ARCHIVE_TRIGGER_WINDOW_MS = 2200;
const COLLAPSE_ARCHIVE_ACTION_TEXTS = ["archive", "archived", "归档"];
const COLLAPSE_AUTO_MEMORY_ENABLED = false;

const getUncollapsedMessageNodes = () =>
  getMessageNodes().filter((node) => !isToolkitCollapsedMessageNode(node));

const softCollapseMessageNode = (node) => {
  if (!(node instanceof HTMLElement)) {
    return false;
  }
  node.setAttribute(COLLAPSED_MESSAGE_ATTR, "1");
  node.setAttribute("aria-hidden", "true");
  return true;
};

const restoreSoftCollapsedMessageNode = (node) => {
  if (!(node instanceof HTMLElement)) {
    return false;
  }
  node.removeAttribute(COLLAPSED_MESSAGE_ATTR);
  node.removeAttribute("aria-hidden");
  return true;
};

const normalizeCollapseMemorySnapshot = (snapshot) => {
  const rawEntries = snapshot?.entries && typeof snapshot.entries === "object" ? snapshot.entries : {};
  const now = Date.now();
  const entries = {};

  Object.entries(rawEntries).forEach(([conversationKey, entry]) => {
    if (typeof conversationKey !== "string" || !conversationKey || !entry || typeof entry !== "object") {
      return;
    }

    const lastOpenedAt = Number(entry.lastOpenedAt);
    const updatedAt = Number(entry.updatedAt);
    const effectiveLastOpenedAt = Number.isFinite(lastOpenedAt)
      ? lastOpenedAt
      : Number.isFinite(updatedAt)
        ? updatedAt
        : 0;

    if (!effectiveLastOpenedAt || now - effectiveLastOpenedAt > COLLAPSE_MEMORY_RETENTION_MS) {
      return;
    }

    entries[conversationKey] = {
      enabled: entry.enabled !== false,
      lastOpenedAt: effectiveLastOpenedAt,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : effectiveLastOpenedAt,
    };
  });

  return {
    version: 1,
    entries,
  };
};

const buildCollapseMemorySnapshot = () => ({
  version: 1,
  entries: { ...collapseMemoryState.entries },
});

const setCollapseMemorySnapshot = (snapshot) => {
  const normalized = normalizeCollapseMemorySnapshot(snapshot);
  collapseMemoryState.entries = normalized.entries;
  collapseMemoryState.loaded = true;
  return normalized;
};

const hydrateCollapseMemory = () => {
  if (collapseMemoryState.loaded) {
    return;
  }
  setCollapseMemorySnapshot(loadCollapseMemorySnapshot());
};

const persistCollapseMemory = () => {
  if (!collapseMemoryState.loaded) {
    return;
  }
  saveCollapseMemorySnapshot(buildCollapseMemorySnapshot());
};

const pruneCollapseMemoryEntries = (now = Date.now()) => {
  hydrateCollapseMemory();

  let changed = false;
  Object.entries(collapseMemoryState.entries).forEach(([conversationKey, entry]) => {
    const lastOpenedAt = Number(entry?.lastOpenedAt);
    if (!Number.isFinite(lastOpenedAt) || now - lastOpenedAt > COLLAPSE_MEMORY_RETENTION_MS) {
      delete collapseMemoryState.entries[conversationKey];
      changed = true;
    }
  });

  if (changed) {
    persistCollapseMemory();
  }

  return changed;
};

const hydrateCollapseMemoryFromExtension = async () => {
  const extensionSnapshot = await loadCollapseMemorySnapshotFromExtension();
  if (!extensionSnapshot) {
    return;
  }

  const currentSerialized = JSON.stringify(buildCollapseMemorySnapshot());
  const nextNormalized = normalizeCollapseMemorySnapshot(extensionSnapshot);
  const nextSerialized = JSON.stringify(nextNormalized);

  if (currentSerialized === nextSerialized) {
    return;
  }

  setCollapseMemorySnapshot(nextNormalized);
  persistCollapseMemory();
  syncCollapseMemoryForCurrentConversation({ triggerAuto: true, forceAuto: true });
};

const getCollapseMemoryEntry = (conversationKey) =>
  conversationKey && collapseMemoryState.entries[conversationKey]
    ? collapseMemoryState.entries[conversationKey]
    : null;

const isConversationCollapseRemembered = (conversationKey) =>
  Boolean(getCollapseMemoryEntry(conversationKey)?.enabled);

const syncCollapseMemoryUi = () => {
  if (typeof refreshCollapseMemoryIndicator === "function") {
    refreshCollapseMemoryIndicator();
  }
};

const clearCollapseMemoryAutoApplyTimer = () => {
  if (collapseMemoryAutoApplyTimer) {
    clearTimeout(collapseMemoryAutoApplyTimer);
    collapseMemoryAutoApplyTimer = null;
  }
};

const clearCollapseMemoryReoptimizeTimer = () => {
  if (collapseMemoryReoptimizeTimer) {
    clearTimeout(collapseMemoryReoptimizeTimer);
    collapseMemoryReoptimizeTimer = null;
  }
};

const rememberConversationCollapseState = (conversationKey, now = Date.now()) => {
  if (!conversationKey) {
    return false;
  }

  hydrateCollapseMemory();
  pruneCollapseMemoryEntries(now);
  collapseMemoryState.entries[conversationKey] = {
    enabled: true,
    lastOpenedAt: now,
    updatedAt: now,
  };
  persistCollapseMemory();
  if (conversationKey === state.conversationKey) {
    syncCollapseMemoryUi();
  }
  return true;
};

const touchConversationCollapseState = (conversationKey, now = Date.now()) => {
  const entry = getCollapseMemoryEntry(conversationKey);
  if (!entry) {
    return false;
  }

  entry.lastOpenedAt = now;
  entry.updatedAt = now;
  persistCollapseMemory();
  return true;
};

const clearConversationCollapseMemory = (conversationKey) => {
  if (!conversationKey || !collapseMemoryState.entries[conversationKey]) {
    return false;
  }

  delete collapseMemoryState.entries[conversationKey];
  if (collapseMemoryState.pendingAutoConversationKey === conversationKey) {
    collapseMemoryState.pendingAutoConversationKey = "";
    clearCollapseMemoryAutoApplyTimer();
  }
  clearCollapseMemoryReoptimizeTimer();
  persistCollapseMemory();
  if (conversationKey === state.conversationKey) {
    syncCollapseMemoryUi();
  }
  return true;
};

const getSidebarConversationItemByKey = (conversationKey) => {
  if (!conversationKey) {
    return null;
  }

  const items = Array.from(
    document.querySelectorAll('#history a[data-sidebar-item="true"][href*="/c/"]'),
  );
  return (
    items.find((item) => {
      if (!(item instanceof HTMLAnchorElement)) {
        return false;
      }
      const href = item.getAttribute("href") || "";
      const matched = href.match(/\/c\/([^/?#]+)/);
      return matched?.[1] === conversationKey;
    }) || null
  );
};

const getConversationKeyFromOptionsTrigger = (element) => {
  if (!(element instanceof Element)) {
    return "";
  }

  const directKey = element.getAttribute("data-conversation-options-trigger");
  if (directKey) {
    return directKey;
  }

  const sidebarItem = element.closest('a[data-sidebar-item="true"][href*="/c/"]');
  if (!(sidebarItem instanceof HTMLAnchorElement)) {
    return "";
  }

  const href = sidebarItem.getAttribute("href") || "";
  const matched = href.match(/\/c\/([^/?#]+)/);
  return matched?.[1] || "";
};

const normalizeArchiveActionText = (value) =>
  (value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const isArchiveActionElement = (element) => {
  if (!(element instanceof Element)) {
    return false;
  }

  const candidate = element.closest("button, [role='menuitem'], [role='button']");
  if (!(candidate instanceof HTMLElement)) {
    return false;
  }

  const text = normalizeArchiveActionText(
    `${candidate.textContent || ""} ${candidate.getAttribute("aria-label") || ""}`,
  );
  return COLLAPSE_ARCHIVE_ACTION_TEXTS.some((keyword) => text.includes(keyword));
};

const confirmArchivedConversationCleanup = (
  conversationKey,
  remainingAttempts = COLLAPSE_ARCHIVE_CHECK_RETRIES,
) => {
  if (!conversationKey) {
    return;
  }

  if (collapseMemoryArchiveCheckTimer) {
    clearTimeout(collapseMemoryArchiveCheckTimer);
    collapseMemoryArchiveCheckTimer = null;
  }

  collapseMemoryArchiveCheckTimer = setTimeout(() => {
    collapseMemoryArchiveCheckTimer = null;

    const currentConversationKey = getConversationKey();
    const sidebarItem = getSidebarConversationItemByKey(conversationKey);
    const archived =
      currentConversationKey !== conversationKey || !(sidebarItem instanceof HTMLAnchorElement);

    if (archived) {
      clearConversationCollapseMemory(conversationKey);
      return;
    }

    if (remainingAttempts > 0) {
      confirmArchivedConversationCleanup(conversationKey, remainingAttempts - 1);
    }
  }, COLLAPSE_ARCHIVE_CHECK_DELAY_MS);
};

const attemptAutoCollapseRememberedConversation = () => {
  collapseMemoryAutoApplyTimer = null;
  ensureConversationState();
  hydrateCollapseMemory();
  pruneCollapseMemoryEntries();

  const conversationKey = state.conversationKey;
  if (!conversationKey || collapseMemoryState.pendingAutoConversationKey !== conversationKey) {
    return;
  }

  if (!isConversationCollapseRemembered(conversationKey) || state.isCollapsed) {
    collapseMemoryState.pendingAutoConversationKey = "";
    return;
  }

  const nodes = getUncollapsedMessageNodes();
  if (nodes.length === 0) {
    return;
  }

  if (nodes.length <= state.keepLatest) {
    collapseMemoryState.pendingAutoConversationKey = "";
    return;
  }

  collapseOldMessages({
    rememberState: true,
    updateStatus: false,
  });
  collapseMemoryState.pendingAutoConversationKey = "";
};

const scheduleAutoCollapseForConversation = (conversationKey) => {
  if (!COLLAPSE_AUTO_MEMORY_ENABLED) {
    clearCollapseMemoryAutoApplyTimer();
    collapseMemoryState.pendingAutoConversationKey = "";
    return;
  }

  if (!conversationKey || !isConversationCollapseRemembered(conversationKey)) {
    return;
  }

  collapseMemoryState.pendingAutoConversationKey = conversationKey;
  if (collapseMemoryAutoApplyTimer) {
    return;
  }

  collapseMemoryAutoApplyTimer = setTimeout(() => {
    attemptAutoCollapseRememberedConversation();
  }, COLLAPSE_AUTO_APPLY_DELAY_MS);
};

const shouldAutoReoptimizeCurrentConversation = (conversationKey = state.conversationKey) => {
  if (!COLLAPSE_AUTO_MEMORY_ENABLED) {
    return false;
  }

  if (!conversationKey || !state.isCollapsed || !isConversationCollapseRemembered(conversationKey)) {
    return false;
  }

  return getUncollapsedMessageNodes().length >= state.keepLatest + COLLAPSE_AUTO_REOPTIMIZE_BUFFER;
};

const attemptAutoReoptimizeCurrentConversation = () => {
  collapseMemoryReoptimizeTimer = null;
  ensureConversationState();
  hydrateCollapseMemory();
  pruneCollapseMemoryEntries();

  const conversationKey = state.conversationKey;
  if (!shouldAutoReoptimizeCurrentConversation(conversationKey)) {
    return;
  }

  collapseOldMessages({
    rememberState: true,
    updateStatus: false,
  });
};

const scheduleAutoReoptimizeCurrentConversation = () => {
  if (!shouldAutoReoptimizeCurrentConversation()) {
    clearCollapseMemoryReoptimizeTimer();
    return;
  }

  if (collapseMemoryReoptimizeTimer) {
    return;
  }

  collapseMemoryReoptimizeTimer = setTimeout(() => {
    attemptAutoReoptimizeCurrentConversation();
  }, COLLAPSE_AUTO_REOPTIMIZE_DELAY_MS);
};

const syncCollapseMemoryForCurrentConversation = (options = {}) => {
  const { triggerAuto = false, forceAuto = false } = options;

  ensureConversationState();
  hydrateCollapseMemory();
  pruneCollapseMemoryEntries();

  const conversationKey = state.conversationKey;
  const conversationChanged = collapseMemoryState.currentConversationKey !== conversationKey;

  if (conversationChanged) {
    collapseMemoryState.currentConversationKey = conversationKey || "";
    collapseMemoryState.pendingAutoConversationKey = "";
    clearCollapseMemoryAutoApplyTimer();
    clearCollapseMemoryReoptimizeTimer();
  }

  if (!conversationKey) {
    syncCollapseMemoryUi();
    return;
  }

  const remembered = isConversationCollapseRemembered(conversationKey);
  if (conversationChanged && remembered) {
    touchConversationCollapseState(conversationKey);
  }

  const shouldScheduleAuto =
    triggerAuto &&
    remembered &&
    (conversationChanged ||
      forceAuto ||
      collapseMemoryState.pendingAutoConversationKey === conversationKey);

  if (shouldScheduleAuto) {
    scheduleAutoCollapseForConversation(conversationKey);
  }

  scheduleAutoReoptimizeCurrentConversation();

  syncCollapseMemoryUi();
};

const initCollapseMemory = () => {
  if (collapseMemoryState.initialized) {
    return;
  }

  collapseMemoryState.initialized = true;
  hydrateCollapseMemory();
  pruneCollapseMemoryEntries();

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!(target instanceof Element)) {
        return;
      }

      const optionsTrigger = target.closest("[data-conversation-options-trigger]");
      if (optionsTrigger instanceof Element) {
        const conversationKey = getConversationKeyFromOptionsTrigger(optionsTrigger);
        if (conversationKey) {
          collapseMemoryState.recentOptionsConversationKey = conversationKey;
          collapseMemoryState.recentOptionsAt = Date.now();
        }
        return;
      }

      if (!isArchiveActionElement(target)) {
        return;
      }

      const now = Date.now();
      const trackedConversationKey =
        collapseMemoryState.recentOptionsConversationKey &&
        now - collapseMemoryState.recentOptionsAt <= COLLAPSE_ARCHIVE_TRIGGER_WINDOW_MS
          ? collapseMemoryState.recentOptionsConversationKey
          : state.conversationKey || "";

      collapseMemoryState.recentOptionsConversationKey = "";
      collapseMemoryState.recentOptionsAt = 0;

      if (trackedConversationKey) {
        confirmArchivedConversationCleanup(trackedConversationKey);
      }
    },
    true,
  );

  void hydrateCollapseMemoryFromExtension();
};

const collapseOldMessages = (options = {}) => {
  const { rememberState = true, updateStatus = true } = options;

  ensureConversationState();
  const conversationKey = state.conversationKey;
  const nodes = getUncollapsedMessageNodes();
  if (nodes.length <= state.keepLatest) {
    if (updateStatus) {
      updateStatusByKey("status.collapseNoNeed", "info");
    }
    return false;
  }

  const toCollapse = nodes.slice(0, nodes.length - state.keepLatest);

  // 记录第一个保留的节点作为锚点
  const firstKeptNode = nodes[nodes.length - state.keepLatest];
  state.anchorNode = firstKeptNode;
  state.anchorParent = firstKeptNode?.parentNode;

  const nextCollapsedNodes = toCollapse.map((node) => ({
    node,
    parent: node.parentNode,
    soft: true,
  }));
  state.collapsedNodes = state.isCollapsed
    ? state.collapsedNodes.concat(nextCollapsedNodes)
    : nextCollapsedNodes;

  toCollapse.forEach((node) => softCollapseMessageNode(node));

  // 清除搜索状态和高亮
  clearTextHighlights();
  clearSearchHighlight();
  state.searchQuery = "";
  state.searchMatches = [];
  state.currentMatchIndex = -1;
  const searchInput = document.getElementById("chatgpt-toolkit-search-input");
  if (searchInput) {
    searchInput.value = "";
  }
  updateSearchUI();

  state.isCollapsed = true;
  if (rememberState && conversationKey) {
    rememberConversationCollapseState(conversationKey);
  }
  if (updateStatus) {
    updateStatusByKey("status.collapseDone", "success", { count: toCollapse.length });
  }
  renderTimeline();
  return true;
};

const restoreMessages = (options = {}) => {
  const { clearRemembered = true, updateStatus = true } = options;

  ensureConversationState();
  const conversationKey = state.conversationKey;
  const memoryCleared = clearRemembered && conversationKey
    ? clearConversationCollapseMemory(conversationKey)
    : false;

  if (!state.isCollapsed) {
    if (updateStatus) {
      updateStatusByKey(
        memoryCleared ? "status.restoreMemoryCleared" : "status.restoreNone",
        memoryCleared ? "success" : "info",
      );
    }
    return false;
  }

  // 保存当前滚动位置：记录当前可见的第一个消息节点
  const visibleNodes = getMessageNodes();
  let anchorElement = null;
  let anchorOffsetTop = 0;

  if (visibleNodes.length > 0) {
    // 找到当前视口中可见的第一个消息节点（部分可见也算）
    for (const node of visibleNodes) {
      const rect = node.getBoundingClientRect();
      // 消息部分可见：底部在视口内，顶部在视口内或上方
      if (rect.bottom > 0 && rect.top < window.innerHeight) {
        anchorElement = node;
        anchorOffsetTop = rect.top;
        break;
      }
    }
    // 如果没找到，使用第一个节点
    if (!anchorElement) {
      anchorElement = visibleNodes[0];
      anchorOffsetTop = anchorElement.getBoundingClientRect().top;
    }
  }

  // 使用锚点恢复：将所有隐藏的节点按顺序插入到锚点之前
  state.collapsedNodes.forEach(({ node, parent, soft }) => {
    if (soft || isToolkitCollapsedMessageNode(node)) {
      restoreSoftCollapsedMessageNode(node);
    } else if (state.anchorNode && state.anchorParent?.contains(state.anchorNode)) {
      state.anchorParent.insertBefore(node, state.anchorNode);
    } else if (parent) {
      // 如果锚点不存在，尝试添加到原父节点
      parent.appendChild(node);
    }
  });

  // 恢复后，滚动回之前可见的消息位置
  if (anchorElement) {
    requestAnimationFrame(() => {
      const newRect = anchorElement.getBoundingClientRect();
      const scrollDelta = newRect.top - anchorOffsetTop;
      // 检测 ChatGPT 实际滚动容器（通常是 main 内的可滚动 div，而非 window）
      let scrollContainer = null;
      const scrollRoot =
        typeof resolveConversationScrollRoot === "function"
          ? resolveConversationScrollRoot()
          : null;
      if (
        scrollRoot instanceof HTMLElement &&
        !(typeof isConversationDocumentScrollRoot === "function" && isConversationDocumentScrollRoot(scrollRoot))
      ) {
        scrollContainer = scrollRoot;
      }
      if (scrollContainer) {
        scrollContainer.scrollTop += scrollDelta;
      } else {
        window.scrollBy(0, scrollDelta);
      }
    });
  }

  state.collapsedNodes = [];
  state.anchorNode = null;
  state.anchorParent = null;
  state.isCollapsed = false;
  clearCollapseMemoryReoptimizeTimer();
  if (updateStatus) {
    updateStatusByKey(
      memoryCleared ? "status.restoreDoneMemoryCleared" : "status.restoreDone",
      "success",
    );
  }
  renderTimeline();
  return true;
};
