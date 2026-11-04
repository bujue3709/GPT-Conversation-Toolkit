/*
 * ChatGPT Conversation Toolkit - Shared conversation index
 *
 * The index is the single source of truth for the current branch: history
 * counts, timeline entries and export content all read it. Mounted DOM nodes are
 * a separate concern - a node may disappear when the page virtualises a turn,
 * but the index entry stays.
 */
const CONVERSATION_INDEX_SCHEMA_VERSION = 2;
const CONVERSATION_INDEX_CAPTURE_REFRESH_DELAY_MS = 350;

let conversationIndexRefreshTimer = null;
let conversationIndexReadController = null;

const normalizeConversationIndexText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const truncateConversationIndexPreview = (value, maxLength = 160) => {
  const text = normalizeConversationIndexText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
};

const getConversationIndexIdCandidates = () =>
  typeof getStrictConversationIdCandidates === "function"
    ? getStrictConversationIdCandidates()
    : [];

const getCurrentConversationIndexId = () => getConversationIndexIdCandidates()[0] || "";

const isConversationIndexForCurrentConversation = () => {
  const candidates = getConversationIndexIdCandidates();
  if (!candidates.length || !conversationIndexState.conversationId) {
    return false;
  }
  /*
   * Project conversations expose several ids (the project id from
   * `[data-conversation-id]` and the conversation uuid from the URL). Which one
   * comes first depends on how much of the thread is mounted, so an index built
   * with one of them must still count as "this conversation" when the other is
   * the current head. Comparing against the whole candidate set keeps the full
   * history visible while the export panel — which tries every candidate — works.
   */
  return candidates.includes(conversationIndexState.conversationId);
};

const clearConversationIndexMaps = () => {
  conversationIndexState.byMessageId = new Map();
  conversationIndexState.byIndex = new Map();
  conversationIndexState.byUserOrder = new Map();
};

/*
 * A failed refresh must not destroy a usable index. The previous messages stay
 * available (status "stale" plus the time they were loaded) so the timeline can
 * keep the full history and export can still use the cached branch.
 */
const setConversationIndexFailed = (conversationId, error) => {
  const previousId = conversationIndexState.conversationId || "";
  const hasPrevious = conversationIndexState.messages.length > 0;
  const previousIsCurrent =
    Boolean(previousId) && getConversationIndexIdCandidates().includes(previousId);
  const sameConversation =
    !conversationId || !previousId || previousId === conversationId || previousIsCurrent;
  conversationIndexState.error = normalizeExportApiError(error);
  conversationIndexState.failedAt = Date.now();

  if (hasPrevious && sameConversation) {
    conversationIndexState.status = "stale";
    conversationIndexState.conversationId = previousId || conversationId || "";
    if (timelineState.visible && typeof scheduleTimelineRefresh === "function") scheduleTimelineRefresh();
    return;
  }

  conversationIndexState.conversationId = conversationId || "";
  conversationIndexState.title = "";
  conversationIndexState.source = "";
  conversationIndexState.status = "failed";
  conversationIndexState.messages = [];
  conversationIndexState.userMessages = [];
  conversationIndexState.loadedAt = 0;
  conversationIndexState.warnings = [];
  conversationIndexState.completeness = null;
  conversationIndexState.branchId = "";
  conversationIndexState.dataSource = "";
  clearConversationIndexMaps();
  // A failure must clear a pending placeholder count in the timeline.
  if (timelineState.visible && typeof scheduleTimelineRefresh === "function") {
    scheduleTimelineRefresh();
  }
};

const indexConversationMessages = (messages) => {
  const byMessageId = new Map();
  const byIndex = new Map();
  const byUserOrder = new Map();
  const userMessages = [];

  messages.forEach((message) => {
    byIndex.set(message.index, message);
    if (message.messageId) {
      byMessageId.set(message.messageId, message);
    }
    if (message.role === "user") {
      userMessages.push(message);
      if (Number.isFinite(message.userOrder)) {
        byUserOrder.set(message.userOrder, message);
      }
    }
  });

  return {
    byMessageId,
    byIndex,
    byUserOrder,
    userMessages,
  };
};

