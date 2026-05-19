/*
 * ChatGPT Conversation Toolkit - Global state and configuration
 */
const TOOLKIT_ID = "chatgpt-conversation-toolkit";
const STATUS_ID = "chatgpt-conversation-toolkit-status";
const MINIMIZED_ID = "chatgpt-conversation-toolkit-minimized";
const POSITION_KEY = "chatgpt-toolkit-position";
const TOOLBAR_MINIMIZED_KEY = "chatgpt-toolkit-toolbar-minimized";
const LANGUAGE_PREFERENCE_KEY = "chatgpt-toolkit-language";
const TIMELINE_POSITION_KEY = "chatgpt-toolkit-timeline-position";
const TIMELINE_VISIBLE_KEY = "chatgpt-toolkit-timeline-visible";
const COLLAPSE_MEMORY_STORAGE_KEY = "chatgpt-toolkit-collapse-memory-v1";
const COLLAPSE_MEMORY_LOCAL_FALLBACK_KEY = "chatgpt-toolkit-collapse-memory-fallback";
let COLLAPSE_MEMORY_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
let COLLAPSE_AUTO_REOPTIMIZE_BUFFER = 10;
const COLLAPSE_AUTO_REOPTIMIZE_DELAY_MS = 180;
const TOOLKIT_MESSAGE_MODE_LOADED = "loaded";
const TOOLKIT_MESSAGE_MODE_EXTENDED = "extended";
const TOOLKIT_MESSAGE_MODE_VALUES = Object.freeze([
  TOOLKIT_MESSAGE_MODE_LOADED,
  TOOLKIT_MESSAGE_MODE_EXTENDED,
]);
let TOOLKIT_MESSAGE_MODE = TOOLKIT_MESSAGE_MODE_LOADED;
const TOOLKIT_EXPORT_FORMAT_JSON = "json";
const TOOLKIT_EXPORT_FORMAT_TEXT = "txt";
const TOOLKIT_EXPORT_FORMAT_MARKDOWN = "md";
const TOOLKIT_EXPORT_FORMAT_VALUES = Object.freeze([
  TOOLKIT_EXPORT_FORMAT_JSON,
  TOOLKIT_EXPORT_FORMAT_TEXT,
  TOOLKIT_EXPORT_FORMAT_MARKDOWN,
]);
let TOOLKIT_EXPORT_FORMAT = TOOLKIT_EXPORT_FORMAT_JSON;
const THEME_ATTR = "data-toolkit-theme";
const TIMELINE_ID = "chatgpt-conversation-toolkit-timeline";
const TIMELINE_TRACK_ID = "chatgpt-conversation-toolkit-timeline-track";
const TIMELINE_COUNT_ID = "chatgpt-conversation-toolkit-timeline-count";
const TIMELINE_PREVIEW_ID = "chatgpt-conversation-toolkit-timeline-preview";
const TIMELINE_HINT_ID = "chatgpt-conversation-toolkit-timeline-hint";
const LATEX_COPY_ID = "chatgpt-toolkit-latex-copy";
let TIMELINE_VISIBLE_NODE_CAPACITY = 10;
let TIMELINE_MAX_NODES = 20;
const TIMELINE_CONTENT_CLASS = "chatgpt-toolkit-timeline-content";
const TIMELINE_WHEEL_DISTANCE_SCALE = 0.24;
const TIMELINE_WHEEL_MIN_STEP = 4;
const TIMELINE_WHEEL_MAX_STEP = 72;
const TIMELINE_DRAG_MARGIN = 8;
const TIMELINE_DRAG_THRESHOLD = 4;
const PROMPT_MODAL_ID = "chatgpt-toolkit-prompt-modal";
const PROMPT_FILE_INPUT_ID = "chatgpt-toolkit-prompt-file";
const PROMPT_TOAST_ID = "chatgpt-toolkit-prompt-toast";
const PROMPT_STORAGE_KEY = "chatgpt-toolkit-prompts-v1";
const PROMPT_LOCAL_FALLBACK_KEY = "chatgpt-toolkit-prompts-fallback";
const FOLDER_MANAGER_ID = "chatgpt-toolkit-folder-manager";
const FOLDER_MENU_ID = "chatgpt-toolkit-folder-menu";
const FOLDER_STORAGE_KEY = "chatgpt-toolkit-folders-v1";
const FOLDER_LOCAL_FALLBACK_KEY = "chatgpt-toolkit-folders-fallback";
const FOLDER_ROOT_ATTR = "data-toolkit-folder-root";

