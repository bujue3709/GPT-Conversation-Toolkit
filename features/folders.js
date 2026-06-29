/*
 * ChatGPT Conversation Toolkit - Conversation folders
 */
const FOLDER_ITEM_ATTR = "data-toolkit-folder-id";
const FOLDER_COLLAPSED_ATTR = "data-toolkit-folder-collapsed";
const FOLDER_HIGHLIGHT_ATTR = "data-toolkit-folder-highlight";
const FOLDER_THEME_TARGET_ATTR = "data-toolkit-theme-target";
const FOLDER_DROPZONE_ATTR = "data-toolkit-folder-dropzone";
const FOLDER_BOUND_ATTR = "data-toolkit-folder-bound";
const FOLDER_MANAGER_BOUND_ATTR = "data-toolkit-folder-manager-bound";
const FOLDER_NATIVE_LIST_ATTR = "data-toolkit-folder-native-list";
const FOLDER_CONVERSATION_DRAG_ATTR = "data-toolkit-folder-draggable";
const FOLDER_CONVERSATION_PREVIOUS_DRAGGABLE_ATTR = "data-toolkit-folder-previous-draggable";
const FOLDER_HEADER_CLASS = "chatgpt-toolkit-folder-header";
const FOLDER_EMPTY_CLASS = "chatgpt-toolkit-folder-empty";
const FOLDER_DRAGGING_ATTR = "data-toolkit-folder-dragging";
const FOLDER_SORTING_ATTR = "data-toolkit-folder-sorting";
const FOLDER_MISSING_SECTION_RETRY_LIMIT = 120;
const FOLDER_MISSING_SECTION_RETRY_DELAY_MS = 180;
const FOLDER_MISSING_SECTION_RETRY_SLOW_DELAY_MS = 520;
const FOLDER_MISSING_SECTION_RETRY_HIDDEN_DELAY_MS = 2000;
const FOLDER_CONVERSATION_DRAG_BLOCK_SELECTOR =
  "button, input, textarea, select, option, [role='button'], [data-trailing-button], [data-folder-action], [contenteditable='true']";
const FOLDER_POINTER_DRAG_GUARD_MS = 1200;

let folderPointerDownDragBlocked = false;
let folderPointerDownConversationId = "";
let folderPointerDownAt = 0;

const getSafeEventTarget = (event) => (event?.target instanceof Element ? event.target : null);

const withFolderRenderLock = (callback) => {
  const previousValue = Boolean(window.__toolkitIsRendering);
  window.__toolkitIsRendering = true;
  try {
    callback();
  } finally {
    window.__toolkitIsRendering = previousValue;
  }
};

const createFolderId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `folder-${crypto.randomUUID()}`;
  }
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeFolderName = (value, fallbackIndex = 1) => {
  const nextName = typeof value === "string" ? value.trim() : "";
  return nextName || t("folder.defaultName", { index: fallbackIndex });
};

const getSortedFolders = () =>
  [...folderState.folders].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.createdAt - right.createdAt;
  });