const normalizeConversationIndexMessage = (node, rawIndex, conversationModel, userOrderRef) => {
  const apiMessage = normalizeApiMessage(node, rawIndex, conversationModel);
  if (!apiMessage) {
    return null;
  }

  const messageId = apiMessage.id || node?.id || "";
  const text = normalizeExportMessageText(apiMessage.text || "");
  const markdown = normalizeExportMarkdownText(apiMessage.markdown || apiMessage.text || "");
  const userOrder = apiMessage.role === "user" ? userOrderRef.next++ : null;

  return {
    key: `api:${messageId || rawIndex}`,
    messageId,
    parentId: apiMessage.parentId || "",
    role: apiMessage.role || "unknown",
    authorName: apiMessage.authorName || "",
    channel: apiMessage.channel || "",
    endTurn: apiMessage.endTurn ?? null,
    recipient: apiMessage.recipient || "",
    content: apiMessage.content || [],
    index: rawIndex,
    userOrder,
    text,
    markdown,
    previewText: truncateConversationIndexPreview(text || markdown),
    createTime: apiMessage.createTime || "",
    updateTime: apiMessage.updateTime || "",
    status: apiMessage.status || "",
    model: apiMessage.model || "",
    attachments: Array.isArray(apiMessage.attachments) ? apiMessage.attachments : [],
    // Export needs the original image references; timeline keeps them too so a
    // cached export does not silently lose images.
    images: Array.isArray(apiMessage.images) ? apiMessage.images : [],
    parts: Array.isArray(apiMessage.parts) ? apiMessage.parts : [],
    metadata: apiMessage.metadata || {},
    source: "api",
    node: null,
  };
};

const renumberConversationIndexMessages = (messages) => {
  let userOrder = 1;
  return messages.map((message, index) => {
    const next = { ...message, index: index + 1 };
    if (next.role === "user") {
      next.userOrder = userOrder;
      userOrder += 1;
    } else {
      next.userOrder = null;
    }
    return next;
  });
};

/*
 * Use the new active path, adding only its known older prefix. Unmounted
 * ancestors remain available; abandoned branch tails are never prepended.
 */
const mergeConversationIndexMessageLists = (previousMessages, nextMessages) => {
  if (!Array.isArray(previousMessages) || previousMessages.length === 0) {
    return nextMessages;
  }

  if (!nextMessages.length) return previousMessages;
  const first = nextMessages[0];
  const overlap = previousMessages.findIndex((message) => message.messageId === first.messageId);
  if (overlap >= 0) {
    // The new active path supplies the tail. Only its known older prefix survives.
    return renumberConversationIndexMessages([...previousMessages.slice(0, overlap), ...nextMessages]);
  }
  const byId = new Map(previousMessages.map((message) => [message.messageId, message]));
  const seen = new Set(nextMessages.map((message) => message.messageId));
  const prefix = [];
  let cursor = first.parentId;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = byId.get(cursor);
    prefix.push(parent);
    cursor = parent.parentId;
  }
  return renumberConversationIndexMessages([...prefix.reverse(), ...nextMessages]);
};

const buildConversationIndexFromApiResponse = (data, options = {}) => {
  const warnings = [];
  const mapping = getApiMapping(data);
  if (!mapping) {
    throw new ExportApiError("INVALID_RESPONSE", "Conversation API response has no message mapping.", {
      fallbackAllowed: true,
    });
  }

  const currentNodeId = resolveApiCurrentNodeId(data, mapping, warnings);
  if (!currentNodeId) {
    throw new ExportApiError("INVALID_RESPONSE", "Conversation API response has no active message path.", {
      fallbackAllowed: true,
    });
  }

  const conversationModel =
    data?.default_model_slug ||
    data?.model_slug ||
    data?.conversation?.default_model_slug ||
    "";
  const userOrderRef = { next: 1 };
  const messages = buildActiveApiNodePath(mapping, currentNodeId, warnings)
    .map((node, index) => normalizeConversationIndexMessage(node, index + 1, conversationModel, userOrderRef))
    .filter(Boolean);

  if (messages.length === 0) {
    throw new ExportApiError("EMPTY_INDEX", "Conversation API response has no usable messages.", {
      fallbackAllowed: true,
    });
  }

  const completeness =
    options.completeness ||
    (typeof assessConversationCompleteness === "function"
      ? assessConversationCompleteness(data, { source: options.dataSource || "conversation" })
      : { complete: true, chainComplete: true, paginationComplete: true, paginated: false, pageCount: 0 });

  if (completeness?.complete === false) {
    warnings.push("conversation_index_may_be_partial");
  }

  const renumbered = renumberConversationIndexMessages(messages);
  const maps = indexConversationMessages(renumbered);
  return {
    conversationId: options.conversationId || data?.conversation_id || data?.id || "",
    title: resolveConversationTitleFromApi(data),
    source: "api",
    status: "ready",
    version: CONVERSATION_INDEX_SCHEMA_VERSION,
    messages: renumbered,
    userMessages: maps.userMessages,
    byMessageId: maps.byMessageId,
    byIndex: maps.byIndex,
    byUserOrder: maps.byUserOrder,
    loadedAt: Date.now(),
    updatedAt: Date.now(),
    completeness,
    branchId: currentNodeId,
    dataSource: options.dataSource || "conversation-api",
    warnings: uniqueExportWarnings(warnings),
    error: null,
  };
};