const state = {
  isCollapsed: false,
  isMinimized: false,
  keepLatest: 20,
  collapsedNodes: [],
  conversationKey: null,
  anchorNode: null,
  anchorParent: null,
  messageCache: new Map(),
  messageCacheRevision: 0,
  messageStoreLastRefreshAt: 0,
  messageStoreLastConversationKey: "",
  domAdapterHealth: {
    ok: true,
    checkedAt: 0,
    conversationMainFound: false,
    conversationMessageCount: 0,
    sidebarHistoryFound: false,
    issues: [],
  },
  domAdapterHealthSignature: "",
  // 搜索相关状态
  searchQuery: '',
  searchMatches: [],
  currentMatchIndex: -1,
};

const minimizedButtonState = {
  pointerDown: false,
  dragging: false,
};

const promptState = {
  loaded: false,
  isOpen: false,
  items: [],
  filteredItems: [],
  selectedId: null,
  searchText: "",
  category: "all",
  sortBy: "updated-desc",
};
const timelineState = {
  items: [],
  allItems: [],
  sourceNodes: [],
  sourceSignature: "",
  sourceCheckAt: 0,
  totalUserCount: 0,
  activeIndex: -1,
  hoverIndex: -1,
  signature: "",
  contentHeight: 0,
  rendered: false,
  visible: false,
  manualPosition: null,
  pointerDown: false,
  dragging: false,
  refreshPending: false,
};
const conversationIndexState = {
  conversationId: "",
  title: "",
  source: "",
  status: "idle",
  version: 0,
  activeToken: 0,
  loadingPromise: null,
  messages: [],
  userMessages: [],
  byMessageId: new Map(),
  byIndex: new Map(),
  byUserOrder: new Map(),
  loadedAt: 0,
  warnings: [],
  error: null,
};
const virtualJumpState = {
  activeToken: 0,
  targetKey: "",
  attempts: 0,
  lastWindowSignature: "",
};
const virtualizerCalibrationState = {
  offset: 0,
  confidence: 0,
  updatedAt: 0,
};
const folderState = {
  initialized: false,
  loaded: false,
  folders: [],
  assignments: {},
  itemOrders: {},
  section: null,
  headerButton: null,
  history: null,
  nativeList: null,
  previousNativeList: null,
  conversationRenderCache: new Map(),
  folderRenderCache: new Map(),
  otherNativeOrderCache: new Map(),
  menuFolderId: null,
  draggingConversationId: null,
  draggingFolderId: null,
  currentDropZoneKey: "",
  currentSortZoneKey: "",
  dragLayout: null,
  refreshQueued: false,
  refreshPending: false,
  missingHistoryRetryCount: 0,
};
const collapseMemoryState = {
  initialized: false,
  loaded: false,
  entries: {},
  currentConversationKey: "",
  pendingAutoConversationKey: "",
  recentOptionsConversationKey: "",
  recentOptionsAt: 0,
};
let promptToastTimer = null;
let timelineHintTimer = null;
let timelineHighlightTimer = null;
let timelineRefreshTimer = null;
let folderHighlightTimer = null;
let folderSettledRefreshTimer = null;
let folderMissingSectionRetryTimer = null;
let collapseMemoryAutoApplyTimer = null;
let collapseMemoryReoptimizeTimer = null;
let collapseMemoryArchiveCheckTimer = null;
let timelineScrollTicking = false;
let timelineScrollListenerAdded = false;
let themeObserver = null;
let themeMediaQuery = null;
let bodyThemeObserved = false;

const themeAttributeFilter = ["class", "data-theme", "style"];

const TOOLKIT_BOOTSTRAP_FLAG = "__chatgptConversationToolkitBootstrapped";

const TOOLKIT_CONFIG_KEY = "chatgpt-toolkit-config-v2";
const TOOLKIT_CONFIG_DEFAULTS = Object.freeze({
  keepLatest: 20,
  autoReoptimizeBuffer: 10,
  timelineVisibleNodeCapacity: 10,
  timelineMaxNodes: 20,
  collapseMemoryRetentionDays: 10,
  messageMode: TOOLKIT_MESSAGE_MODE_LOADED,
  exportFormat: TOOLKIT_EXPORT_FORMAT_JSON,
});
const TOOLKIT_CONFIG_LIMITS = Object.freeze({
  keepLatest: { min: 1, max: 1000 },
  autoReoptimizeBuffer: { min: 1, max: 1000 },
  timelineVisibleNodeCapacity: { min: 1, max: 100 },
  timelineMaxNodes: { min: 1, max: 100 },
  collapseMemoryRetentionDays: { min: 1, max: 365 },
});