const normalizeFolderSnapshot = (snapshot) => {
  const rawFolders = Array.isArray(snapshot?.folders) ? snapshot.folders : [];
  const folders = rawFolders
    .map((folder, index) => {
      if (!folder || typeof folder !== "object") {
        return null;
      }

      const id = typeof folder.id === "string" ? folder.id.trim() : "";
      if (!id) {
        return null;
      }

      const orderValue = Number(folder.order);
      const createdAtValue = Number(folder.createdAt);

      return {
        id,
        name: normalizeFolderName(folder.name, index + 1),
        collapsed: Boolean(folder.collapsed),
        order: Number.isFinite(orderValue) ? orderValue : index,
        createdAt: Number.isFinite(createdAtValue) ? createdAtValue : Date.now() + index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.createdAt - right.createdAt;
    });

  folders.forEach((folder, index) => {
    folder.order = index;
  });

  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const rawAssignments = snapshot?.assignments && typeof snapshot.assignments === "object" ? snapshot.assignments : {};
  const assignments = {};

  Object.entries(rawAssignments).forEach(([conversationId, folderId]) => {
    if (
      typeof conversationId === "string" &&
      conversationId &&
      typeof folderId === "string" &&
      validFolderIds.has(folderId)
    ) {
      assignments[conversationId] = folderId;
    }
  });

  const rawItemOrders = snapshot?.itemOrders && typeof snapshot.itemOrders === "object"
    ? snapshot.itemOrders
    : {};
  const itemOrders = {};

  folders.forEach((folder) => {
    const rawOrder = Array.isArray(rawItemOrders[folder.id]) ? rawItemOrders[folder.id] : [];
    const nextOrder = [];
    const seenConversationIds = new Set();

    rawOrder.forEach((conversationId) => {
      if (
        typeof conversationId === "string" &&
        conversationId &&
        assignments[conversationId] === folder.id &&
        !seenConversationIds.has(conversationId)
      ) {
        seenConversationIds.add(conversationId);
        nextOrder.push(conversationId);
      }
    });

    if (nextOrder.length > 0) {
      itemOrders[folder.id] = nextOrder;
    }
  });

  return {
    version: 2,
    folders,
    assignments,
    itemOrders,
  };
};

const buildFolderSnapshot = () => {
  const folderIds = new Set(folderState.folders.map((folder) => folder.id));
  const assignments = {};

  Object.entries(folderState.assignments).forEach(([conversationId, folderId]) => {
    if (typeof conversationId === "string" && conversationId && folderIds.has(folderId)) {
      assignments[conversationId] = folderId;
    }
  });

  const itemOrders = {};
  Object.entries(folderState.itemOrders || {}).forEach(([folderId, conversationIds]) => {
    if (!folderIds.has(folderId) || !Array.isArray(conversationIds)) {
      return;
    }

    const nextOrder = [];
    const seenConversationIds = new Set();
    conversationIds.forEach((conversationId) => {
      if (
        typeof conversationId === "string" &&
        conversationId &&
        assignments[conversationId] === folderId &&
        !seenConversationIds.has(conversationId)
      ) {
        seenConversationIds.add(conversationId);
        nextOrder.push(conversationId);
      }
    });

    if (nextOrder.length > 0) {
      itemOrders[folderId] = nextOrder;
    }
  });

  return {
    version: 2,
    folders: getSortedFolders().map((folder, index) => ({
      id: folder.id,
      name: folder.name,
      collapsed: folder.collapsed,
      order: index,
      createdAt: folder.createdAt,
    })),
    assignments,
    itemOrders,
  };
};

const setFolderSnapshot = (snapshot) => {
  const normalized = normalizeFolderSnapshot(snapshot);
  folderState.folders = normalized.folders;
  folderState.assignments = normalized.assignments;
  folderState.itemOrders = normalized.itemOrders;
  folderState.loaded = true;
  return normalized;
};

const persistFolderState = () => {
  if (!folderState.loaded) {
    return;
  }
  saveFolderSnapshot(buildFolderSnapshot());
};

const hydrateFolders = () => {
  if (folderState.loaded) {
    return;
  }
  setFolderSnapshot(loadFolderSnapshot());
};

const hydrateFoldersFromExtension = async () => {
  const extensionSnapshot = await loadFolderSnapshotFromExtension();
  if (!extensionSnapshot) {
    return;
  }

  const currentSerialized = JSON.stringify(buildFolderSnapshot());
  const nextNormalized = normalizeFolderSnapshot(extensionSnapshot);
  const nextSerialized = JSON.stringify(nextNormalized);

  if (currentSerialized === nextSerialized) {
    return;
  }

  setFolderSnapshot(nextNormalized);
  persistFolderState();
  scheduleFolderRefresh();
};

const findDirectSectionChild = (section, element) => {
  if (!(section instanceof HTMLElement) || !(element instanceof HTMLElement)) {
    return null;
  }

  let current = element;
  while (current instanceof HTMLElement && current.parentElement !== section) {
    current = current.parentElement;
  }

  return current instanceof HTMLElement && current.parentElement === section ? current : null;
};

const findFolderHistoryRoot = (section) => {
  if (section instanceof HTMLElement) {
    const sectionHistory = section.querySelector("#history");
    if (sectionHistory instanceof HTMLElement) {
      return sectionHistory;
    }
  }

  const fallbackHistory = document.querySelector('nav[aria-label] #history, #history');
  return fallbackHistory instanceof HTMLElement ? fallbackHistory : null;
};

const findFolderHeaderButton = (section, history = null) => {
  if (!(section instanceof HTMLElement)) {
    return null;
  }

  const resolvedHistory = history instanceof HTMLElement ? history : findFolderHistoryRoot(section);
  const historyDirectChild = findDirectSectionChild(section, resolvedHistory);
  const sectionChildren = Array.from(section.children).filter((child) => child instanceof HTMLElement);
  const historyIndex = historyDirectChild instanceof HTMLElement ? sectionChildren.indexOf(historyDirectChild) : -1;

  const headingButtons = Array.from(section.querySelectorAll("button")).filter(
    (button) => button.querySelector("h2.__menu-label") instanceof HTMLElement,
  );
  if (headingButtons.length > 0) {
    if (historyIndex >= 0) {
      let nearestButton = null;
      let nearestIndex = -1;
      headingButtons.forEach((button) => {
        const directChild = findDirectSectionChild(section, button);
        if (!(directChild instanceof HTMLElement)) {
          return;
        }

        const index = sectionChildren.indexOf(directChild);
        if (index >= 0 && index <= historyIndex && index >= nearestIndex) {
          nearestButton = button;
          nearestIndex = index;
        }
      });

      if (nearestButton instanceof HTMLElement) {
        return nearestButton;
      }
    }

    return headingButtons[0];
  }

  const previousSibling = resolvedHistory?.previousElementSibling;
  if (!(previousSibling instanceof HTMLElement)) {
    return null;
  }

  if (previousSibling instanceof HTMLButtonElement) {
    return previousSibling;
  }

  const nestedButton = previousSibling.querySelector("button");
  return nestedButton instanceof HTMLElement ? nestedButton : null;
};

const findFolderAnchor = () => {
  const existingManager = document.getElementById(FOLDER_MANAGER_ID);
  if (existingManager instanceof HTMLElement) {
    const existingSection = existingManager.parentElement;
    const existingHistory = findFolderHistoryRoot(existingSection);
    if (existingSection instanceof HTMLElement && existingHistory instanceof HTMLElement) {
      return {
        section: existingSection,
        headerButton: findFolderHeaderButton(existingSection, existingHistory),
        history: existingHistory,
      };
    }
  }

  const history = findFolderHistoryRoot();
  if (history instanceof HTMLElement) {
    const directSection =
      history.closest(".group\\/sidebar-expando-section") ||
      history.closest("section") ||
      history.parentElement;
    if (directSection instanceof HTMLElement) {
      return {
        section: directSection,
        headerButton: findFolderHeaderButton(directSection, history),
        history,
      };
    }
  }

  const navCandidates = Array.from(
    document.querySelectorAll('nav[aria-label], aside, [id*="sidebar"], [data-testid*="sidebar"]'),
  ).filter((node) => node instanceof HTMLElement);
  for (const nav of navCandidates) {
    const navHistory = findFolderHistoryRoot(nav);
    if (!(navHistory instanceof HTMLElement)) {
      continue;
    }
    const section =
      navHistory.closest(".group\\/sidebar-expando-section") ||
      navHistory.closest("section") ||
      navHistory.parentElement;
    if (!(section instanceof HTMLElement)) {
      continue;
    }
    return {
      section,
      headerButton: findFolderHeaderButton(section, navHistory),
      history: navHistory,
    };
  }

  return null;
};

const findHistoryContainer = (section) => findFolderHistoryRoot(section);

const findChatHistorySection = () => {
  const anchor = findFolderAnchor();
  if (!anchor) {
    return null;
  }

  const history = anchor.history instanceof HTMLElement ? anchor.history : findHistoryContainer(anchor.section);
  if (!(history instanceof HTMLElement)) {
    return null;
  }

  const section = anchor.section;
  const fallbackHeaderButton = anchor.headerButton;

  if (!(section instanceof HTMLElement)) {
    return {
      history,
      section: history.parentElement instanceof HTMLElement ? history.parentElement : history,
      headerButton: fallbackHeaderButton instanceof HTMLElement ? fallbackHeaderButton : null,
    };
  }

  const headerButton = findFolderHeaderButton(section, history) || fallbackHeaderButton;

  return {
    history,
    section,
    headerButton: headerButton instanceof HTMLElement ? headerButton : null,
  };
};

const getConversationItems = (history) =>
  !(history instanceof HTMLElement)
    ? []
    : Array.from(history.querySelectorAll('a[data-sidebar-item="true"][href*="/c/"]')).filter((item) => {
        if (!(item instanceof HTMLAnchorElement) || !history.contains(item)) {
          return false;
        }
        return getConversationPresentationNode(item, history) instanceof HTMLElement;
      });

const getNativeConversationList = (history) => {
  if (!(history instanceof HTMLElement)) {
    return null;
  }

  return (
    Array.from(history.children).find((child) => {
      if (
        !(child instanceof HTMLElement) ||
        child.classList.contains(FOLDER_HEADER_CLASS) ||
        child.classList.contains(FOLDER_EMPTY_CLASS)
      ) {
        return false;
      }
      return child.querySelector('a[data-sidebar-item="true"][href*="/c/"]') instanceof HTMLAnchorElement;
    }) || null
  );
};

const getConversationPresentationNode = (item, history = folderState.history) => {
  if (!(item instanceof HTMLAnchorElement) || !(history instanceof HTMLElement) || !history.contains(item)) {
    return null;
  }

  const nativeList = getNativeConversationList(history);
  if (nativeList instanceof HTMLElement && nativeList.contains(item)) {
    let node = item;
    while (node instanceof HTMLElement && node.parentElement !== nativeList) {
      node = node.parentElement;
    }
    if (node instanceof HTMLElement && node.parentElement === nativeList) {
      return node;
    }
  }

  return item.parentElement === history ? item : null;
};

const getConversationAnchorFromNode = (node, history = folderState.history) => {
  if (!(node instanceof HTMLElement) || !(history instanceof HTMLElement)) {
    return null;
  }

  if (node instanceof HTMLAnchorElement) {
    return getConversationPresentationNode(node, history) instanceof HTMLElement ? node : null;
  }

  const item =
    node.querySelector(':scope > a[data-sidebar-item="true"][href*="/c/"]') ||
    node.querySelector('a[data-sidebar-item="true"][href*="/c/"]');
  if (!(item instanceof HTMLAnchorElement)) {
    return null;
  }

  return getConversationPresentationNode(item, history) === node ? item : null;
};

const getConversationFolderId = (item) => {
  if (!(item instanceof HTMLElement)) {
    return "";
  }

  const presentationNode = getConversationPresentationNode(item);
  return (
    presentationNode?.getAttribute(FOLDER_ITEM_ATTR) ||
    item.getAttribute(FOLDER_ITEM_ATTR) ||
    ""
  );
};

const isConversationPresentationNode = (node, history = folderState.history) =>
  getConversationAnchorFromNode(node, history) instanceof HTMLAnchorElement;

const getConversationItemFromTarget = (target) => {
  if (!(target instanceof Element) || !(folderState.history instanceof HTMLElement)) {
    return null;
  }

  const item = target.closest('a[data-sidebar-item="true"][href*="/c/"]');
  if (
    !(item instanceof HTMLAnchorElement) ||
    !folderState.history.contains(item) ||
    !(getConversationPresentationNode(item) instanceof HTMLElement)
  ) {
    return null;
  }

  return item;
};

const isConversationDragBlockedTarget = (target, conversationItem = null) => {
  if (!(target instanceof Element)) {
    return false;
  }

  const blockedTarget = target.closest(FOLDER_CONVERSATION_DRAG_BLOCK_SELECTOR);
  if (!(blockedTarget instanceof Element)) {
    return false;
  }

  if (conversationItem instanceof HTMLAnchorElement) {
    return conversationItem.contains(blockedTarget);
  }

  return getConversationItemFromTarget(target) instanceof HTMLAnchorElement;
};

const syncConversationDragAttributes = (item) => {
  if (!(item instanceof HTMLAnchorElement)) {
    return;
  }

  if (!item.hasAttribute(FOLDER_CONVERSATION_DRAG_ATTR)) {
    item.setAttribute(
      FOLDER_CONVERSATION_PREVIOUS_DRAGGABLE_ATTR,
      item.hasAttribute("draggable") ? item.getAttribute("draggable") || "" : "",
    );
    item.setAttribute(FOLDER_CONVERSATION_DRAG_ATTR, "1");
  }

  if (item.getAttribute("draggable") !== "true") {
    item.setAttribute("draggable", "true");
  }

  item.querySelectorAll(FOLDER_CONVERSATION_DRAG_BLOCK_SELECTOR).forEach((node) => {
    if (node instanceof HTMLElement && node.getAttribute("draggable") !== "false") {
      node.setAttribute("draggable", "false");
    }
  });
};

const clearConversationDragAttributes = (item) => {
  if (!(item instanceof HTMLAnchorElement) || !item.hasAttribute(FOLDER_CONVERSATION_DRAG_ATTR)) {
    return;
  }

  const previousDraggable = item.getAttribute(FOLDER_CONVERSATION_PREVIOUS_DRAGGABLE_ATTR);
  if (previousDraggable === null || previousDraggable === "") {
    item.removeAttribute("draggable");
  } else {
    item.setAttribute("draggable", previousDraggable);
  }
  item.removeAttribute(FOLDER_CONVERSATION_DRAG_ATTR);
  item.removeAttribute(FOLDER_CONVERSATION_PREVIOUS_DRAGGABLE_ATTR);
};

const trackFolderPointerDownDragGuard = (event) => {
  const target = getSafeEventTarget(event);
  const conversationItem = getConversationItemFromTarget(target);
  if (conversationItem instanceof HTMLAnchorElement) {
    syncConversationDragAttributes(conversationItem);
  }
  folderPointerDownAt = Date.now();
  folderPointerDownConversationId =
    conversationItem instanceof HTMLAnchorElement ? getConversationIdFromItem(conversationItem) : "";
  folderPointerDownDragBlocked =
    conversationItem instanceof HTMLAnchorElement && isConversationDragBlockedTarget(target, conversationItem);
};

const shouldBlockConversationDragStart = (event, conversationItem) => {
  if (!(conversationItem instanceof HTMLAnchorElement)) {
    return true;
  }

  const target = getSafeEventTarget(event);
  if (isConversationDragBlockedTarget(target, conversationItem)) {
    return true;
  }

  const conversationId = getConversationIdFromItem(conversationItem);
  return (
    folderPointerDownDragBlocked &&
    conversationId &&
    folderPointerDownConversationId === conversationId &&
    Date.now() - folderPointerDownAt <= FOLDER_POINTER_DRAG_GUARD_MS
  );
};

const getConversationIdFromItem = (item) => {
  if (!(item instanceof HTMLElement)) {
    return "";
  }

  const href = item.getAttribute("href") || "";
  const matched = href.match(/\/c\/([^/?#]+)/);
  if (matched?.[1]) {
    return matched[1];
  }

  const optionsTrigger = item.querySelector("[data-conversation-options-trigger]");
  return optionsTrigger?.getAttribute("data-conversation-options-trigger") || "";
};

const getVisibleRect = (node) => {
  if (!(node instanceof HTMLElement)) {
    return null;
  }

  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return rect;
};

const getFolderHistoryChildren = () =>
  !(folderState.history instanceof HTMLElement)
    ? []
    : Array.from(folderState.history.children).filter((child) => child instanceof HTMLElement);

const getFolderFlowNodes = () => {
  if (!(folderState.history instanceof HTMLElement)) {
    return [];
  }

  const nativeList = getNativeConversationList(folderState.history);
  const directChildren = getFolderHistoryChildren().filter((child) => child !== nativeList);
  const conversationNodes = [];
  const seenNodes = new Set();

  getConversationItems(folderState.history).forEach((item) => {
    const node = getConversationPresentationNode(item, folderState.history);
    if (!(node instanceof HTMLElement) || seenNodes.has(node)) {
      return;
    }
    seenNodes.add(node);
    conversationNodes.push(node);
  });

  return [...directChildren, ...conversationNodes].sort((left, right) => {
    const leftOrder = Number(left.style.order);
    const rightOrder = Number(right.style.order);
    const normalizedLeftOrder = Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER;
    const normalizedRightOrder = Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER;
    if (normalizedLeftOrder !== normalizedRightOrder) {
      return normalizedLeftOrder - normalizedRightOrder;
    }

    if (left === right) {
      return 0;
    }

    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
};

const isPointInsideRect = (clientX, clientY, rect, padding = 0) => {
  if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return false;
  }

  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
};

const getFolderById = (folderId) =>
  folderState.folders.find((folder) => folder.id === folderId) || null;

const getStoredFolderConversationIds = (folderId) =>
  Array.isArray(folderState.itemOrders?.[folderId])
    ? folderState.itemOrders[folderId].filter((conversationId) => typeof conversationId === "string" && conversationId)
    : [];

const setStoredFolderConversationIds = (folderId, conversationIds) => {
  if (!folderId) {
    return;
  }

  const nextOrder = [];
  const seenConversationIds = new Set();
  (Array.isArray(conversationIds) ? conversationIds : []).forEach((conversationId) => {
    if (
      typeof conversationId === "string" &&
      conversationId &&
      !seenConversationIds.has(conversationId)
    ) {
      seenConversationIds.add(conversationId);
      nextOrder.push(conversationId);
    }
  });

  if (nextOrder.length === 0) {
    delete folderState.itemOrders[folderId];
    return;
  }

  folderState.itemOrders[folderId] = nextOrder;
};

const removeConversationFromFolderOrders = (conversationId, folderId = "") => {
  if (!conversationId) {
    return false;
  }

  const targetFolderIds = folderId ? [folderId] : Object.keys(folderState.itemOrders || {});
  let changed = false;

  targetFolderIds.forEach((currentFolderId) => {
    const storedOrder = getStoredFolderConversationIds(currentFolderId);
    if (storedOrder.length === 0 || !storedOrder.includes(conversationId)) {
      return;
    }

    const nextOrder = storedOrder.filter((currentConversationId) => currentConversationId !== conversationId);
    setStoredFolderConversationIds(currentFolderId, nextOrder);
    changed = true;
  });

  return changed;
};

const getAssignedConversationIdsForFolder = (folderId) =>
  Object.entries(folderState.assignments)
    .filter(([, assignedFolderId]) => assignedFolderId === folderId)
    .map(([conversationId]) => conversationId);

const getCurrentFolderConversationIds = (folderId) => {
  const assignedConversationIds = getAssignedConversationIdsForFolder(folderId);
  if (assignedConversationIds.length === 0) {
    return [];
  }

  const assignedConversationIdSet = new Set(assignedConversationIds);
  const orderedConversationIds = [];
  const seenConversationIds = new Set();

  if (folderState.history instanceof HTMLElement) {
    getConversationItems(folderState.history)
      .map((item, index) => {
        const conversationId = getConversationIdFromItem(item);
        const presentationNode = getConversationPresentationNode(item, folderState.history);
        const orderValue = Number(presentationNode?.style.order);
        return {
          conversationId,
          item: presentationNode || item,
          index,
          order: Number.isFinite(orderValue) ? orderValue : Number.MAX_SAFE_INTEGER,
        };
      })
      .filter(({ conversationId }) => conversationId && assignedConversationIdSet.has(conversationId))
      .sort((left, right) => {
        if (left.order !== right.order) {
          return left.order - right.order;
        }
        return left.index - right.index;
      })
      .forEach(({ conversationId }) => {
        if (seenConversationIds.has(conversationId)) {
          return;
        }
        seenConversationIds.add(conversationId);
        orderedConversationIds.push(conversationId);
      });
  }

  getStoredFolderConversationIds(folderId).forEach((conversationId) => {
    if (!assignedConversationIdSet.has(conversationId) || seenConversationIds.has(conversationId)) {
      return;
    }
    seenConversationIds.add(conversationId);
    orderedConversationIds.push(conversationId);
  });

  assignedConversationIds.forEach((conversationId) => {
    if (seenConversationIds.has(conversationId)) {
      return;
    }
    seenConversationIds.add(conversationId);
    orderedConversationIds.push(conversationId);
  });

  return orderedConversationIds;
};

const getRenderableFolderConversationIds = (folderId, fallbackConversationIds = []) => {
  const validConversationIds = new Set(
    (Array.isArray(fallbackConversationIds) ? fallbackConversationIds : []).filter(
      (conversationId) => typeof conversationId === "string" && conversationId,
    ),
  );

  const orderedConversationIds = [];
  const seenConversationIds = new Set();

  getStoredFolderConversationIds(folderId).forEach((conversationId) => {
    if (!validConversationIds.has(conversationId) || seenConversationIds.has(conversationId)) {
      return;
    }
    seenConversationIds.add(conversationId);
    orderedConversationIds.push(conversationId);
  });

  validConversationIds.forEach((conversationId) => {
    if (seenConversationIds.has(conversationId)) {
      return;
    }
    seenConversationIds.add(conversationId);
    orderedConversationIds.push(conversationId);
  });

  return orderedConversationIds;
};

const orderConversationItemsForFolder = (folderId, items) => {
  if (!Array.isArray(items) || items.length <= 1) {
    return items || [];
  }

  const itemsByConversationId = new Map();
  const fallbackItems = [];

  items.forEach((item) => {
    const conversationId = getConversationIdFromItem(item);
    if (!conversationId || itemsByConversationId.has(conversationId)) {
      fallbackItems.push(item);
      return;
    }
    itemsByConversationId.set(conversationId, item);
  });

  const fallbackConversationIds = items
    .map((item) => getConversationIdFromItem(item))
    .filter((conversationId, index, array) => conversationId && array.indexOf(conversationId) === index);
  const orderedConversationIds = getRenderableFolderConversationIds(folderId, fallbackConversationIds);
  const orderedItems = [];
  const usedConversationIds = new Set();

  orderedConversationIds.forEach((conversationId) => {
    const item = itemsByConversationId.get(conversationId);
    if (!(item instanceof HTMLAnchorElement)) {
      return;
    }
    usedConversationIds.add(conversationId);
    orderedItems.push(item);
  });

  items.forEach((item) => {
    const conversationId = getConversationIdFromItem(item);
    if (conversationId && usedConversationIds.has(conversationId)) {
      return;
    }
    orderedItems.push(item);
  });

  fallbackItems.forEach((item) => {
    if (!orderedItems.includes(item)) {
      orderedItems.push(item);
    }
  });

  return orderedItems;
};

const getNextFolderName = () => t("folder.defaultName", { index: folderState.folders.length + 1 });

const closeFolderMenu = () => {
  const menu = document.getElementById(FOLDER_MENU_ID);
  if (!(menu instanceof HTMLElement)) {
    folderState.menuFolderId = null;
    return;
  }

  folderState.menuFolderId = null;
  menu.classList.remove("is-visible");
  menu.style.left = "";
  menu.style.top = "";
};

const ensureFolderMenu = () => {
  let menu = document.getElementById(FOLDER_MENU_ID);
  if (menu instanceof HTMLElement) {
    return menu;
  }

  menu = document.createElement("div");
  menu.id = FOLDER_MENU_ID;
  menu.className = "chatgpt-toolkit-folder-menu";
  menu.setAttribute(FOLDER_THEME_TARGET_ATTR, "folders");
  menu.innerHTML = `
    <button type="button" data-folder-menu-action="rename">${t("folder.menuRename")}</button>
    <button type="button" data-folder-menu-action="delete">${t("folder.menuDelete")}</button>
  `;
  menu.addEventListener("click", (event) => {
    const target = getSafeEventTarget(event);
    if (!(target instanceof Element)) {
      return;
    }

    const actionButton = target.closest("[data-folder-menu-action]");
    if (!(actionButton instanceof HTMLButtonElement)) {
      return;
    }

    const folderId = folderState.menuFolderId;
    closeFolderMenu();

    if (!folderId) {
      return;
    }

    if (actionButton.dataset.folderMenuAction === "rename") {
      renameFolder(folderId);
      return;
    }

    if (actionButton.dataset.folderMenuAction === "delete") {
      deleteFolder(folderId);
    }
  });
  document.body.appendChild(menu);
  return menu;
};

const openFolderMenu = (folderId, trigger) => {
  if (!(trigger instanceof HTMLElement)) {
    return;
  }

  const folder = getFolderById(folderId);
  if (!folder) {
    closeFolderMenu();
    return;
  }

  const menu = ensureFolderMenu();
  if (folderState.menuFolderId === folderId && menu.classList.contains("is-visible")) {
    closeFolderMenu();
    return;
  }

  folderState.menuFolderId = folderId;
  menu.classList.add("is-visible");
  syncToolkitTheme();

  const triggerRect = trigger.getBoundingClientRect();
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const sidebarAnchor =
    folderState.section instanceof HTMLElement
      ? folderState.section.getBoundingClientRect()
      : folderState.history instanceof HTMLElement
        ? folderState.history.getBoundingClientRect()
        : triggerRect;

  let left = sidebarAnchor.right + 8;
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(triggerRect.right + 8, window.innerWidth - menuWidth - 8);
  }
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuWidth - 8);
  }

  let top = triggerRect.bottom + 6;
  if (top + menuHeight > window.innerHeight - 8) {
    top = Math.max(8, triggerRect.top - menuHeight - 6);
  }

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
};

const clearDropZoneHighlight = () => {
  if (!(folderState.history instanceof HTMLElement)) {
    folderState.currentDropZoneKey = "";
    return;
  }

  folderState.currentDropZoneKey = "";

  const manager = document.getElementById(FOLDER_MANAGER_ID);
  manager
    ?.querySelectorAll(".is-drop-target, .is-drop-target-before, .is-drop-target-after")
    .forEach((node) => {
      node.classList.remove("is-drop-target");
      node.classList.remove("is-drop-target-before");
      node.classList.remove("is-drop-target-after");
    });

  folderState.history
    .querySelectorAll(".is-drop-target, .is-drop-target-before, .is-drop-target-after")
    .forEach((node) => {
      node.classList.remove("is-drop-target");
      node.classList.remove("is-drop-target-before");
      node.classList.remove("is-drop-target-after");
    });
};

const clearFolderSortHighlight = () => {
  if (!(folderState.history instanceof HTMLElement)) {
    folderState.currentSortZoneKey = "";
    document.documentElement.removeAttribute(FOLDER_SORTING_ATTR);
    return;
  }

  folderState.currentSortZoneKey = "";
  document.documentElement.removeAttribute(FOLDER_SORTING_ATTR);
  folderState.history
    .querySelectorAll(".is-sort-target-before, .is-sort-target-after, .is-sort-dragging")
    .forEach((node) => {
      node.classList.remove("is-sort-target-before");
      node.classList.remove("is-sort-target-after");
      node.classList.remove("is-sort-dragging");
    });
};

const buildConversationDropLayout = () => {
  const manager = document.getElementById(FOLDER_MANAGER_ID);
  const draggedConversationId = folderState.draggingConversationId || "";
  const ungroupedButton =
    manager?.querySelector?.('[data-folder-action="show-ungrouped"]') instanceof HTMLButtonElement
      ? manager.querySelector('[data-folder-action="show-ungrouped"]')
      : null;
  const ungroupedButtonRect = getVisibleRect(ungroupedButton);

  if (!(folderState.history instanceof HTMLElement)) {
    return null;
  }

  const historyRect = folderState.history.getBoundingClientRect();
  const flowNodes = getFolderFlowNodes();
  const sortedFolders = getSortedFolders();
  const firstUngroupedItem = flowNodes.find(
    (child) => isConversationPresentationNode(child, folderState.history) && !child.hasAttribute(FOLDER_ITEM_ATTR),
  );
  const firstUngroupedRect = getVisibleRect(firstUngroupedItem);
  const fallbackBottomBoundary = firstUngroupedRect ? firstUngroupedRect.top : historyRect.bottom;

  const folderZones = sortedFolders
    .map((folder, index) => {
      const header = flowNodes.find(
        (child) =>
          child.classList.contains(FOLDER_HEADER_CLASS) &&
          child.dataset.folderId === folder.id,
      );
      if (!(header instanceof HTMLElement)) {
        return null;
      }

      const emptyState = flowNodes.find(
        (child) =>
          child.classList.contains(FOLDER_EMPTY_CLASS) &&
          child.dataset.folderId === folder.id,
      );
      const itemPlacements = flowNodes
        .filter(
          (child) => {
            if (
              !isConversationPresentationNode(child, folderState.history) ||
              child.getAttribute(FOLDER_ITEM_ATTR) !== folder.id ||
              child.hasAttribute(FOLDER_COLLAPSED_ATTR)
            ) {
              return false;
            }

            const conversationId = getConversationIdFromItem(child);
            return conversationId && conversationId !== draggedConversationId;
          },
        )
        .map((item) => {
          const rect = getVisibleRect(item);
          const conversationId = getConversationIdFromItem(item);
          if (!rect || !conversationId) {
            return null;
          }
          return {
            conversationId,
            element: item,
            top: rect.top,
            bottom: rect.bottom,
            midpoint: rect.top + rect.height / 2,
          };
        })
        .filter(Boolean);

      const segmentNodes = flowNodes.filter((child) => {
        if (!(child instanceof HTMLElement)) {
          return false;
        }

        if (child === header) {
          return true;
        }

        if (child === emptyState) {
          return true;
        }

        if (
          !isConversationPresentationNode(child, folderState.history) ||
          child.getAttribute(FOLDER_ITEM_ATTR) !== folder.id ||
          child.hasAttribute(FOLDER_COLLAPSED_ATTR)
        ) {
          return false;
        }

        const conversationId = getConversationIdFromItem(child);
        return conversationId && conversationId !== draggedConversationId;
      });

      const segmentRects = segmentNodes.map((node) => getVisibleRect(node)).filter(Boolean);
      if (segmentRects.length === 0) {
        return null;
      }

      let nextBoundaryTop = fallbackBottomBoundary;
      for (let cursor = index + 1; cursor < sortedFolders.length; cursor += 1) {
        const nextHeader = flowNodes.find(
          (child) =>
            child.classList.contains(FOLDER_HEADER_CLASS) &&
            child.dataset.folderId === sortedFolders[cursor].id,
        );
        const nextHeaderRect = getVisibleRect(nextHeader);
        if (nextHeaderRect) {
          nextBoundaryTop = nextHeaderRect.top;
          break;
        }
      }

      const naturalTop = Math.min(...segmentRects.map((rect) => rect.top));
      const naturalBottom = Math.max(...segmentRects.map((rect) => rect.bottom));
      const availableGap = Math.max(0, nextBoundaryTop - naturalBottom);
      const extendedBottom = naturalBottom + Math.min(18, availableGap / 2);

      return {
        type: "folder",
        key: `folder:${folder.id}`,
        folderId: folder.id,
        element: null,
        top: naturalTop - 6,
        bottom: extendedBottom + 6,
        header,
        emptyState: emptyState instanceof HTMLElement ? emptyState : null,
        itemPlacements,
      };
    })
    .filter(Boolean);

  const ungroupedItems = flowNodes.filter(
    (child) => isConversationPresentationNode(child, folderState.history) && !child.hasAttribute(FOLDER_ITEM_ATTR),
  );
  const ungroupedRects = ungroupedItems.map((node) => getVisibleRect(node)).filter(Boolean);
  const ungroupedRange =
    ungroupedRects.length === 0
      ? null
      : {
          top: Math.min(...ungroupedRects.map((rect) => rect.top)) - 6,
          bottom: Math.max(...ungroupedRects.map((rect) => rect.bottom)) + 6,
          element: ungroupedButton || ungroupedItems[0],
        };

  return {
    historyRect,
    ungroupedButton,
    ungroupedButtonRect,
    folderZones,
    ungroupedRange,
  };
};

const buildConversationDropPlacementFromFolderZone = (zone, clientY) => {
  if (!zone?.folderId) {
    return null;
  }

  const placements = Array.isArray(zone.itemPlacements) ? zone.itemPlacements : [];
  if (placements.length === 0) {
    return {
      type: "folder",
      key: `folder:${zone.folderId}:append`,
      folderId: zone.folderId,
      targetConversationId: null,
      position: "after",
      element: zone.emptyState || zone.header,
      highlightMode: "fill",
    };
  }

  if (!Number.isFinite(clientY) || clientY <= placements[0].midpoint) {
    return {
      type: "folder",
      key: `folder:${zone.folderId}:before:${placements[0].conversationId}`,
      folderId: zone.folderId,
      targetConversationId: placements[0].conversationId,
      position: "before",
      element: placements[0].element,
      highlightMode: "before",
    };
  }

  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    if (clientY <= placement.bottom) {
      const position = clientY < placement.midpoint ? "before" : "after";
      return {
        type: "folder",
        key: `folder:${zone.folderId}:${position}:${placement.conversationId}`,
        folderId: zone.folderId,
        targetConversationId: placement.conversationId,
        position,
        element: placement.element,
        highlightMode: position,
      };
    }

    const nextPlacement = placements[index + 1];
    if (nextPlacement && clientY < nextPlacement.top) {
      const gapMidpoint = placement.bottom + (nextPlacement.top - placement.bottom) / 2;
      if (clientY < gapMidpoint) {
        return {
          type: "folder",
          key: `folder:${zone.folderId}:after:${placement.conversationId}`,
          folderId: zone.folderId,
          targetConversationId: placement.conversationId,
          position: "after",
          element: placement.element,
          highlightMode: "after",
        };
      }

      return {
        type: "folder",
        key: `folder:${zone.folderId}:before:${nextPlacement.conversationId}`,
        folderId: zone.folderId,
        targetConversationId: nextPlacement.conversationId,
        position: "before",
        element: nextPlacement.element,
        highlightMode: "before",
      };
    }
  }

  const lastPlacement = placements[placements.length - 1];
  return {
    type: "folder",
    key: `folder:${zone.folderId}:after:${lastPlacement.conversationId}`,
    folderId: zone.folderId,
    targetConversationId: lastPlacement.conversationId,
    position: "after",
    element: lastPlacement.element,
    highlightMode: "after",
  };
};

const buildFolderSortLayout = () => {
  if (!(folderState.history instanceof HTMLElement) || !folderState.draggingFolderId) {
    return null;
  }

  const historyRect = folderState.history.getBoundingClientRect();
  const flowNodes = getFolderFlowNodes();
  const segments = getSortedFolders()
    .filter((folder) => folder.id !== folderState.draggingFolderId)
    .map((folder) => {
      const header = flowNodes.find(
        (child) =>
          child.classList.contains(FOLDER_HEADER_CLASS) &&
          child.dataset.folderId === folder.id,
      );
      if (!(header instanceof HTMLElement)) {
        return null;
      }

      const segmentNodes = flowNodes.filter((child) => {
        if (!(child instanceof HTMLElement)) {
          return false;
        }

        if (child === header) {
          return true;
        }

        if (child.classList.contains(FOLDER_EMPTY_CLASS) && child.dataset.folderId === folder.id) {
          return true;
        }

        return isConversationPresentationNode(child, folderState.history) && child.getAttribute(FOLDER_ITEM_ATTR) === folder.id;
      });

      const segmentRects = segmentNodes.map((node) => getVisibleRect(node)).filter(Boolean);
      if (segmentRects.length === 0) {
        return null;
      }

      return {
        folderId: folder.id,
        header,
        top: Math.min(...segmentRects.map((rect) => rect.top)),
        bottom: Math.max(...segmentRects.map((rect) => rect.bottom)),
      };
    })
    .filter(Boolean);

  return {
    historyRect,
    segments,
  };
};

const prepareFolderDragLayout = (type) => {
  if (type === "folder-sort") {
    folderState.dragLayout = {
      type,
      value: buildFolderSortLayout(),
    };
    return;
  }

  folderState.dragLayout = {
    type: "conversation",
    value: buildConversationDropLayout(),
  };
};

const getFolderDragLayout = (type) => {
  if (folderState.dragLayout?.type === type && folderState.dragLayout.value) {
    return folderState.dragLayout.value;
  }

  const nextValue = type === "folder-sort" ? buildFolderSortLayout() : buildConversationDropLayout();
  folderState.dragLayout = {
    type,
    value: nextValue,
  };
  return nextValue;
};

const setDropZoneHighlight = (element, key, mode = "fill") => {
  if (!(element instanceof HTMLElement)) {
    clearDropZoneHighlight();
    return;
  }

  const nextClass =
    mode === "before"
      ? "is-drop-target-before"
      : mode === "after"
        ? "is-drop-target-after"
        : "is-drop-target";

  if (folderState.currentDropZoneKey === key && element.classList.contains(nextClass)) {
    return;
  }

  clearDropZoneHighlight();
  folderState.currentDropZoneKey = key;
  element.classList.add(nextClass);
};

const setFolderSortHighlight = (element, key, position) => {
  if (!(element instanceof HTMLElement)) {
    clearFolderSortHighlight();
    return;
  }

  const nextClass = position === "after" ? "is-sort-target-after" : "is-sort-target-before";
  if (folderState.currentSortZoneKey === key && element.classList.contains(nextClass)) {
    return;
  }

  clearFolderSortHighlight();
  folderState.currentSortZoneKey = key;
  document.documentElement.setAttribute(FOLDER_SORTING_ATTR, "1");
  element.classList.add(nextClass);

  const draggingHeader = folderState.history?.querySelector(
    `.${FOLDER_HEADER_CLASS}[data-folder-id="${folderState.draggingFolderId || ""}"]`,
  );
  if (draggingHeader instanceof HTMLElement) {
    draggingHeader.classList.add("is-sort-dragging");
  }
};

const clearFolderDragState = () => {
  folderState.draggingConversationId = null;
  folderState.draggingFolderId = null;
  folderState.dragLayout = null;
  document.documentElement.removeAttribute(FOLDER_DRAGGING_ATTR);
  clearDropZoneHighlight();
  clearFolderSortHighlight();

  if (folderState.refreshPending) {
    folderState.refreshPending = false;
    scheduleFolderRefresh();
  }
};

const flashUngroupedConversations = (items) => {
  if (folderHighlightTimer) {
    clearTimeout(folderHighlightTimer);
    folderHighlightTimer = null;
  }

  const highlightNodes = Array.from(
    new Set(
      items
        .map((item) => getConversationPresentationNode(item, folderState.history) || item)
        .filter((item) => item instanceof HTMLElement),
    ),
  );

  highlightNodes.forEach((item) => item.setAttribute(FOLDER_HIGHLIGHT_ATTR, "1"));
  folderHighlightTimer = setTimeout(() => {
    highlightNodes.forEach((item) => item.removeAttribute(FOLDER_HIGHLIGHT_ATTR));
    folderHighlightTimer = null;
  }, 1200);
};

const focusUngroupedConversations = () => {
  if (!(folderState.history instanceof HTMLElement)) {
    return;
  }

  const ungroupedItems = getConversationItems(folderState.history).filter((item) => {
    const conversationId = getConversationIdFromItem(item);
    return !conversationId || !folderState.assignments[conversationId];
  });

  if (ungroupedItems.length === 0) {
    return;
  }

  flashUngroupedConversations(ungroupedItems);
  ungroupedItems[0].scrollIntoView({ block: "nearest" });
};

const scheduleSettledFolderRefresh = () => {
  if (folderSettledRefreshTimer) {
    clearTimeout(folderSettledRefreshTimer);
    folderSettledRefreshTimer = null;
  }

  requestAnimationFrame(() => {
    scheduleFolderRefresh();
  });

  folderSettledRefreshTimer = setTimeout(() => {
    folderSettledRefreshTimer = null;
    renderFolders();
  }, 96);
};

const createFolder = () => {
  const inputName = window.prompt(t("folder.createPrompt"), getNextFolderName());
  if (inputName === null) {
    return;
  }

  const name = inputName.trim();
  if (!name) {
    return;
  }

  const folders = getSortedFolders();
  folderState.folders = [
    ...folders,
    {
      id: createFolderId(),
      name,
      collapsed: false,
      order: folders.length,
      createdAt: Date.now(),
    },
  ];
  persistFolderState();
  scheduleFolderRefresh();
};

const renameFolder = (folderId) => {
  const folder = getFolderById(folderId);
  if (!folder) {
    return;
  }

  const inputName = window.prompt(t("folder.renamePrompt"), folder.name);
  if (inputName === null) {
    return;
  }

  const nextName = inputName.trim();
  if (!nextName || nextName === folder.name) {
    return;
  }

  folder.name = nextName;
  persistFolderState();
  scheduleFolderRefresh();
};

const deleteFolder = (folderId) => {
  const folder = getFolderById(folderId);
  if (!folder) {
    return;
  }

  const confirmed = window.confirm(t("folder.deleteConfirm", { name: folder.name }));
  if (!confirmed) {
    return;
  }

  folderState.folders = getSortedFolders()
    .filter((item) => item.id !== folderId)
    .map((item, index) => ({
      ...item,
      order: index,
    }));

  Object.keys(folderState.assignments).forEach((conversationId) => {
    if (folderState.assignments[conversationId] === folderId) {
      delete folderState.assignments[conversationId];
    }
  });
  delete folderState.itemOrders[folderId];

  closeFolderMenu();
  persistFolderState();
  scheduleFolderRefresh();
};

const toggleFolder = (folderId) => {
  const folder = getFolderById(folderId);
  if (!folder) {
    return;
  }

  folder.collapsed = !folder.collapsed;
  persistFolderState();
  scheduleFolderRefresh();
};

const reorderFolders = (draggedFolderId, targetFolderId, position) => {
  if (!draggedFolderId) {
    return;
  }

  const sortedFolders = getSortedFolders();
  if (sortedFolders.length < 2) {
    return;
  }

  const folderMap = new Map(sortedFolders.map((folder) => [folder.id, folder]));
  const draggedFolder = folderMap.get(draggedFolderId);
  if (!draggedFolder) {
    return;
  }

  const remainingFolders = sortedFolders.filter((folder) => folder.id !== draggedFolderId);
  let insertIndex = remainingFolders.length;

  if (targetFolderId) {
    const targetIndex = remainingFolders.findIndex((folder) => folder.id === targetFolderId);
    if (targetIndex === -1) {
      return;
    }
    insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  }

  const nextOrderIds = remainingFolders.map((folder) => folder.id);
  nextOrderIds.splice(insertIndex, 0, draggedFolderId);

  const currentOrderIds = sortedFolders.map((folder) => folder.id);
  if (nextOrderIds.join("|") === currentOrderIds.join("|")) {
    return;
  }

  folderState.folders = nextOrderIds.map((folderId, index) => ({
    ...folderMap.get(folderId),
    order: index,
  }));

  persistFolderState();
  scheduleFolderRefresh();
};

const assignConversationToFolder = (conversationId, folderId) => {
  if (!conversationId || !getFolderById(folderId)) {
    return;
  }

  const sourceFolderId = folderState.assignments[conversationId] || "";
  const targetConversationIds = getCurrentFolderConversationIds(folderId).filter(
    (currentConversationId) => currentConversationId !== conversationId,
  );

  if (sourceFolderId && sourceFolderId !== folderId) {
    removeConversationFromFolderOrders(conversationId, sourceFolderId);
  } else {
    removeConversationFromFolderOrders(conversationId);
  }

  folderState.assignments[conversationId] = folderId;
  setStoredFolderConversationIds(folderId, [...targetConversationIds, conversationId]);
  persistFolderState();
  scheduleFolderRefresh();
  scheduleSettledFolderRefresh();
};

const unassignConversation = (conversationId) => {
  if (!conversationId || !folderState.assignments[conversationId]) {
    return;
  }

  removeConversationFromFolderOrders(conversationId, folderState.assignments[conversationId]);
  delete folderState.assignments[conversationId];
  persistFolderState();
  scheduleFolderRefresh();
  scheduleSettledFolderRefresh();
};

const moveConversationToFolderPosition = (conversationId, folderId, options = {}) => {
  if (!conversationId || !folderId || !getFolderById(folderId)) {
    return;
  }

  const { targetConversationId = null, position = "after" } = options;
  const sourceFolderId = folderState.assignments[conversationId] || "";

  if (sourceFolderId === folderId && targetConversationId === conversationId) {
    return;
  }

  const sourceConversationIds =
    sourceFolderId && sourceFolderId !== folderId ? getCurrentFolderConversationIds(sourceFolderId) : [];
  const baseTargetConversationIds = getCurrentFolderConversationIds(folderId);
  const targetConversationIds = baseTargetConversationIds.filter(
    (currentConversationId) => currentConversationId !== conversationId,
  );

  let insertIndex = targetConversationIds.length;
  if (targetConversationId) {
    const targetIndex = targetConversationIds.indexOf(targetConversationId);
    if (targetIndex >= 0) {
      insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    }
  }

  const nextTargetConversationIds = [...targetConversationIds];
  nextTargetConversationIds.splice(insertIndex, 0, conversationId);

  const sourceChanged =
    sourceFolderId !== folderId &&
    sourceFolderId &&
    sourceConversationIds.some((currentConversationId) => currentConversationId === conversationId);
  const targetChanged =
    sourceFolderId !== folderId ||
    nextTargetConversationIds.join("|") !== baseTargetConversationIds.join("|");

  if (!sourceChanged && !targetChanged) {
    return;
  }

  if (sourceFolderId && sourceFolderId !== folderId) {
    setStoredFolderConversationIds(
      sourceFolderId,
      sourceConversationIds.filter((currentConversationId) => currentConversationId !== conversationId),
    );
  } else {
    removeConversationFromFolderOrders(conversationId, folderId);
  }

  folderState.assignments[conversationId] = folderId;
  setStoredFolderConversationIds(folderId, nextTargetConversationIds);
  persistFolderState();
  scheduleFolderRefresh();
  scheduleSettledFolderRefresh();
};

const createConversationPlanSignature = (plan) => {
  if (!plan || typeof plan !== "object") {
    return "";
  }

  return `${plan.order}|${plan.folderId || ""}|${plan.collapsed ? 1 : 0}`;
};

const createFolderPlanSignature = (plan) => {
  if (!plan?.folder) {
    return "";
  }

  const { folder, itemCount, headerOrder, emptyVisible, emptyOrder } = plan;
  return `${folder.id}|${folder.name}|${folder.collapsed ? 1 : 0}|${itemCount}|${headerOrder}|${emptyVisible ? 1 : 0}|${emptyOrder}`;
};

const clearConversationPresentationNode = (node) => {
  if (!(node instanceof HTMLElement)) {
    return;
  }

  node.style.order = "";
  node.removeAttribute(FOLDER_ITEM_ATTR);
  node.removeAttribute(FOLDER_COLLAPSED_ATTR);
  node.removeAttribute(FOLDER_HIGHLIGHT_ATTR);
};

const resetFolderRenderCache = () => {
  folderState.previousNativeList = null;
  folderState.conversationRenderCache = new Map();
  folderState.folderRenderCache = new Map();
  folderState.otherNativeOrderCache = new Map();
};

const clearHistoryPresentation = (history) => {
  if (!(history instanceof HTMLElement)) {
    return;
  }

  const nativeList = getNativeConversationList(history);
  history.removeAttribute(FOLDER_ROOT_ATTR);
  history.removeAttribute(FOLDER_THEME_TARGET_ATTR);
  history.removeAttribute(THEME_ATTR);
  nativeList?.removeAttribute(FOLDER_NATIVE_LIST_ATTR);
  folderState.previousNativeList?.removeAttribute(FOLDER_NATIVE_LIST_ATTR);

  Array.from(history.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) {
      return;
    }

    if (child.classList.contains(FOLDER_HEADER_CLASS) || child.classList.contains(FOLDER_EMPTY_CLASS)) {
      child.remove();
      return;
    }

    clearConversationPresentationNode(child);
  });

  getConversationItems(history).forEach((item) => {
    const presentationNode = getConversationPresentationNode(item, history);
    clearConversationDragAttributes(item);
    clearConversationPresentationNode(item);

    if (!(presentationNode instanceof HTMLElement) || presentationNode === item) {
      return;
    }

    clearConversationPresentationNode(presentationNode);
  });

  resetFolderRenderCache();
};