const applyConversationIndex = (index, options = {}) => {
  conversationIndexState.conversationId = index.conversationId || "";
  conversationIndexState.title = index.title || "";
  conversationIndexState.source = index.source || "";
  conversationIndexState.status = index.status || "ready";
  conversationIndexState.version += 1;
  conversationIndexState.messages = index.messages || [];
  conversationIndexState.userMessages = index.userMessages || [];
  conversationIndexState.byMessageId = index.byMessageId || new Map();
  conversationIndexState.byIndex = index.byIndex || new Map();
  conversationIndexState.byUserOrder = index.byUserOrder || new Map();
  conversationIndexState.loadedAt = index.loadedAt || Date.now();
  conversationIndexState.updatedAt = index.updatedAt || index.loadedAt || Date.now();
  conversationIndexState.completeness = index.completeness || null;
  conversationIndexState.branchId = index.branchId || "";
  conversationIndexState.dataSource = index.dataSource || "";
  conversationIndexState.warnings = index.warnings || [];
  conversationIndexState.error = index.error || null;
  if (options.persist !== false) {
    scheduleConversationIndexCacheSave();
  }
  // The timeline count has to follow every index transition, including the
  // "loading" -> "ready" flip that replaces a placeholder count.
  if (timelineState.visible && typeof scheduleTimelineRefresh === "function") {
    scheduleTimelineRefresh();
  }
};

const invalidateConversationIndex = () => {
  conversationIndexReadController?.abort();
  conversationIndexReadController = null;
  conversationIndexState.activeToken += 1;
  conversationIndexState.loadingPromise = null;
  conversationIndexState.conversationId = "";
  conversationIndexState.title = "";
  conversationIndexState.source = "";
  conversationIndexState.status = "idle";
  conversationIndexState.messages = [];
  conversationIndexState.userMessages = [];
  conversationIndexState.loadedAt = 0;
  conversationIndexState.updatedAt = 0;
  conversationIndexState.completeness = null;
  conversationIndexState.branchId = "";
  conversationIndexState.dataSource = "";
  conversationIndexState.warnings = [];
  conversationIndexState.error = null;
  clearConversationIndexMaps();
  conversationIndexRestoreId = "";
  conversationIndexAutoRefreshId = "";
};

/*
 * Persistence
 *
 * A 403, a reload or a closed tab must not erase a history that was already
 * obtained. The active branch is written to extension storage, capped by size
 * and by conversation count, and always comes back as "stale" - never as a
 * fresh index. Nothing about the title, account or cookies leaves the machine.
 */
const CONVERSATION_INDEX_CACHE_STORAGE_KEY = "conversationIndexCache";
const CONVERSATION_INDEX_CACHE_SCHEMA = 2;
const CONVERSATION_INDEX_CACHE_LIMIT = 3;
const CONVERSATION_INDEX_CACHE_CONVERSATION_MAX_BYTES = 2 * 1024 * 1024;
const CONVERSATION_INDEX_CACHE_SAVE_DELAY_MS = 500;

let conversationIndexCacheSaveTimer = null;
let conversationIndexCacheReadPromise = null;
let conversationIndexCacheWriteChain = Promise.resolve();
let conversationIndexRestorePromise = null;
let conversationIndexRestoreId = "";
let conversationIndexAutoRefreshId = "";

const createEmptyConversationIndexCache = () => ({
  schema: CONVERSATION_INDEX_CACHE_SCHEMA,
  byId: {},
});

