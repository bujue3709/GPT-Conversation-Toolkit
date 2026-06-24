/*
 * ChatGPT Conversation Toolkit - Bootstrap and DOM observers
 */
if (!window[TOOLKIT_BOOTSTRAP_FLAG]) {
  window[TOOLKIT_BOOTSTRAP_FLAG] = true;

  timelineState.visible = loadTimelineVisibility();
  timelineState.manualPosition = loadTimelinePosition();
  state.isMinimized = loadToolbarMinimizedState();
  initI18n();
  observeThemeOnBodyIfNeeded();

  const TOOLKIT_ROUTE_EVENT = "__chatgptConversationToolkitRouteChange";
  const TOOLKIT_ROUTE_HOOK_FLAG = "__chatgptConversationToolkitRouteHooked";
  const OBSERVER_ROOT_SYNC_DELAY_MS = 260;
  const OBSERVER_ROOT_RETRY_LIMIT = 24;
  const OBSERVER_CONVERSATION_FLUSH_DELAY_MS = 90;
  const OBSERVER_SIDEBAR_FLUSH_DELAY_MS = 120;
  const MESSAGE_STORE_SYNC_MIN_INTERVAL_MS = 120;

  let resizeListenerAdded = false;
  let collapseMemorySyncTimer = 0;
  let refreshDispatchRafId = 0;
  let refreshNeedsFolder = false;
  let refreshNeedsTimeline = false;
  let refreshNeedsTimelinePosition = false;
  let refreshNeedsCloseFolderMenu = false;
  const isToolkitPageVisible = () =>
    document.visibilityState !== "hidden" && !document.hidden;

  const queueUiRefreshDispatch = ({
    folderRefresh = false,
    timelineRefresh = false,
    timelinePosition = false,
    closeFolderMenu: shouldCloseFolderMenu = false,
  } = {}) => {
    if (folderRefresh) {
      refreshNeedsFolder = true;
    }
    if (timelineRefresh && timelineState.visible) {
      refreshNeedsTimeline = true;
    }
    if (timelinePosition && timelineState.visible) {
      refreshNeedsTimelinePosition = true;
    }
    if (shouldCloseFolderMenu) {
      refreshNeedsCloseFolderMenu = true;
    }

    if (!isToolkitPageVisible()) {
      return;
    }

    if (refreshDispatchRafId) {
      return;
    }

    refreshDispatchRafId = requestAnimationFrame(() => {
      refreshDispatchRafId = 0;
      if (!isToolkitPageVisible()) {
        return;
      }

      const needsFolder = refreshNeedsFolder;
      const needsTimeline = refreshNeedsTimeline;
      const needsTimelinePosition = refreshNeedsTimelinePosition;
      const needsCloseFolderMenu = refreshNeedsCloseFolderMenu;

      refreshNeedsFolder = false;
      refreshNeedsTimeline = false;
      refreshNeedsTimelinePosition = false;
      refreshNeedsCloseFolderMenu = false;

      if (needsCloseFolderMenu) {
        closeFolderMenu();
      }

      if (needsTimelinePosition && timelineState.visible) {
        if (timelineState.pointerDown || timelineState.dragging) {
          timelineState.refreshPending = true;
        } else {
          updateTimelinePosition();
        }
      }

      if (needsFolder) {
        scheduleFolderRefresh();
      }

      if (needsTimeline && timelineState.visible) {
        if (timelineState.pointerDown || timelineState.dragging) {
          timelineState.refreshPending = true;
        } else {
          scheduleTimelineRefresh();
        }
      }
    });
  };

  const setupResizeListener = () => {
    if (resizeListenerAdded) {
      return;
    }
    resizeListenerAdded = true;

    window.addEventListener("resize", () => {
      const btn = document.getElementById(MINIMIZED_ID);
      if (
        btn &&
        btn.classList.contains("is-visible") &&
        !minimizedButtonState.pointerDown &&
        !minimizedButtonState.dragging
      ) {
        ensureButtonVisible(btn);
      }
      queueUiRefreshDispatch({
        timelinePosition: true,
        timelineRefresh: true,
        closeFolderMenu: true,
        folderRefresh: true,
      });
    });
  };

  setupThemeSync();
  initFolders();
  initCollapseMemory();
  attachToolbar();
  initLatexCopy();
  syncCollapseMemoryForCurrentConversation({ triggerAuto: true, forceAuto: true });
  renderTimeline();
  initQuotaReminder();
  setupResizeListener();

  let observerRafId = 0;
  let observerRootSyncTimer = 0;
  let conversationObserver = null;
  let sidebarObserver = null;
  let observedConversationRoot = null;
  let observedSidebarRoot = null;
  let observerNeedsPresenceCheck = false;
  let observerNeedsConversationSync = false;
  let observerNeedsTimelineRefresh = false;
  let observerNeedsFolderRefresh = false;
  let conversationMutationFlushTimer = 0;
  let sidebarMutationFlushTimer = 0;
  let pendingConversationMutationRefresh = false;
  let pendingSidebarMutationRefresh = false;
  let lastMessageStoreSyncAt = 0;

  const getObservedElement = (node) => {
    if (node instanceof Element) {
      return node;
    }
    if (node instanceof Text) {
      return node.parentElement;
    }
    return null;
  };

  const isToolkitMutationNode = (node) => {
    const element = getObservedElement(node);
    if (!(element instanceof Element)) {
      return false;
    }
    return Boolean(
      element.closest(
        [
          `#${TOOLKIT_ID}`,
          `#${MINIMIZED_ID}`,
          `#${TIMELINE_ID}`,
          `#${QUOTA_REMINDER_ID}`,
          `#${PROMPT_MODAL_ID}`,
          `#${FOLDER_MANAGER_ID}`,
          `#${FOLDER_MENU_ID}`,
        ].join(", "),
      ),
    );
  };

  const hasRelevantNonToolkitMutation = (mutations) =>
    mutations.some((mutation) => {
      if (!isToolkitMutationNode(mutation.target)) {
        return true;
      }
      return (
        Array.from(mutation.addedNodes).some((node) => !isToolkitMutationNode(node)) ||
        Array.from(mutation.removedNodes).some((node) => !isToolkitMutationNode(node))
      );
    });

  const queueObserverCallback = () => {
    if (!isToolkitPageVisible()) {
      return;
    }
    if (observerRafId) {
      return;
    }
    observerRafId = requestAnimationFrame(() => {
      observerRafId = 0;
      if (!isToolkitPageVisible()) {
        return;
      }

      const needsPresenceCheck = observerNeedsPresenceCheck;
      const needsConversationSync = observerNeedsConversationSync;
      const needsTimelineRefresh = observerNeedsTimelineRefresh;
      const needsFolderRefresh = observerNeedsFolderRefresh;

      observerNeedsPresenceCheck = false;
      observerNeedsConversationSync = false;
      observerNeedsTimelineRefresh = false;
      observerNeedsFolderRefresh = false;

      if (needsPresenceCheck) {
        const toolbar = document.getElementById(TOOLKIT_ID);
        const minimizedButton = document.getElementById(MINIMIZED_ID);
        const timeline = document.getElementById(TIMELINE_ID);
        const quotaReminder = document.getElementById(QUOTA_REMINDER_ID);
        const promptModal = document.getElementById(PROMPT_MODAL_ID);

        if (!toolbar) {
          attachToolbar();
        }

        if (!minimizedButton) {
          ensureMinimizedButton();
        }

        if (timelineState.visible) {
          if (!timeline) {
            renderTimeline();
          }
        } else if (timeline) {
          destroyTimeline();
        }

        if (quotaState.visible && !quotaReminder && typeof renderQuotaReminder === "function") {
          renderQuotaReminder();
        }

        if (promptState.isOpen && !promptModal) {
          const restoredModal = ensurePromptModal();
          if (restoredModal) {
            restoredModal.classList.add("is-visible");
            renderPromptList();
          }
        }

        observeThemeOnBodyIfNeeded();
      }

      if (needsConversationSync || needsTimelineRefresh) {
        ensureConversationState();
        refreshMessageStoreSnapshot({
          force: needsConversationSync,
        });
      }

      if (needsConversationSync) {
        if (!collapseMemorySyncTimer) {
          collapseMemorySyncTimer = setTimeout(() => {
            collapseMemorySyncTimer = 0;
            syncCollapseMemoryForCurrentConversation({ triggerAuto: true });
          }, 220);
        }
      }
      queueUiRefreshDispatch({
        folderRefresh: needsFolderRefresh,
        timelineRefresh: needsTimelineRefresh,
      });

      if (needsPresenceCheck) {
        syncDomAdapterHealth();
      }
    });
  };

  const markObserverWork = ({
    presenceCheck = false,
    conversationSync = false,
    timelineRefresh = false,
    folderRefresh = false,
  } = {}) => {
    if (presenceCheck) {
      observerNeedsPresenceCheck = true;
    }
    if (conversationSync) {
      observerNeedsConversationSync = true;
    }
    if (timelineRefresh && timelineState.visible) {
      observerNeedsTimelineRefresh = true;
    }
    if (folderRefresh) {
      observerNeedsFolderRefresh = true;
    }
    queueObserverCallback();
  };

  const syncDomAdapterHealth = () => {
    if (typeof runDomAdapterHealthCheck !== "function") {
      return;
    }

    runDomAdapterHealthCheck({ refreshMessages: false });
  };

  const refreshMessageStoreSnapshot = ({ force = false } = {}) => {
    if (typeof getMessageNodes !== "function") {
      return;
    }

    const now = Date.now();
    if (!force && now - lastMessageStoreSyncAt < MESSAGE_STORE_SYNC_MIN_INTERVAL_MS) {
      return;
    }

    getMessageNodes({ forceRefresh: force });
    lastMessageStoreSyncAt = now;
  };

  const resolveConversationObserverRoot = () => {
    const conversationMain =
      typeof getConversationMain === "function" ? getConversationMain() : document.querySelector("main");
    if (conversationMain instanceof HTMLElement) {
      const threadRoot = conversationMain.closest("#thread");
      if (threadRoot instanceof HTMLElement) {
        return threadRoot;
      }

      const virtualizedRoot =
        conversationMain.querySelector("[data-virtualized-list]") ||
        conversationMain.querySelector("[data-test-render-count]") ||
        conversationMain.querySelector('[data-testid*="conversation-turn"]')?.parentElement;
      if (virtualizedRoot instanceof HTMLElement) {
        return virtualizedRoot;
      }

      return conversationMain;
    }

    const scrollRoot = document.querySelector("[data-scroll-root]");
    if (scrollRoot instanceof HTMLElement) {
      const mainInsideRoot = scrollRoot.querySelector("main");
      return mainInsideRoot instanceof HTMLElement ? mainInsideRoot : scrollRoot;
    }

    return document.querySelector("main");
  };

  const resolveSidebarObserverRoot = () => {
    const history = document.querySelector("#history");
    if (history instanceof HTMLElement) {
      const navRoot = history.closest("nav[aria-label]");
      return navRoot instanceof HTMLElement ? navRoot : history;
    }

    const sidebarStage = document.getElementById("stage-slideover-sidebar");
    if (sidebarStage instanceof HTMLElement) {
      return sidebarStage;
    }

    return document.querySelector(
      'nav[aria-label], aside, [id*="sidebar"], [data-testid*="sidebar"], [class*="sidebar"]',
    );
  };

  const disconnectConversationObserver = () => {
    if (conversationObserver) {
      conversationObserver.disconnect();
      conversationObserver = null;
    }
    observedConversationRoot = null;
  };

  const disconnectSidebarObserver = () => {
    if (sidebarObserver) {
      sidebarObserver.disconnect();
      sidebarObserver = null;
    }
    observedSidebarRoot = null;
  };

  const pauseScopedObserversForHidden = () => {
    if (observerRootSyncTimer) {
      clearTimeout(observerRootSyncTimer);
      observerRootSyncTimer = 0;
    }
    if (observerRafId) {
      cancelAnimationFrame(observerRafId);
      observerRafId = 0;
    }
    disconnectConversationObserver();
    disconnectSidebarObserver();
    if (conversationMutationFlushTimer) {
      clearTimeout(conversationMutationFlushTimer);
      conversationMutationFlushTimer = 0;
    }
    if (sidebarMutationFlushTimer) {
      clearTimeout(sidebarMutationFlushTimer);
      sidebarMutationFlushTimer = 0;
    }
    pendingConversationMutationRefresh = false;
    pendingSidebarMutationRefresh = false;
  };

  const getConversationMutationElements = (mutation) => {
    const elements = [];
    const targetElement = getObservedElement(mutation?.target);
    if (targetElement instanceof Element) {
      elements.push(targetElement);
    }

    mutation?.addedNodes?.forEach((node) => {
      const element = getObservedElement(node);
      if (element instanceof Element) {
        elements.push(element);
      }
    });

    mutation?.removedNodes?.forEach((node) => {
      const element = getObservedElement(node);
      if (element instanceof Element) {
        elements.push(element);
      }
    });

    return elements;
  };

  const mutationTouchesConversationMessage = (mutation) =>
    getConversationMutationElements(mutation).some((element) => isConversationMessageElement(element));

  const queueConversationMutationRefresh = () => {
    pendingConversationMutationRefresh = true;
    if (conversationMutationFlushTimer) {
      return;
    }
    conversationMutationFlushTimer = setTimeout(() => {
      conversationMutationFlushTimer = 0;
      if (!pendingConversationMutationRefresh || !isToolkitPageVisible()) {
        pendingConversationMutationRefresh = false;
        return;
      }
      pendingConversationMutationRefresh = false;
      markObserverWork({
        conversationSync: true,
        timelineRefresh: true,
      });
    }, OBSERVER_CONVERSATION_FLUSH_DELAY_MS);
  };

  const queueSidebarMutationRefresh = () => {
    pendingSidebarMutationRefresh = true;
    if (sidebarMutationFlushTimer) {
      return;
    }
    sidebarMutationFlushTimer = setTimeout(() => {
      sidebarMutationFlushTimer = 0;
      if (!pendingSidebarMutationRefresh || !isToolkitPageVisible()) {
        pendingSidebarMutationRefresh = false;
        return;
      }
      pendingSidebarMutationRefresh = false;
      markObserverWork({
        folderRefresh: true,
      });
    }, OBSERVER_SIDEBAR_FLUSH_DELAY_MS);
  };

  const handleConversationMutations = (mutations) => {
    if (!isToolkitPageVisible()) {
      return;
    }
    if (window.__toolkitIsRendering || !hasRelevantNonToolkitMutation(mutations)) {
      return;
    }

    if (!mutations.some((mutation) => mutationTouchesConversationMessage(mutation))) {
      return;
    }
    queueConversationMutationRefresh();
  };

  const getSidebarMutationElements = (mutation) => {
    const elements = [];
    const targetElement = getObservedElement(mutation?.target);
    if (targetElement instanceof Element) {
      elements.push(targetElement);
    }

    mutation?.addedNodes?.forEach((node) => {
      const element = getObservedElement(node);
      if (element instanceof Element) {
        elements.push(element);
      }
    });

    mutation?.removedNodes?.forEach((node) => {
      const element = getObservedElement(node);
      if (element instanceof Element) {
        elements.push(element);
      }
    });

    return elements;
  };

  const hasConversationNodeSignature = (element) =>
    Boolean(
      element.matches?.('a[data-sidebar-item="true"][href*="/c/"]') ||
      element.querySelector?.('a[data-sidebar-item="true"][href*="/c/"]') ||
      element.matches?.("[data-conversation-options-trigger]") ||
      element.querySelector?.("[data-conversation-options-trigger]"),
    );

  const hasChatSectionSignature = (element) =>
    Boolean(
      element.id === "history" ||
      element.closest?.("#history") ||
      element.matches?.(".group\\/sidebar-expando-section") ||
      element.closest?.(".group\\/sidebar-expando-section"),
    );

  const mutationTouchesFolderSidebarArea = (mutation) =>
    getSidebarMutationElements(mutation).some(
      (element) => hasConversationNodeSignature(element) || hasChatSectionSignature(element),
    );

  const handleSidebarMutations = (mutations) => {
    if (!isToolkitPageVisible()) {
      return;
    }
    if (window.__toolkitIsRendering || !hasRelevantNonToolkitMutation(mutations)) {
      return;
    }
    if (!mutations.some((mutation) => mutationTouchesFolderSidebarArea(mutation))) {
      return;
    }
    queueSidebarMutationRefresh();
  };

  const syncScopedObservers = ({ forcePresenceCheck = false, retriesRemaining = 0 } = {}) => {
    if (!isToolkitPageVisible()) {
      pauseScopedObserversForHidden();
      return;
    }

    if (observerRootSyncTimer) {
      clearTimeout(observerRootSyncTimer);
      observerRootSyncTimer = 0;
    }

    const nextConversationRoot = resolveConversationObserverRoot();
    const nextSidebarRoot = resolveSidebarObserverRoot();
    const conversationRootChanged = observedConversationRoot !== nextConversationRoot;
    const sidebarRootChanged = observedSidebarRoot !== nextSidebarRoot;

    if (conversationRootChanged) {
      disconnectConversationObserver();
      if (nextConversationRoot instanceof HTMLElement) {
        conversationObserver = new MutationObserver(handleConversationMutations);
        conversationObserver.observe(nextConversationRoot, {
          childList: true,
          subtree: true,
        });
        observedConversationRoot = nextConversationRoot;
      }
    }

    if (sidebarRootChanged) {
      disconnectSidebarObserver();
      if (nextSidebarRoot instanceof HTMLElement) {
        sidebarObserver = new MutationObserver(handleSidebarMutations);
        sidebarObserver.observe(nextSidebarRoot, {
          childList: true,
          subtree: true,
        });
        observedSidebarRoot = nextSidebarRoot;
      }
    }

    if (forcePresenceCheck || conversationRootChanged || sidebarRootChanged) {
      markObserverWork({
        presenceCheck: true,
        conversationSync: forcePresenceCheck || conversationRootChanged,
        timelineRefresh: forcePresenceCheck || conversationRootChanged,
        folderRefresh: forcePresenceCheck || sidebarRootChanged,
      });
      syncDomAdapterHealth();
    }

    const missingRoot =
      !(nextConversationRoot instanceof HTMLElement) ||
      !(nextSidebarRoot instanceof HTMLElement);

    if (!missingRoot || retriesRemaining <= 0) {
      return;
    }

    observerRootSyncTimer = setTimeout(() => {
      observerRootSyncTimer = 0;
      syncScopedObservers({
        forcePresenceCheck: true,
        retriesRemaining: retriesRemaining - 1,
      });
    }, OBSERVER_ROOT_SYNC_DELAY_MS);
  };

  const installRouteChangeHooks = () => {
    if (window[TOOLKIT_ROUTE_HOOK_FLAG]) {
      return;
    }
    window[TOOLKIT_ROUTE_HOOK_FLAG] = true;

    const emitRouteChange = () => {
      window.dispatchEvent(new Event(TOOLKIT_ROUTE_EVENT));
    };

    const patchHistoryMethod = (methodName) => {
      const originalMethod = history[methodName];
      if (typeof originalMethod !== "function") {
        return;
      }
      history[methodName] = function patchedHistoryMethod(...args) {
        const result = originalMethod.apply(this, args);
        emitRouteChange();
        return result;
      };
    };

    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");

    window.addEventListener("popstate", emitRouteChange, { passive: true });
    window.addEventListener("hashchange", emitRouteChange, { passive: true });

    window.addEventListener(TOOLKIT_ROUTE_EVENT, () => {
      syncScopedObservers({
        forcePresenceCheck: true,
        retriesRemaining: OBSERVER_ROOT_RETRY_LIMIT,
      });
    });

    window.addEventListener("focus", () => {
      syncScopedObservers({
        forcePresenceCheck: true,
        retriesRemaining: 4,
      });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        pauseScopedObserversForHidden();
        if (typeof setTimelineScrollListenerEnabled === "function") {
          setTimelineScrollListenerEnabled(false);
        }
        if (typeof clearTimelineRefreshTimer === "function") {
          clearTimelineRefreshTimer();
        }
        return;
      }

      syncScopedObservers({
        forcePresenceCheck: true,
        retriesRemaining: 4,
      });
      queueObserverCallback();
      queueUiRefreshDispatch({
        timelinePosition: true,
        timelineRefresh: true,
        closeFolderMenu: true,
        folderRefresh: true,
      });
    });
  };

  installRouteChangeHooks();
  syncScopedObservers({
    forcePresenceCheck: true,
    retriesRemaining: OBSERVER_ROOT_RETRY_LIMIT,
  });
}