const cleanupFolderUi = () => {
  clearHistoryPresentation(folderState.history);

  const manager = document.getElementById(FOLDER_MANAGER_ID);
  if (manager) {
    manager.remove();
  }

  const menu = document.getElementById(FOLDER_MENU_ID);
  if (menu) {
    menu.remove();
  }

  folderState.section = null;
  folderState.headerButton = null;
  folderState.history = null;
  folderState.nativeList = null;
  folderState.menuFolderId = null;
  folderState.currentDropZoneKey = "";
  folderState.missingHistoryRetryCount = 0;
  resetFolderRenderCache();
};

const clearFolderMissingSectionRetry = (options = {}) => {
  const { resetCount = true } = options;
  if (folderMissingSectionRetryTimer) {
    clearTimeout(folderMissingSectionRetryTimer);
    folderMissingSectionRetryTimer = null;
  }
  if (resetCount) {
    folderState.missingHistoryRetryCount = 0;
  }
};

const scheduleFolderMissingSectionRetry = () => {
  if (folderMissingSectionRetryTimer) {
    return;
  }
  const isHidden = document.hidden || document.visibilityState === "hidden";
  const delay =
    isHidden
      ? FOLDER_MISSING_SECTION_RETRY_HIDDEN_DELAY_MS
      : folderState.missingHistoryRetryCount >= Math.floor(FOLDER_MISSING_SECTION_RETRY_LIMIT / 2)
      ? FOLDER_MISSING_SECTION_RETRY_SLOW_DELAY_MS
      : FOLDER_MISSING_SECTION_RETRY_DELAY_MS;
  folderMissingSectionRetryTimer = setTimeout(() => {
    folderMissingSectionRetryTimer = null;
    scheduleFolderRefresh();
  }, delay);
};