const normalizeConversationIndexCache = (raw) => {
  const cache = createEmptyConversationIndexCache();
  const byId = raw && typeof raw === "object" ? raw.byId : null;
  if (!byId || typeof byId !== "object") {
    return cache;
  }
  Object.keys(byId).forEach((conversationId) => {
    const entry = byId[conversationId];
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.messages)) return;
    if (entry.messages.length === 0) return;
    cache.byId[conversationId] = entry;
  });
  return cache;
};

const getConversationIndexCacheArea = () =>
  typeof getExtensionStorageArea === "function" ? getExtensionStorageArea() : null;

const readConversationIndexCache = (force = false) => {
  if (force) {
    conversationIndexCacheReadPromise = null;
  }
  if (conversationIndexCacheReadPromise) {
    return conversationIndexCacheReadPromise;
  }
  const storageArea = getConversationIndexCacheArea();
  conversationIndexCacheReadPromise = new Promise((resolve) => {
    if (!storageArea) {
      resolve(createEmptyConversationIndexCache());
      return;
    }
    try {
      storageArea.get([CONVERSATION_INDEX_CACHE_STORAGE_KEY], (result) => {
        if (typeof chrome !== "undefined") void chrome.runtime?.lastError;
        resolve(normalizeConversationIndexCache(result?.[CONVERSATION_INDEX_CACHE_STORAGE_KEY]));
      });
    } catch (error) {
      resolve(createEmptyConversationIndexCache());
    }
  });
  return conversationIndexCacheReadPromise;
};

const writeConversationIndexCache = (cache) => {
  const storageArea = getConversationIndexCacheArea();
  if (!storageArea) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      storageArea.set({ [CONVERSATION_INDEX_CACHE_STORAGE_KEY]: cache }, () => {
        const error = typeof chrome !== "undefined" ? chrome.runtime?.lastError : null;
        resolve(!error);
      });
    } catch (error) {
      resolve(false);
    }
  });
};

const buildConversationIndexCacheEntry = (index) => {
  const messages = (index.messages || []).map((message) => ({
    key: message.key,
    messageId: message.messageId,
    parentId: message.parentId,
    role: message.role,
    authorName: message.authorName,
    channel: message.channel,
    endTurn: message.endTurn,
    recipient: message.recipient,
    content: message.content,
    index: message.index,
    userOrder: message.userOrder,
    text: message.text,
    markdown: message.markdown,
    previewText: message.previewText,
    createTime: message.createTime,
    updateTime: message.updateTime,
    status: message.status,
    model: message.model,
    attachments: message.attachments,
    parts: message.parts,
    metadata: message.metadata,
    // source is intentionally non-enumerable in exports. Persist it explicitly
    // in local extension storage, then restore it as a private property again.
    images: (message.images || []).map((image) => ({
      ...image, source: image.source, messageId: image.messageId,
    })),
    source: message.source || "api",
  }));

  const entry = {
    conversationId: index.conversationId,
    title: index.title || "",
    savedAt: Date.now(),
    loadedAt: index.loadedAt || 0,
    updatedAt: index.updatedAt || index.loadedAt || 0,
    completeness: index.completeness || null,
    branchId: index.branchId || "",
    dataSource: index.dataSource || "",
    warnings: index.warnings || [],
    messages,
  };

  const bytes = JSON.stringify(entry).length * 2;
  if (!messages.length || bytes > CONVERSATION_INDEX_CACHE_CONVERSATION_MAX_BYTES) {
    return null;
  }
  return { entry, bytes };
};

const saveConversationIndexToCache = async () => {
  const index = conversationIndexState;
  if (!index.conversationId || !index.messages.length) {
    return false;
  }
  // A restored entry is already on disk; re-writing it would only churn.
  if (index.dataSource === "storage-cache") {
    return false;
  }
  const built = buildConversationIndexCacheEntry(index);
  if (!built) {
    return false;
  }
  const cache = await readConversationIndexCache(true);
  cache.byId[index.conversationId] = built.entry;
  Object.keys(cache.byId)
    .sort((left, right) => (cache.byId[right]?.savedAt || 0) - (cache.byId[left]?.savedAt || 0))
    .slice(CONVERSATION_INDEX_CACHE_LIMIT)
    .forEach((staleId) => {
      delete cache.byId[staleId];
    });
  return writeConversationIndexCache(cache);
};