const normalizeToolkitConfigInteger = (value, fallback, limits) => {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  const integerValue = Math.trunc(numberValue);
  return Math.min(Math.max(integerValue, limits.min), limits.max);
};

const normalizeToolkitConfig = (config = {}) => ({
  keepLatest: normalizeToolkitConfigInteger(
    config.keepLatest,
    TOOLKIT_CONFIG_DEFAULTS.keepLatest,
    TOOLKIT_CONFIG_LIMITS.keepLatest,
  ),
  autoReoptimizeBuffer: normalizeToolkitConfigInteger(
    config.autoReoptimizeBuffer,
    TOOLKIT_CONFIG_DEFAULTS.autoReoptimizeBuffer,
    TOOLKIT_CONFIG_LIMITS.autoReoptimizeBuffer,
  ),
  timelineVisibleNodeCapacity: normalizeToolkitConfigInteger(
    config.timelineVisibleNodeCapacity,
    TOOLKIT_CONFIG_DEFAULTS.timelineVisibleNodeCapacity,
    TOOLKIT_CONFIG_LIMITS.timelineVisibleNodeCapacity,
  ),
  timelineMaxNodes: normalizeToolkitConfigInteger(
    config.timelineMaxNodes,
    TOOLKIT_CONFIG_DEFAULTS.timelineMaxNodes,
    TOOLKIT_CONFIG_LIMITS.timelineMaxNodes,
  ),
  collapseMemoryRetentionDays: normalizeToolkitConfigInteger(
    config.collapseMemoryRetentionDays,
    TOOLKIT_CONFIG_DEFAULTS.collapseMemoryRetentionDays,
    TOOLKIT_CONFIG_LIMITS.collapseMemoryRetentionDays,
  ),
  messageMode: TOOLKIT_MESSAGE_MODE_VALUES.includes(config.messageMode)
    ? config.messageMode
    : TOOLKIT_CONFIG_DEFAULTS.messageMode,
  exportFormat: TOOLKIT_EXPORT_FORMAT_VALUES.includes(config.exportFormat)
    ? config.exportFormat
    : TOOLKIT_CONFIG_DEFAULTS.exportFormat,
});

const applyToolkitConfig = (config = {}) => {
  const normalized = normalizeToolkitConfig(config);
  state.keepLatest = normalized.keepLatest;
  COLLAPSE_AUTO_REOPTIMIZE_BUFFER = normalized.autoReoptimizeBuffer;
  TIMELINE_VISIBLE_NODE_CAPACITY = normalized.timelineVisibleNodeCapacity;
  TIMELINE_MAX_NODES = normalized.timelineMaxNodes;
  COLLAPSE_MEMORY_RETENTION_MS = normalized.collapseMemoryRetentionDays * 24 * 60 * 60 * 1000;
  TOOLKIT_MESSAGE_MODE = normalized.messageMode;
  TOOLKIT_EXPORT_FORMAT = normalized.exportFormat;
  return normalized;
};

const getToolkitConfig = () =>
  normalizeToolkitConfig({
    keepLatest: state.keepLatest,
    autoReoptimizeBuffer: COLLAPSE_AUTO_REOPTIMIZE_BUFFER,
    timelineVisibleNodeCapacity: TIMELINE_VISIBLE_NODE_CAPACITY,
    timelineMaxNodes: TIMELINE_MAX_NODES,
    collapseMemoryRetentionDays: Math.floor(COLLAPSE_MEMORY_RETENTION_MS / 86400000),
    messageMode: TOOLKIT_MESSAGE_MODE,
    exportFormat: TOOLKIT_EXPORT_FORMAT,
  });

const loadToolkitConfig = () => {
  try {
    const stored = localStorage.getItem(TOOLKIT_CONFIG_KEY);
    let parsed = {};
    if (stored) {
      const value = JSON.parse(stored);
      if (value && typeof value === "object") {
        parsed = value;
      }
    }

    const normalized = applyToolkitConfig(parsed);
    if (stored && JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      localStorage.setItem(TOOLKIT_CONFIG_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch (e) {}
  return getToolkitConfig();
};

const saveToolkitConfig = (configObj) => {
  try {
    const current = {};
    try {
      const stored = localStorage.getItem(TOOLKIT_CONFIG_KEY);
      if (stored) Object.assign(current, JSON.parse(stored));
    } catch (e) {}
    
    const normalized = applyToolkitConfig({ ...current, ...(configObj || {}) });
    localStorage.setItem(TOOLKIT_CONFIG_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (e) {}
  return getToolkitConfig();
};

loadToolkitConfig();