const ensureFolderManager = (section, headerButton) => {
  let manager = document.getElementById(FOLDER_MANAGER_ID);
  if (!(manager instanceof HTMLElement)) {
    manager = document.createElement("div");
    manager.id = FOLDER_MANAGER_ID;
    manager.className = "chatgpt-toolkit-folder-manager";
    manager.setAttribute(FOLDER_THEME_TARGET_ATTR, "folders");
    manager.innerHTML =       '<div class="chatgpt-toolkit-folder-manager-label">' + t("folder.managerLabel") + '</div>' +
      '<div class="chatgpt-toolkit-folder-manager-actions">' +
        '<button type="button" class="chatgpt-toolkit-folder-pill" data-folder-action="show-ungrouped">' +
          '<span>' + t("folder.ungrouped") + '</span>' +
          '<span class="chatgpt-toolkit-folder-pill-count">0</span>' +
        '</button>' +
        '<button type="button" class="chatgpt-toolkit-folder-pill is-primary" data-folder-action="create">' +
          t("folder.create") +
        '</button>' +
      '</div>';
  }

  if (!manager.hasAttribute(FOLDER_MANAGER_BOUND_ATTR)) {
    manager.addEventListener("click", (event) => {
      const target = getSafeEventTarget(event);
      if (!(target instanceof Element)) {
        return;
      }

      const actionButton = target.closest("[data-folder-action]");
      if (!(actionButton instanceof HTMLButtonElement)) {
        return;
      }

      if (actionButton.dataset.folderAction === "create") {
        createFolder();
        return;
      }

      if (actionButton.dataset.folderAction === "show-ungrouped") {
        focusUngroupedConversations();
      }
    });
    manager.setAttribute(FOLDER_MANAGER_BOUND_ATTR, "1");
  }

  const history = findHistoryContainer(section);
  const mountParent =
    history instanceof HTMLElement && history.parentElement instanceof HTMLElement ? history.parentElement : section;
  const referenceNode =
    history instanceof HTMLElement && history.parentElement === mountParent
      ? history
      : headerButton instanceof HTMLElement && headerButton.parentElement === mountParent
      ? headerButton
      : null;
  const needsMove =
    manager.parentElement !== mountParent ||
    (referenceNode instanceof HTMLElement ? manager.nextElementSibling !== referenceNode : false);

  if (mountParent instanceof HTMLElement && needsMove) {
    if (referenceNode instanceof HTMLElement && referenceNode.parentElement === mountParent) {
      mountParent.insertBefore(manager, referenceNode);
    } else if (manager.parentElement !== mountParent) {
      mountParent.prepend(manager);
    }
  }

  return manager;
};