const scheduleConversationIndexCacheSave = () => {
  clearTimeout(conversationIndexCacheSaveTimer);
  conversationIndexCacheSaveTimer = setTimeout(() => {
    conversationIndexCacheSaveTimer = null;
    conversationIndexCacheWriteChain = conversationIndexCacheWriteChain
      .then(() => saveConversationIndexToCache())
      .catch(() => false);
  }, CONVERSATION_INDEX_CACHE_SAVE_DELAY_MS);
};

const restoreConversationIndexFromCache = async (conversationId) => {
  const targetIds = [conversationId, ...getConversationIndexIdCandidates()].filter(
    (id, index, list) => Boolean(id) && list.indexOf(id) === index,
  );
  if (!targetIds.length) {
    return null;
  }
  const cache = await readConversationIndexCache();
  // The stored entry may be filed under any of the conversation's ids.
  const targetId = targetIds.find((id) => cache.byId[id]?.messages?.length) || "";
  const entry = targetId ? cache.byId[targetId] : null;
  if (!entry || !Array.isArray(entry.messages) || entry.messages.length === 0) {
    return null;
  }

  if (!getConversationIndexIdCandidates().includes(targetId)) return null;
  // A network read may have completed while storage was being read.
  if (isConversationIndexForCurrentConversation() && conversationIndexState.status === "ready") {
    return conversationIndexState;
  }
  const messages = entry.messages.map((message) => ({
    ...message,
    images: (message.images || []).map((image) =>
      typeof makeExportImage === "function" ? makeExportImage(image.source, image) : image),
    node: null,
    source: message.source || "api",
  }));
  const maps = indexConversationMessages(messages);

  applyConversationIndex(
    {
      conversationId: targetId,
      title: entry.title || "",
      source: "storage-cache",
      status: "stale",
      messages,
      userMessages: maps.userMessages,
      byMessageId: maps.byMessageId,
      byIndex: maps.byIndex,
      byUserOrder: maps.byUserOrder,
      loadedAt: entry.loadedAt || entry.savedAt || 0,
      updatedAt: entry.updatedAt || entry.savedAt || 0,
      completeness: entry.completeness || null,
      branchId: entry.branchId || "",
      dataSource: "storage-cache",
      warnings: uniqueExportWarnings([
        ...(entry.warnings || []),
        "conversation_index_from_storage",
      ]),
      error: conversationIndexState.error || null,
    },
    { persist: false },
  );

  if (timelineState.visible && typeof scheduleTimelineRefresh === "function") {
    scheduleTimelineRefresh();
  }
  return conversationIndexState;
};

/*
 * Restores the stored index for the current conversation once per page load, so
 * the timeline and the export panel can answer before (or instead of) a network
 * read. Callers that need data immediately await this.
 */
const ensureConversationIndexRestored = async () => {
  const candidates = getConversationIndexIdCandidates();
  const conversationId = candidates[0] || "";
  if (!conversationId) {
    return null;
  }
  const restoreKey = candidates.join("|");
  if (
    conversationIndexState.messages.length > 0 &&
    candidates.includes(conversationIndexState.conversationId)
  ) {
    return conversationIndexState;
  }
  if (conversationIndexRestorePromise && conversationIndexRestoreId === restoreKey) {
    return conversationIndexRestorePromise;
  }
  conversationIndexRestoreId = restoreKey;
  const restorePromise = restoreConversationIndexFromCache(conversationId)
    .catch(() => null)
    .finally(() => {
      if (conversationIndexRestorePromise === restorePromise) {
        conversationIndexRestorePromise = null;
      }
    });
  conversationIndexRestorePromise = restorePromise;
  return restorePromise;
};

const isConversationIndexUsable = (index) =>
  Boolean(
    index &&
      (index.status === "ready" || index.status === "stale") &&
      index.messages.length > 0 &&
      isConversationIndexForCurrentConversation(),
  );

// Kept for existing callers: a stale-but-usable index still answers "how many
// turns does this branch have?". Staleness is reported separately.
const getReadyConversationIndex = () => {
  if (isConversationIndexUsable(conversationIndexState)) {
    return conversationIndexState;
  }
  return null;
};

const getFreshConversationIndex = () => {
  if (conversationIndexState.status === "ready" && isConversationIndexUsable(conversationIndexState)) {
    return conversationIndexState;
  }
  return null;
};

const isConversationIndexStale = () =>
  conversationIndexState.status === "stale" && conversationIndexState.messages.length > 0;

const isConversationIndexRefreshing = () => Boolean(conversationIndexState.loadingPromise) || conversationIndexState.status === "loading";

// True while a stored index for this page load is being read from extension
// storage. The timeline uses it to show "loading" instead of a partial count.
const isConversationIndexRestoring = () => Boolean(conversationIndexRestorePromise);

const canLoadConversationIndex = () => {
  if (typeof isConversationAccessBlocked !== "function") {
    return true;
  }
  const candidates = getConversationIndexIdCandidates();
  if (!candidates.length) {
    return true;
  }
  return !candidates.some((id) => isConversationAccessBlocked(id));
};

const canAutomaticallyLoadConversationIndex = () => {
  const id = getCurrentConversationIndexId();
  return Boolean(id && conversationIndexAutoRefreshId !== id);
};

const loadConversationIndex = async (options = {}) => {
  const conversationIdCandidates = getConversationIndexIdCandidates();
  const conversationId = conversationIdCandidates[0] || "";
  if (!conversationId) {
    const error = new ExportApiError("NO_CONVERSATION_ID", "No valid conversation id is available.", {
      fallbackAllowed: true,
    });
    setConversationIndexFailed("", error);
    throw error;
  }

  if (options.force && typeof clearConversationAccessBlock === "function") {
    // An explicit user retry is the only thing that lifts a 403 stop.
    clearConversationAccessBlock();
  }

  // A stored index is available before any request: a blocked server must not
  // leave the timeline and the export panel empty.
  await ensureConversationIndexRestored();

  if (!getConversationIndexIdCandidates().some((id) => conversationIdCandidates.includes(id))) {
    throw new ExportApiError("CANCELLED", "Conversation changed during loading.", { fallbackAllowed: false });
  }
  const usableIndex = getReadyConversationIndex();
  if (
    !options.force &&
    conversationIndexState.loadingPromise &&
    conversationIndexState.conversationId === conversationId
  ) {
    return conversationIndexState.loadingPromise;
  }

  if (!options.force && usableIndex?.status === "ready" &&
      usableIndex.completeness?.complete === true && usableIndex.dataSource !== "storage-cache") {
    return usableIndex;
  }
  if (!options.force && conversationIndexAutoRefreshId === conversationId) {
    // Partial captures and stale caches get one automatic completion attempt.
    // A failed attempt stays settled until an explicit retry or route change.
    if (usableIndex) return usableIndex;
    throw conversationIndexState.error || new ExportApiError("INCOMPLETE_RESPONSE", "Conversation history is unavailable.", { fallbackAllowed: true });
  }

  if (!canLoadConversationIndex()) {
    // Server refused access: do not poll, do not switch endpoints. A complete
    // cached index is still usable, otherwise the failure is reported.
    const cached = getReadyConversationIndex();
    if (cached) {
      return cached;
    }
    const error = new ExportApiError(
      "ACCESS_BLOCKED",
      "Conversation access is blocked; automatic retries are stopped.",
      { fallbackAllowed: false },
    );
    setConversationIndexFailed(conversationId, error);
    throw error;
  }

  const token = conversationIndexState.activeToken + 1;
  conversationIndexState.activeToken = token;
  /*
   * Switching conversations used to relabel the previous conversation's messages
   * with the new id, which made the timeline show the wrong branch and a count
   * that belonged to a conversation the user had already left. Drop the old
   * messages instead of renaming them.
   */
  if (
    conversationIndexState.messages.length > 0 &&
    !getConversationIndexIdCandidates().includes(conversationIndexState.conversationId)
  ) {
    conversationIndexState.messages = [];
    conversationIndexState.userMessages = [];
    conversationIndexState.loadedAt = 0;
    conversationIndexState.updatedAt = 0;
    conversationIndexState.warnings = [];
    conversationIndexState.completeness = null;
    conversationIndexState.branchId = "";
    conversationIndexState.dataSource = "";
    conversationIndexState.status = "idle";
    clearConversationIndexMaps();
  }
  conversationIndexState.conversationId = conversationId;
  // Never downgrade a usable index to "loading": the timeline must keep showing
  // the full history while the refresh is in flight.
  conversationIndexState.status = conversationIndexState.messages.length ? conversationIndexState.status : "loading";
  conversationIndexAutoRefreshId = conversationId;

  conversationIndexReadController?.abort();
  const readController = new AbortController();
  conversationIndexReadController = readController;
  const loadingPromise = fetchConversationByIdCandidates(conversationIdCandidates, {
    signal: readController.signal,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    skipCaptured: options.force === true,
  })
    .then((response) => {
      if (token !== conversationIndexState.activeToken ||
          !getConversationIndexIdCandidates().some((id) => conversationIdCandidates.includes(id))) {
        return conversationIndexState;
      }
      const previous = conversationIndexState;
      const nextIndex = buildConversationIndexFromApiResponse(response.data, {
        conversationId: response.conversationId || conversationId,
        completeness: response.completeness,
        dataSource: response.captured ? "captured-page-response" : "conversation-api",
      });

      const previousBranch = previous.branchId || "";
      const nextBranch = nextIndex.branchId || "";
      const branchChanged = Boolean(previousBranch && nextBranch && previousBranch !== nextBranch);
      const nextComplete = nextIndex.completeness?.complete !== false;

      if (branchChanged && !nextComplete && previous.messages.length > 0) {
        // A different branch that could not be verified must not overwrite the
        // verified index, and the two branches must never be mixed.
        nextIndex.status = "stale";
        nextIndex.messages = previous.messages;
        nextIndex.userMessages = previous.userMessages;
        nextIndex.byMessageId = previous.byMessageId;
        nextIndex.byIndex = previous.byIndex;
        nextIndex.byUserOrder = previous.byUserOrder;
        nextIndex.loadedAt = previous.loadedAt;
        nextIndex.updatedAt = previous.updatedAt;
        nextIndex.branchId = previousBranch;
        nextIndex.completeness = previous.completeness;
        nextIndex.warnings = uniqueExportWarnings([
          ...nextIndex.warnings,
          "conversation_branch_unverified",
        ]);
      } else {
        nextIndex.messages = mergeConversationIndexMessageLists(previous.messages, nextIndex.messages);
        const maps = indexConversationMessages(nextIndex.messages);
        nextIndex.userMessages = maps.userMessages;
        nextIndex.byMessageId = maps.byMessageId;
        nextIndex.byIndex = maps.byIndex;
        nextIndex.byUserOrder = maps.byUserOrder;
        if (branchChanged) {
          nextIndex.branchChanged = true;
        }
      }

      if (response.captured) {
        nextIndex.dataSource = "captured-page-response";
      }
      applyConversationIndex(nextIndex);
      return conversationIndexState;
    })
    .catch((error) => {
      if (token === conversationIndexState.activeToken &&
          getConversationIndexIdCandidates().some((id) => conversationIdCandidates.includes(id))) {
        setConversationIndexFailed(conversationId, error);
      }
      throw normalizeExportApiError(error);
    })
    .finally(() => {
      if (conversationIndexReadController === readController) conversationIndexReadController = null;
      if (token === conversationIndexState.activeToken) {
        conversationIndexState.loadingPromise = null;
        if (timelineState.visible && typeof scheduleTimelineRefresh === "function") scheduleTimelineRefresh();
      }
    });

  conversationIndexState.loadingPromise = loadingPromise;
  if (timelineState.visible && typeof scheduleTimelineRefresh === "function") scheduleTimelineRefresh();
  return loadingPromise;
};