const refreshFolderLocalization = () => {
  const manager = document.getElementById(FOLDER_MANAGER_ID);
  if (manager instanceof HTMLElement) {
    const label = manager.querySelector(".chatgpt-toolkit-folder-manager-label");
    if (label instanceof HTMLElement) {
      label.textContent = t("folder.managerLabel");
    }

    const ungrouped = manager.querySelector('[data-folder-action="show-ungrouped"] > span');
    if (ungrouped instanceof HTMLElement) {
      ungrouped.textContent = t("folder.ungrouped");
    }

    const create = manager.querySelector('[data-folder-action="create"]');
    if (create instanceof HTMLButtonElement) {
      create.textContent = t("folder.create");
    }
  }

  const menu = document.getElementById(FOLDER_MENU_ID);
  if (menu instanceof HTMLElement) {
    const rename = menu.querySelector('[data-folder-menu-action="rename"]');
    if (rename instanceof HTMLButtonElement) {
      rename.textContent = t("folder.menuRename");
    }
    const del = menu.querySelector('[data-folder-menu-action="delete"]');
    if (del instanceof HTMLButtonElement) {
      del.textContent = t("folder.menuDelete");
    }
  }

  if (folderState.history instanceof HTMLElement) {
    folderState.history.querySelectorAll(`.${FOLDER_EMPTY_CLASS}`).forEach((node) => {
      if (node instanceof HTMLElement) {
        node.textContent = t("folder.emptyHint");
      }
    });

    folderState.history.querySelectorAll("[data-folder-action='open-menu']").forEach((node) => {
      if (node instanceof HTMLButtonElement) {
        node.setAttribute("aria-label", t("folder.menuOpenAria"));
      }
    });
  }
};