const getConversationIndex = (options = {}) => loadConversationIndex(options);

const mergeIndexFromCapturedResponse = (captured) => {
  if (!getConversationIndexIdCandidates().includes(captured.conversationId || getCurrentConversationIndexId())) return false;
  const previous = conversationIndexState;
  const next = buildConversationIndexFromApiResponse(captured.data, {
    conversationId: captured.conversationId || getCurrentConversationIndexId(),
    dataSource: "captured-page-response",
  });
  const previousBranch = previous.branchId || "";
  const nextBranch = next.branchId || "";
  if (previous.completeness?.complete === true && next.completeness?.complete === false) {
    // A recent page fragment provides no evidence that the verified history
    // became shorter. Keep both its count and its completeness unchanged.
    return false;
  }
  if (previousBranch && nextBranch && previousBranch !== nextBranch && next.completeness?.complete === false) {
    // Passive capture never replaces a verified branch. The timeline keeps its
    // full index and the next explicit refresh re-checks the branch.
    return false;
  }
  next.messages = mergeConversationIndexMessageLists(previous.messages, next.messages);
  const maps = indexConversationMessages(next.messages);
  next.userMessages = maps.userMessages;
  next.byMessageId = maps.byMessageId;
  next.byIndex = maps.byIndex;
  next.byUserOrder = maps.byUserOrder;
  // Passive data must not invalidate an explicit full-history read. The request
  // owns its token and promise until it settles or the route changes.
  applyConversationIndex(next);
  return true;
};