const getConversationDropPlacementFromTarget = (target, clientY) => {
  if (!(target instanceof Element)) {
    return null;
  }

  const manager = document.getElementById(FOLDER_MANAGER_ID);
  const ungroupedButton = target.closest('[data-folder-action="show-ungrouped"]');
  if (
    ungroupedButton instanceof HTMLButtonElement &&
    manager instanceof HTMLElement &&
    manager.contains(ungroupedButton)
  ) {
    return {
      type: "ungrouped",
      key: "ungrouped",
      element: ungroupedButton,
      highlightMode: "fill",
    };
  }

  const conversationItem = getConversationItemFromTarget(target);
  if (conversationItem instanceof HTMLAnchorElement) {
    const presentationNode = getConversationPresentationNode(conversationItem, folderState.history);
    if (!(presentationNode instanceof HTMLElement)) {
      return null;
    }

    const folderId = getConversationFolderId(conversationItem);
    if (!folderId) {
      return {
        type: "ungrouped",
        key: "ungrouped",
        element: presentationNode,
        highlightMode: "fill",
      };
    }

    const conversationId = getConversationIdFromItem(conversationItem);
    if (!conversationId) {
      return null;
    }
    if (conversationId === folderState.draggingConversationId) {
      return null;
    }

    const rect = getVisibleRect(presentationNode);
    const isBefore = rect ? clientY <= rect.top + rect.height / 2 : true;
    return {
      type: "folder",
      key: `folder:${folderId}:${isBefore ? "before" : "after"}:${conversationId}`,
      folderId,
      targetConversationId: conversationId,
      position: isBefore ? "before" : "after",
      element: presentationNode,
      highlightMode: isBefore ? "before" : "after",
    };
  }

  const dropZone = target.closest(`[${FOLDER_DROPZONE_ATTR}="folder"]`);
  if (!(dropZone instanceof HTMLElement) || dropZone.parentElement !== folderState.history) {
    return null;
  }

  const folderId = dropZone.dataset.folderId || "";
  if (!folderId) {
    return null;
  }

  if (dropZone.classList.contains(FOLDER_EMPTY_CLASS)) {
    return {
      type: "folder",
      key: `folder:${folderId}:append`,
      folderId,
      targetConversationId: null,
      position: "after",
      element: dropZone,
      highlightMode: "fill",
    };
  }

  const layout = getFolderDragLayout("conversation");
  const matchedZone = layout?.folderZones?.find((zone) => zone.folderId === folderId) || null;
  if (matchedZone) {
    return buildConversationDropPlacementFromFolderZone(matchedZone, clientY);
  }

  return {
    type: "folder",
    key: `folder:${folderId}:append`,
    folderId,
    element: dropZone,
    targetConversationId: null,
    position: "after",
    highlightMode: "fill",
  };
};

const getConversationDropPlacementFromManagedArea = (clientX, clientY) => {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const layout = getFolderDragLayout("conversation");
  if (!layout) {
    return null;
  }

  if (layout.ungroupedButtonRect && isPointInsideRect(clientX, clientY, layout.ungroupedButtonRect, 10)) {
    return {
      type: "ungrouped",
      key: "ungrouped",
      element: layout.ungroupedButton,
      highlightMode: "fill",
    };
  }

  if (
    clientX < layout.historyRect.left ||
    clientX > layout.historyRect.right ||
    clientY < layout.historyRect.top ||
    clientY > layout.historyRect.bottom
  ) {
    return null;
  }

  const matchedFolderZone =
    layout.folderZones.find((zone) => clientY >= zone.top && clientY <= zone.bottom) || null;
  if (matchedFolderZone) {
    return buildConversationDropPlacementFromFolderZone(matchedFolderZone, clientY);
  }

  if (!layout.ungroupedRange) {
    return null;
  }

  if (clientY < layout.ungroupedRange.top || clientY > layout.ungroupedRange.bottom) {
    return null;
  }

  return {
    type: "ungrouped",
    key: "ungrouped",
    element: layout.ungroupedRange.element,
    highlightMode: "fill",
  };
};

const getConversationDropPlacementFromEvent = (event) => {
  const directDropZone = getConversationDropPlacementFromTarget(getSafeEventTarget(event), event?.clientY);
  if (directDropZone) {
    return directDropZone;
  }

  return getConversationDropPlacementFromManagedArea(event?.clientX, event?.clientY);
};

const getFolderSortPlacement = (clientX, clientY) => {
  const layout = getFolderDragLayout("folder-sort");
  if (!layout) {
    return null;
  }

  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    clientX < layout.historyRect.left - 16 ||
    clientX > layout.historyRect.right + 16 ||
    clientY < layout.historyRect.top - 8 ||
    clientY > layout.historyRect.bottom + 8
  ) {
    return null;
  }

  const { segments } = layout;
  if (segments.length === 0) {
    return null;
  }

  if (clientY <= segments[0].top) {
    return {
      key: `before:${segments[0].folderId}`,
      targetFolderId: segments[0].folderId,
      position: "before",
      element: segments[0].header,
    };
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const midpoint = segment.top + (segment.bottom - segment.top) / 2;

    if (clientY <= segment.bottom) {
      return {
        key: `${clientY < midpoint ? "before" : "after"}:${segment.folderId}`,
        targetFolderId: segment.folderId,
        position: clientY < midpoint ? "before" : "after",
        element: segment.header,
      };
    }

    const nextSegment = segments[index + 1];
    if (nextSegment && clientY < nextSegment.top) {
      const gapMidpoint = segment.bottom + (nextSegment.top - segment.bottom) / 2;
      if (clientY < gapMidpoint) {
        return {
          key: `after:${segment.folderId}`,
          targetFolderId: segment.folderId,
          position: "after",
          element: segment.header,
        };
      }

      return {
        key: `before:${nextSegment.folderId}`,
        targetFolderId: nextSegment.folderId,
        position: "before",
        element: nextSegment.header,
      };
    }
  }

  const lastSegment = segments[segments.length - 1];
  return {
    key: `after:${lastSegment.folderId}`,
    targetFolderId: lastSegment.folderId,
    position: "after",
    element: lastSegment.header,
  };
};