// Capture events already contain a response; never start another request from
// a passive observer, including when that response is incomplete.
const scheduleConversationIndexRefresh = () => {
  clearTimeout(conversationIndexRefreshTimer);
  conversationIndexRefreshTimer = setTimeout(() => {
    conversationIndexRefreshTimer = null;
    const captured = typeof getCapturedConversationApiResponse === "function"
      ? getCapturedConversationApiResponse(getConversationIndexIdCandidates()) : null;
    if (!captured?.data || !isCompleteConversationMapping(captured.data)) return;
    try {
      if (mergeIndexFromCapturedResponse(captured) && timelineState.visible) {
        scheduleTimelineRefresh();
      }
    } catch (error) {}
  }, CONVERSATION_INDEX_CAPTURE_REFRESH_DELAY_MS);
};

window.addEventListener("__chatgptConversationToolkitRouteChange", () => {
  if (conversationIndexState.conversationId && !isConversationIndexForCurrentConversation()) {
    invalidateConversationIndex();
  }
});

window.addEventListener("chatgpt-toolkit-conversation-captured", (event) => {
  const capturedId = event?.detail?.conversationId || "";
  const currentId = getCurrentConversationIndexId();
  if (capturedId && currentId && !getConversationIndexIdCandidates().includes(capturedId)) {
    return;
  }
  scheduleConversationIndexRefresh();
});

/*
 * Read-only diagnostics hook for manual verification. It exposes counts and
 * request metadata only: never message text, titles, cookies or tokens.
 */
window.__CGPT_TOOLKIT_INDEX_DEBUG__ = {
  summary: () => ({
    conversationId: conversationIndexState.conversationId,
    status: conversationIndexState.status,
    messageCount: conversationIndexState.messages.length,
    userMessageCount: conversationIndexState.userMessages.length,
    completeness: conversationIndexState.completeness,
    branchId: conversationIndexState.branchId,
    dataSource: conversationIndexState.dataSource,
    loadedAt: conversationIndexState.loadedAt,
    updatedAt: conversationIndexState.updatedAt,
    failedAt: conversationIndexState.failedAt,
    warnings: conversationIndexState.warnings.slice(),
    error: conversationIndexState.error
      ? { code: conversationIndexState.error.code, status: conversationIndexState.error.status }
      : null,
    access: typeof getConversationAccessStatus === "function" ? getConversationAccessStatus() : null,
  }),
  requests: () => (typeof getExportApiDiagnostics === "function" ? getExportApiDiagnostics() : []),
  cache: async () => {
    const cache = await readConversationIndexCache(true);
    return Object.keys(cache.byId).map((conversationId) => ({
      conversationId,
      messageCount: cache.byId[conversationId]?.messages?.length || 0,
      savedAt: cache.byId[conversationId]?.savedAt || 0,
      updatedAt: cache.byId[conversationId]?.updatedAt || 0,
      branchId: cache.byId[conversationId]?.branchId || "",
    }));
  },
  restore: () => ensureConversationIndexRestored(),
  /*
   * Did the page's own conversation response get captured? This is the fastest
   * way to tell "the extension cannot read the API" apart from "the page never
   * exposed anything to capture".
   */
  captured: () => {
    const captured = typeof getCapturedConversationApiResponse === "function"
      ? getCapturedConversationApiResponse(getConversationIndexIdCandidates())
      : null;
    if (!captured?.data) return null;
    const mapping = captured.data.mapping || captured.data.conversation?.mapping || {};
    return {
      conversationId: captured.conversationId || "",
      captured: true,
      messageCount: Object.keys(mapping).length,
      complete: typeof assessConversationCompleteness === "function"
        ? assessConversationCompleteness(captured.data).complete
        : null,
      url: captured.url || "",
    };
  },
  clearRequests: () => {
    if (typeof clearExportApiDiagnostics === "function") clearExportApiDiagnostics();
  },
  reload: (options = {}) => loadConversationIndex({ force: true, ...options }),
};