const applyFolderNodeOrder = (node, order) => {
  if (!(node instanceof HTMLElement)) {
    return;
  }

  const nextOrder = String(order);
  if (node.style.order !== nextOrder) {
    node.style.order = nextOrder;
  }
};

const syncConversationItemPresentation = (item, plan) => {
  if (!(item instanceof HTMLElement) || !plan) {
    return;
  }

  const presentationNode = getConversationPresentationNode(item, folderState.history) || item;
  applyFolderNodeOrder(presentationNode, plan.order);

  if (presentationNode !== item) {
    item.style.order = "";
    item.removeAttribute(FOLDER_ITEM_ATTR);
    item.removeAttribute(FOLDER_COLLAPSED_ATTR);
    item.removeAttribute(FOLDER_HIGHLIGHT_ATTR);
  }

  const currentFolderId = presentationNode.getAttribute(FOLDER_ITEM_ATTR) || "";
  if (plan.folderId) {
    if (currentFolderId !== plan.folderId) {
      presentationNode.setAttribute(FOLDER_ITEM_ATTR, plan.folderId);
    }
  } else if (currentFolderId) {
    presentationNode.removeAttribute(FOLDER_ITEM_ATTR);
  }

  const isCollapsed = presentationNode.hasAttribute(FOLDER_COLLAPSED_ATTR);
  if (plan.collapsed) {
    if (!isCollapsed) {
      presentationNode.setAttribute(FOLDER_COLLAPSED_ATTR, "1");
    }
  } else if (isCollapsed) {
    presentationNode.removeAttribute(FOLDER_COLLAPSED_ATTR);
  }
};

const syncFolderHeaderPresentation = (header, plan) => {
  if (!(header instanceof HTMLElement) || !plan?.folder) {
    return;
  }

  const { folder, headerOrder, itemCount } = plan;
  if (header.dataset.folderId !== folder.id) {
    header.dataset.folderId = folder.id;
  }
  if (header.getAttribute(FOLDER_DROPZONE_ATTR) !== "folder") {
    header.setAttribute(FOLDER_DROPZONE_ATTR, "folder");
  }
  const collapsedValue = folder.collapsed ? "1" : "0";
  if (header.dataset.collapsed !== collapsedValue) {
    header.dataset.collapsed = collapsedValue;
  }
  if (header.getAttribute("draggable") !== "true") {
    header.setAttribute("draggable", "true");
  }
  applyFolderNodeOrder(header, headerOrder);

  const folderName = header.querySelector(".chatgpt-toolkit-folder-name");
  if (folderName instanceof HTMLElement && folderName.textContent !== folder.name) {
    folderName.textContent = folder.name;
  }

  const countText = String(itemCount);
  const countNode = header.querySelector(".chatgpt-toolkit-folder-count");
  if (countNode instanceof HTMLElement && countNode.textContent !== countText) {
    countNode.textContent = countText;
  }

  const menuButton = header.querySelector("[data-folder-action='open-menu']");
  if (menuButton instanceof HTMLElement) {
    if (menuButton.dataset.folderId !== folder.id) {
      menuButton.dataset.folderId = folder.id;
    }
    if (menuButton.getAttribute("draggable") !== "false") {
      menuButton.setAttribute("draggable", "false");
    }
  }
};

const syncFolderEmptyStatePresentation = (emptyState, folderId, order) => {
  if (!(emptyState instanceof HTMLElement) || !folderId) {
    return;
  }

  if (emptyState.dataset.folderId !== folderId) {
    emptyState.dataset.folderId = folderId;
  }
  if (emptyState.getAttribute(FOLDER_DROPZONE_ATTR) !== "folder") {
    emptyState.setAttribute(FOLDER_DROPZONE_ATTR, "folder");
  }
  if (emptyState.textContent !== t("folder.emptyHint")) {
    emptyState.textContent = t("folder.emptyHint");
  }
  applyFolderNodeOrder(emptyState, order);
};

const syncUngroupedButtonPresentation = (manager, ungroupedCount) => {
  if (!(manager instanceof HTMLElement)) {
    return;
  }

  const ungroupedButton = manager.querySelector('[data-folder-action="show-ungrouped"]');
  if (!(ungroupedButton instanceof HTMLButtonElement)) {
    return;
  }

  ungroupedButton.classList.toggle("is-empty", ungroupedCount === 0);
  const countNode = ungroupedButton.querySelector(".chatgpt-toolkit-folder-pill-count");
  const countText = String(ungroupedCount);
  if (countNode instanceof HTMLElement && countNode.textContent !== countText) {
    countNode.textContent = countText;
  }
};

const renderFolders = () => {
  hydrateFolders();

  const anchorData = findFolderAnchor();
  if (!anchorData) {
    const hasSidebarHost = Boolean(
      document.getElementById("stage-slideover-sidebar") ||
      document.querySelector('nav[aria-label], aside, [data-testid*="sidebar"], [id*="sidebar"]'),
    );
    if (hasSidebarHost && folderState.missingHistoryRetryCount < FOLDER_MISSING_SECTION_RETRY_LIMIT) {
      folderState.missingHistoryRetryCount += 1;
      scheduleFolderMissingSectionRetry();
      return;
    }
    clearFolderMissingSectionRetry();
    cleanupFolderUi();
    return;
  }

  const { section, headerButton } = anchorData;
  folderState.section = section;
  folderState.headerButton = headerButton;
  const manager = ensureFolderManager(section, headerButton);
  ensureFolderMenu();

  const history = findHistoryContainer(section);
  if (!(history instanceof HTMLElement)) {
    if (folderState.history instanceof HTMLElement) {
      clearHistoryPresentation(folderState.history);
    }

    folderState.history = null;
    folderState.nativeList = null;
    resetFolderRenderCache();
    folderState.currentDropZoneKey = "";
    folderState.dragLayout = null;
    syncUngroupedButtonPresentation(manager, 0);
    syncToolkitTheme();

    folderState.missingHistoryRetryCount = Math.min(
      folderState.missingHistoryRetryCount + 1,
      FOLDER_MISSING_SECTION_RETRY_LIMIT,
    );
    scheduleFolderMissingSectionRetry();
    return;
  }

  clearFolderMissingSectionRetry();

  if (folderState.history && folderState.history !== history) {
    clearHistoryPresentation(folderState.history);
  }

  folderState.history = history;
  folderState.nativeList = getNativeConversationList(history);

  bindFolderHistoryEvents(history);

  const conversationItems = getConversationItems(history);
  const conversationPresentationSet = new Set(
    conversationItems
      .map((item) => getConversationPresentationNode(item, history))
      .filter((item) => item instanceof HTMLElement),
  );
  const sortedFolders = getSortedFolders();
  const validFolderIds = new Set(sortedFolders.map((folder) => folder.id));
  const groupedItems = new Map();
  const ungroupedItems = [];

  conversationItems.forEach((item) => {
    const conversationId = getConversationIdFromItem(item);
    const folderId = conversationId ? folderState.assignments[conversationId] : "";

    if (conversationId && folderId && validFolderIds.has(folderId)) {
      if (!groupedItems.has(folderId)) {
        groupedItems.set(folderId, []);
      }
      groupedItems.get(folderId).push(item);
      return;
    }

    ungroupedItems.push(item);
  });

  groupedItems.forEach((items, folderId) => {
    groupedItems.set(folderId, orderConversationItemsForFolder(folderId, items));
  });

  const otherNativeChildren = Array.from(history.children).filter(
    (child) =>
      child instanceof HTMLElement &&
      child !== folderState.nativeList &&
      !child.classList.contains(FOLDER_HEADER_CLASS) &&
      !child.classList.contains(FOLDER_EMPTY_CLASS) &&
      !conversationPresentationSet.has(child),
  );

  const conversationPlans = new Map();
  const otherNativePlans = new Map();
  const folderPlans = [];
  let nextOrder = 0;

  sortedFolders.forEach((folder) => {
    const folderItems = groupedItems.get(folder.id) || [];
    const itemCount = folderItems.length;
    const emptyVisible = !folder.collapsed && itemCount === 0;
    const headerOrder = nextOrder++;
    const emptyOrder = emptyVisible ? nextOrder++ : -1;

    folderPlans.push({
      folder,
      itemCount,
      headerOrder,
      emptyVisible,
      emptyOrder,
    });

    folderItems.forEach((item) => {
      conversationPlans.set(item, {
        order: nextOrder++,
        folderId: folder.id,
        collapsed: folder.collapsed,
      });
    });
  });

  ungroupedItems.forEach((item) => {
    conversationPlans.set(item, {
      order: nextOrder++,
      folderId: "",
      collapsed: false,
    });
  });

  otherNativeChildren.forEach((child) => {
    otherNativePlans.set(child, nextOrder++);
  });

  withFolderRenderLock(() => {
    if (history.getAttribute(FOLDER_ROOT_ATTR) !== "1") {
      history.setAttribute(FOLDER_ROOT_ATTR, "1");
    }
    if (history.getAttribute(FOLDER_THEME_TARGET_ATTR) !== "folders") {
      history.setAttribute(FOLDER_THEME_TARGET_ATTR, "folders");
    }
    if (
      folderState.previousNativeList instanceof HTMLElement &&
      folderState.previousNativeList !== folderState.nativeList
    ) {
      folderState.previousNativeList.removeAttribute(FOLDER_NATIVE_LIST_ATTR);
    }
    if (folderState.nativeList instanceof HTMLElement) {
      if (folderState.nativeList.getAttribute(FOLDER_NATIVE_LIST_ATTR) !== "1") {
        folderState.nativeList.setAttribute(FOLDER_NATIVE_LIST_ATTR, "1");
      }
    }
    folderState.previousNativeList = folderState.nativeList instanceof HTMLElement ? folderState.nativeList : null;

    const currentHeaders = new Map();
    const currentEmptyStates = new Map();
    const previousFolderRenderCache =
      folderState.folderRenderCache instanceof Map ? folderState.folderRenderCache : new Map();
    const nextFolderRenderCache = new Map();
    const previousConversationRenderCache =
      folderState.conversationRenderCache instanceof Map ? folderState.conversationRenderCache : new Map();
    const nextConversationRenderCache = new Map();
    const previousOtherNativeOrderCache =
      folderState.otherNativeOrderCache instanceof Map ? folderState.otherNativeOrderCache : new Map();
    const nextOtherNativeOrderCache = new Map();

    Array.from(history.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) {
        return;
      }
      if (child.classList.contains(FOLDER_HEADER_CLASS)) {
        currentHeaders.set(child.dataset.folderId || "", child);
        return;
      }
      if (child.classList.contains(FOLDER_EMPTY_CLASS)) {
        currentEmptyStates.set(child.dataset.folderId || "", child);
      }
    });

    folderPlans.forEach((plan) => {
      const { folder, emptyVisible, emptyOrder } = plan;
      let header = currentHeaders.get(folder.id);
      if (!(header instanceof HTMLElement)) {
        header = document.createElement("div");
        header.className = FOLDER_HEADER_CLASS;
        header.setAttribute(FOLDER_DROPZONE_ATTR, "folder");
        header.innerHTML = `
          <span class="chatgpt-toolkit-folder-chevron" aria-hidden="true"></span>
          <span class="chatgpt-toolkit-folder-name"></span>
          <span class="chatgpt-toolkit-folder-count"></span>
          <button type="button" class="chatgpt-toolkit-folder-menu-btn" data-folder-action="open-menu" aria-label="${t("folder.menuOpenAria")}">
            <span aria-hidden="true">···</span>
          </button>
        `;
        history.appendChild(header);
      }

      currentHeaders.delete(folder.id);
      const folderSignature = createFolderPlanSignature(plan);
      const previousRender = previousFolderRenderCache.get(folder.id);
      const shouldSyncHeader =
        !(previousRender?.header instanceof HTMLElement) ||
        previousRender.header !== header ||
        previousRender.signature !== folderSignature;
      if (shouldSyncHeader) {
        syncFolderHeaderPresentation(header, plan);
      }

      if (emptyVisible) {
        let emptyState = currentEmptyStates.get(folder.id);
        if (!(emptyState instanceof HTMLElement)) {
          emptyState = document.createElement("div");
          emptyState.className = FOLDER_EMPTY_CLASS;
          emptyState.setAttribute(FOLDER_DROPZONE_ATTR, "folder");
          emptyState.textContent = t("folder.emptyHint");
          history.appendChild(emptyState);
        }

        currentEmptyStates.delete(folder.id);
        const emptySignature = `${folder.id}|${emptyOrder}`;
        const shouldSyncEmpty =
          !(previousRender?.emptyState instanceof HTMLElement) ||
          previousRender.emptyState !== emptyState ||
          previousRender.emptySignature !== emptySignature;
        if (shouldSyncEmpty) {
          syncFolderEmptyStatePresentation(emptyState, folder.id, emptyOrder);
        }
        nextFolderRenderCache.set(folder.id, {
          signature: folderSignature,
          header,
          emptyState,
          emptySignature,
        });
      } else {
        const emptyState = currentEmptyStates.get(folder.id);
        if (emptyState instanceof HTMLElement) {
          emptyState.remove();
        }
        currentEmptyStates.delete(folder.id);
        nextFolderRenderCache.set(folder.id, {
          signature: folderSignature,
          header,
          emptyState: null,
          emptySignature: "",
        });
      }
    });

    conversationItems.forEach((item) => {
      const plan = conversationPlans.get(item) || {
        order: 0,
        folderId: "",
        collapsed: false,
      };
      syncConversationDragAttributes(item);
      const conversationId = getConversationIdFromItem(item);
      const presentationNode = getConversationPresentationNode(item, history) || item;
      const signature = createConversationPlanSignature(plan);
      const previousRender = conversationId ? previousConversationRenderCache.get(conversationId) : null;
      const shouldSync =
        !conversationId ||
        !(previousRender?.node instanceof HTMLElement) ||
        previousRender.node !== presentationNode ||
        previousRender.signature !== signature;

      if (shouldSync) {
        syncConversationItemPresentation(item, plan);
      }

      if (!conversationId) {
        return;
      }

      if (
        previousRender?.node instanceof HTMLElement &&
        previousRender.node !== presentationNode &&
        previousRender.node.isConnected &&
        previousRender.node.parentElement === history
      ) {
        clearConversationPresentationNode(previousRender.node);
      }

      nextConversationRenderCache.set(conversationId, {
        signature,
        node: presentationNode,
      });
    });

    previousConversationRenderCache.forEach((renderState, conversationId) => {
      if (nextConversationRenderCache.has(conversationId)) {
        return;
      }
      if (
        renderState?.node instanceof HTMLElement &&
        renderState.node.isConnected &&
        renderState.node.parentElement === history
      ) {
        clearConversationPresentationNode(renderState.node);
      }
    });

    otherNativeChildren.forEach((child) => {
      const nextOrder = otherNativePlans.get(child) ?? 0;
      if (previousOtherNativeOrderCache.get(child) !== nextOrder) {
        applyFolderNodeOrder(child, nextOrder);
      }
      nextOtherNativeOrderCache.set(child, nextOrder);
    });

    previousOtherNativeOrderCache.forEach((_, node) => {
      if (!(node instanceof HTMLElement) || nextOtherNativeOrderCache.has(node)) {
        return;
      }
      if (node.parentElement === history) {
        node.style.order = "";
      }
    });

    currentHeaders.forEach((node) => node.remove());
    currentEmptyStates.forEach((node) => node.remove());

    folderState.folderRenderCache = nextFolderRenderCache;
    folderState.conversationRenderCache = nextConversationRenderCache;
    folderState.otherNativeOrderCache = nextOtherNativeOrderCache;

    syncUngroupedButtonPresentation(manager, ungroupedItems.length);
  });

  if (folderState.menuFolderId && !getFolderById(folderState.menuFolderId)) {
    closeFolderMenu();
  }

  syncToolkitTheme();
};

const scheduleFolderRefresh = () => {
  hydrateFolders();

  if (folderState.draggingConversationId || folderState.draggingFolderId) {
    folderState.refreshPending = true;
    return;
  }

  if (folderState.refreshQueued) {
    return;
  }

  folderState.refreshQueued = true;
  requestAnimationFrame(() => {
    folderState.refreshQueued = false;
    renderFolders();
  });
};

const handleFolderHistoryClick = (event) => {
  if (folderState.draggingFolderId) {
    return;
  }

  const target = getSafeEventTarget(event);
  if (!(target instanceof Element) || !(folderState.history instanceof HTMLElement)) {
    return;
  }

  const menuButton = target.closest("[data-folder-action='open-menu']");
  if (menuButton instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    openFolderMenu(menuButton.dataset.folderId || "", menuButton);
    return;
  }

  const header = target.closest(`.${FOLDER_HEADER_CLASS}`);
  if (!(header instanceof HTMLElement) || header.parentElement !== folderState.history) {
    return;
  }

  event.preventDefault();
  toggleFolder(header.dataset.folderId || "");
};

const handleFolderDragStart = (event) => {
  const target = getSafeEventTarget(event);
  const folderHeader =
    target instanceof Element ? target.closest(`.${FOLDER_HEADER_CLASS}`) : null;
  if (
    folderHeader instanceof HTMLElement &&
    folderHeader.parentElement === folderState.history &&
    !target?.closest("[data-folder-action='open-menu']")
  ) {
    const folderId = folderHeader.dataset.folderId || "";
    if (!folderId || folderState.folders.length < 2) {
      return;
    }

    folderState.draggingFolderId = folderId;
    folderState.draggingConversationId = null;
    prepareFolderDragLayout("folder-sort");
    document.documentElement.setAttribute(FOLDER_SORTING_ATTR, "1");
    clearDropZoneHighlight();
    folderHeader.classList.add("is-sort-dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", `folder:${folderId}`);
      } catch (error) {
        // Ignore drag payload errors.
      }
    }
    return;
  }

  const conversationItem = getConversationItemFromTarget(target);
  if (!(conversationItem instanceof HTMLAnchorElement)) {
    return;
  }
  if (shouldBlockConversationDragStart(event, conversationItem)) {
    event.preventDefault();
    return;
  }

  const conversationId = getConversationIdFromItem(conversationItem);
  if (!conversationId) {
    return;
  }

  folderState.draggingConversationId = conversationId;
  folderState.draggingFolderId = null;
  prepareFolderDragLayout("conversation");
  clearFolderSortHighlight();
  document.documentElement.setAttribute(FOLDER_DRAGGING_ATTR, "1");

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", conversationId);
    } catch (error) {
      // Ignore drag payload errors.
    }
  }
};

const handleFolderDragOver = (event) => {
  if (folderState.draggingFolderId) {
    const placement = getFolderSortPlacement(event?.clientX, event?.clientY);
    if (!placement) {
      clearFolderSortHighlight();
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    setFolderSortHighlight(placement.element, placement.key, placement.position);
    return;
  }

  if (!folderState.draggingConversationId) {
    return;
  }

  const dropZone = getConversationDropPlacementFromEvent(event);
  if (!dropZone) {
    clearDropZoneHighlight();
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  setDropZoneHighlight(dropZone.element, dropZone.key, dropZone.highlightMode || "fill");
};

const handleFolderDrop = (event) => {
  if (folderState.draggingFolderId) {
    const draggedFolderId = folderState.draggingFolderId;
    const placement = getFolderSortPlacement(event?.clientX, event?.clientY);
    clearFolderDragState();

    if (!placement) {
      return;
    }

    event.preventDefault();
    reorderFolders(draggedFolderId, placement.targetFolderId, placement.position);
    return;
  }

  if (!folderState.draggingConversationId) {
    return;
  }

  const conversationId = folderState.draggingConversationId;
  const dropZone = getConversationDropPlacementFromEvent(event);
  clearFolderDragState();

  if (!dropZone) {
    return;
  }

  event.preventDefault();

  if (dropZone.type === "ungrouped") {
    unassignConversation(conversationId);
    return;
  }

  if (dropZone.type === "folder" && dropZone.folderId) {
    moveConversationToFolderPosition(conversationId, dropZone.folderId, {
      targetConversationId: dropZone.targetConversationId || null,
      position: dropZone.position || "after",
    });
  }
};

const bindFolderHistoryEvents = (history) => {
  if (!(history instanceof HTMLElement) || history.hasAttribute(FOLDER_BOUND_ATTR)) {
    return;
  }

  history.addEventListener("click", handleFolderHistoryClick);
  history.setAttribute(FOLDER_BOUND_ATTR, "1");
};

const bindFolderGlobalEvents = () => {
  if (folderState.initialized) {
    return;
  }

  folderState.initialized = true;

  document.addEventListener("pointerdown", trackFolderPointerDownDragGuard, true);
  document.addEventListener("dragstart", handleFolderDragStart, true);
  document.addEventListener("dragover", handleFolderDragOver, true);
  document.addEventListener("drop", handleFolderDrop, true);
  document.addEventListener("dragend", clearFolderDragState, true);

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = getSafeEventTarget(event);
      const menu = document.getElementById(FOLDER_MENU_ID);
      if (!(menu instanceof HTMLElement) || !menu.classList.contains("is-visible")) {
        return;
      }

      if (target instanceof Element && (menu.contains(target) || target.closest("[data-folder-action='open-menu']"))) {
        return;
      }

      closeFolderMenu();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFolderMenu();
    }
  });
};

const initFolders = () => {
  hydrateFolders();
  bindFolderGlobalEvents();
  scheduleFolderRefresh();
  void hydrateFoldersFromExtension();
};
