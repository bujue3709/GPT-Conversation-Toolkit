/*
 * ChatGPT Conversation Toolkit - Internationalization
 */
const DEFAULT_TOOLKIT_LANGUAGE = "en";
const TOOLKIT_LANGUAGE_AUTO = "auto";
const TOOLKIT_SUPPORTED_LANGUAGES = ["en", "zh-CN"];

const i18nState = {
  preference: TOOLKIT_LANGUAGE_AUTO,
  detected: DEFAULT_TOOLKIT_LANGUAGE,
  locale: DEFAULT_TOOLKIT_LANGUAGE,
};

const I18N_MESSAGES = {
  en: {
    "language.label": "Language",
    "language.auto": "Browser default",
    "language.autoWithLocale": "Browser default ({language})",
    "language.english": "English",
    "language.chinese": "Chinese (Simplified)",

    "toolbar.title": "ChatGPT Toolkit",
    "toolbar.subtitle": "Long threads · Search · Export · Timeline",
    "toolbar.minimize": "Hide",
    "toolbar.minimizeAria": "Hide toolkit",
    "toolbar.expandAria": "Open ChatGPT Toolkit",
    "toolbar.collapse": "Optimize Long Conversation",
    "toolbar.restore": "Restore Hidden Messages",
    "toolbar.export": "Export JSON",
    "toolbar.promptLibrary": "Prompt Library",
    "toolbar.timelineShow": "Show Timeline",
    "toolbar.timelineHide": "Hide Timeline",
    "toolbar.settings": "Settings",
    "toolbar.searchPlaceholder": "Search messages...",
    "toolbar.search": "Search",
    "toolbar.searchTitle": "Search",
    "toolbar.searchPrev": "Prev",
    "toolbar.searchPrevTitle": "Previous match",
    "toolbar.searchNext": "Next",
    "toolbar.searchNextTitle": "Next match",
    "toolbar.ready": "Ready.",
    "toolbar.tip": "Tip: optimization hides older messages, but export still includes them.",
    "toolbar.collapseMemoryBadge": "Auto-optimize enabled",
    "toolbar.collapseMemoryHint": "This conversation will auto-optimize when reopened.",
    "toolbar.starProject": "Like it? Star the project ✨",
    "toolbar.starProjectAria": "Open the GitHub repository and star the project",
    "toolbar.feedback": "I have an optimization idea to share!",
    "toolbar.feedbackAria": "Open the GitHub issue page to share an optimization suggestion",

    "status.collapseNoNeed": "There are not enough messages to optimize.",
    "status.collapseDone": "Optimized: hid {count} older messages.",
    "status.restoreNone": "There are no hidden messages to restore.",
    "status.restoreDone": "All hidden messages have been restored.",
    "status.restoreMemoryCleared": "Auto-optimization is disabled for this conversation.",
    "status.restoreDoneMemoryCleared": "Hidden messages restored. Auto-optimization is disabled for this conversation.",
    "status.exportStarted": "Export started. Check your downloads.",
    "status.exportAlreadyRunning": "Export is already running.",
    "status.exportPreparing": "Preparing export...",
    "status.exportApiLoading": "Loading conversation data...",
    "status.exportApiDone": "Exported {count} messages from conversation data.",
    "status.exportFallback": "Conversation data unavailable. Falling back to loaded messages...",
    "status.exportFallbackDone": "Exported {count} loaded/cached messages. The file may be partial.",
    "status.exportFailed": "Export failed: {reason}",
    "status.searchRestoreFirst": "Restore hidden messages before using search.",
    "status.searchNoMatch": "No matches found.",
    "status.searchNeedLoadMore": "No matches in loaded messages. Scroll up to load more history, then search again.",
    "status.searchScanning": "Scanning loaded messages... {done}/{total}",
    "status.searchApiLoading": "Loading full conversation search index...",
    "status.searchApiScanning": "Scanning full conversation... {done}/{total}",
    "status.searchApiDone": "Full conversation search found {count} matches.",
    "status.searchApiFallback": "Full conversation search is unavailable. Searching loaded messages only.",
    "status.searchJumping": "Locating the matched message...",
    "status.searchJumpFailed": "Located nearby, but the target message is not currently rendered.",
    "status.searchMatchNotLoaded": "This match is cached but not currently rendered. Scroll nearby to load it, then search again.",
    "status.domAdapterDegraded": "ChatGPT DOM changed. Some features may be partially unavailable; compatibility mode is enabled.",
    "status.promptCopyMissing": "Copy failed: prompt not found.",
    "status.promptCopyBlocked": "Copy failed: clipboard access is not available.",
    "status.promptCopyDone": "Copied prompt: {title}",
    "status.promptAddEmpty": "Add failed: prompt content cannot be empty.",
    "status.promptAddDone": "Prompt added.",
    "status.promptDeleteDone": "Prompt deleted.",
    "status.promptExportDone": "Prompt library exported as JSON.",
    "status.promptImportEmpty": "Import failed: the JSON file has no usable prompts.",
    "status.promptImportNoNew": "Import complete: nothing new was added.",
    "status.promptImportDone": "Import complete: added {count} prompts.",
    "status.promptImportInvalid": "Import failed: invalid JSON format.",
    "status.latexCopyDone": "LaTeX copied.",
    "status.latexCopyMissing": "Copy failed: no LaTeX source found.",
    "status.latexCopyBlocked": "Copy failed: clipboard access is not available.",

    "search.noMatch": "No matches",

    "latex.copy": "Copy LaTeX",
    "latex.copyAria": "Copy this formula as LaTeX",

    "timeline.title": "Timeline",
    "timeline.ariaLabel": "Conversation timeline",
    "timeline.hintNoMore": "No more messages.",
    "timeline.hintRestore": "Restore hidden messages first.",
    "timeline.hintLocating": "Locating message...",
    "timeline.hintMessageNotLoaded": "Message is not currently rendered. Scroll nearby to load it.",
    "timeline.countAria": "Current node {current}, total user messages {total}",
    "timeline.jumpAria": "Jump to user message {index}",
    "timeline.previewFallback": "User message {index}",

    "prompt.untitled": "Untitled Prompt",
    "prompt.uncategorized": "Uncategorized",
    "prompt.toastCopyDone": "Copied",
    "prompt.toastCopyFailed": "Copy failed",
    "prompt.title": "Prompt Library",
    "prompt.modalAria": "Prompt library",
    "prompt.close": "Close",
    "prompt.searchPlaceholder": "Search title / content / category",
    "prompt.allCategories": "All categories",
    "prompt.sortUpdatedDesc": "Recently updated",
    "prompt.sortUpdatedAsc": "Oldest updated",
    "prompt.sortTitleAsc": "Title A-Z",
    "prompt.sortTitleDesc": "Title Z-A",
    "prompt.sortCategoryAsc": "Category",
    "prompt.empty": "No prompts available yet.",
    "prompt.titlePlaceholder": "Title (optional)",
    "prompt.categoryPlaceholder": "Category (optional)",
    "prompt.contentPlaceholder": "Enter prompt content",
    "prompt.add": "Add Prompt",
    "prompt.count": "{visible} / {total}",
    "prompt.importJson": "Import JSON",
    "prompt.exportJson": "Export JSON",
    "prompt.delete": "Delete",
    "prompt.itemMetaWithTime": "{category} · {time} · Click to copy",
    "prompt.itemMetaNoTime": "{category} · Click to copy",
    "prompt.deleteConfirm": "Delete prompt “{title}”?",

    "folder.defaultName": "New Folder {index}",
    "folder.managerLabel": "Folders",
    "folder.ungrouped": "Ungrouped",
    "folder.create": "New",
    "folder.menuRename": "Rename",
    "folder.menuDelete": "Delete",
    "folder.menuOpenAria": "Open folder menu",
    "folder.emptyHint": "Drop conversations here",
    "folder.createPrompt": "Enter a folder name",
    "folder.renamePrompt": "Rename folder",
    "folder.deleteConfirm": "Delete folder “{name}”? Conversations inside it will move back to Ungrouped.",

    "settings.title": "Configuration Settings",
    "settings.close": "Close",
    "settings.save": "Save",
    "settings.saved": "Settings saved.",
    "settings.keepLatest.label": "Keep Latest Messages",
    "settings.keepLatest.desc": "Number of most recent messages to keep visible during collapse.",
    "settings.autoReoptimizeBuffer.label": "Auto Re-optimize Buffer",
    "settings.autoReoptimizeBuffer.desc": "Trigger auto collapse after this many new messages.",
    "settings.timelineVisibleNodeCapacity.label": "Timeline Visible Capacity",
    "settings.timelineVisibleNodeCapacity.desc": "The number of nodes visible in the timeline track.",
    "settings.timelineMaxNodes.label": "Timeline Max Nodes",
    "settings.timelineMaxNodes.desc": "Maximum number of messages sampled in the timeline.",
    "settings.collapseMemoryRetentionDays.label": "Memory Retention Days",
    "settings.collapseMemoryRetentionDays.desc": "How many days to remember auto-optimization per conversation.",
    "settings.exportFormat.label": "Chat Export Format",
    "settings.exportFormat.desc": "Choose the file format used by the export button.",
    "settings.exportFormat.json": ".json",
    "settings.exportFormat.txt": ".txt",
    "settings.exportFormat.md": ".md",
    "settings.messageMode.label": "Message Data Mode",
    "settings.messageMode.desc": "Loaded mode is faster. Extended cache mode also uses off-screen cached messages for search/export.",
    "settings.messageMode.loaded": "Loaded only (recommended)",
    "settings.messageMode.extended": "Extended cache",
  },
  "zh-CN": {
    "language.label": "语言",
    "language.auto": "跟随浏览器",
    "language.autoWithLocale": "跟随浏览器（{language}）",
    "language.english": "English",
    "language.chinese": "简体中文",

    "toolbar.title": "ChatGPT 工具",
    "toolbar.subtitle": "长会话 · 搜索 · 导出 · 时间线",
    "toolbar.minimize": "收起",
    "toolbar.minimizeAria": "收起工具",
    "toolbar.expandAria": "展开 ChatGPT 工具",
    "toolbar.collapse": "优化长会话",
    "toolbar.restore": "恢复隐藏消息",
    "toolbar.export": "一键导出",
    "toolbar.promptLibrary": "Prompt 指令",
    "toolbar.timelineShow": "显示时间线",
    "toolbar.timelineHide": "隐藏时间线",
    "toolbar.settings": "设置",
    "toolbar.searchPlaceholder": "搜索消息内容...",
    "toolbar.search": "搜索",
    "toolbar.searchTitle": "搜索",
    "toolbar.searchPrev": "上一条",
    "toolbar.searchPrevTitle": "上一条",
    "toolbar.searchNext": "下一条",
    "toolbar.searchNextTitle": "下一条",
    "toolbar.ready": "准备就绪。",
    "toolbar.tip": "提示：优化会隐藏旧消息，导出时会自动包含隐藏内容。",
    "toolbar.collapseMemoryBadge": "本会话自动优化",
    "toolbar.collapseMemoryHint": "重新进入这个会话时，会自动执行长会话优化。",
    "toolbar.starProject": "觉得好用？给项目点亮✨",
    "toolbar.starProjectAria": "打开 GitHub 项目主页并点亮 Star",
    "toolbar.feedback": "我有优化建议想提！",
    "toolbar.feedbackAria": "打开 GitHub Issue 页面提交优化建议",

    "status.collapseNoNeed": "当前消息数量较少，无需优化。",
    "status.collapseDone": "已优化：隐藏 {count} 条旧消息。",
    "status.restoreNone": "没有需要恢复的消息。",
    "status.restoreDone": "已恢复所有消息。",
    "status.restoreMemoryCleared": "已关闭当前会话的自动优化记忆。",
    "status.restoreDoneMemoryCleared": "已恢复所有消息，并关闭当前会话的自动优化记忆。",
    "status.exportStarted": "导出已开始，请检查下载文件。",
    "status.exportAlreadyRunning": "导出正在进行中。",
    "status.exportPreparing": "正在准备导出...",
    "status.exportApiLoading": "正在读取会话数据...",
    "status.exportApiDone": "已从会话数据导出 {count} 条消息。",
    "status.exportFallback": "无法读取会话数据，正在降级导出已加载消息...",
    "status.exportFallbackDone": "已导出 {count} 条已加载/缓存消息，文件可能不完整。",
    "status.exportFailed": "导出失败：{reason}",
    "status.searchRestoreFirst": "请先恢复隐藏消息，才能使用搜索功能。",
    "status.searchNoMatch": "未找到匹配。",
    "status.searchNeedLoadMore": "当前已加载消息中未找到匹配。请向上滚动加载更多历史消息后重试。",
    "status.searchScanning": "正在扫描已加载消息... {done}/{total}",
    "status.searchApiLoading": "正在加载全量会话搜索索引...",
    "status.searchApiScanning": "正在扫描全量会话... {done}/{total}",
    "status.searchApiDone": "全量会话搜索找到 {count} 条匹配。",
    "status.searchApiFallback": "无法使用全量会话搜索，已改为仅搜索已加载消息。",
    "status.searchJumping": "正在定位匹配消息...",
    "status.searchJumpFailed": "已定位到附近，但目标消息当前未渲染。",
    "status.searchMatchNotLoaded": "\u8fd9\u6761\u5339\u914d\u6d88\u606f\u5df2\u7f13\u5b58\uff0c\u4f46\u5f53\u524d\u672a\u6e32\u67d3\u3002\u8bf7\u6eda\u52a8\u5230\u9644\u8fd1\u52a0\u8f7d\u540e\u518d\u641c\u7d22\u3002",
    "status.domAdapterDegraded": "检测到 ChatGPT DOM 结构变化，部分功能可能受限，已启用兼容模式。",
    "status.promptCopyMissing": "复制失败：未找到对应 Prompt。",
    "status.promptCopyBlocked": "复制失败：浏览器不允许访问剪贴板。",
    "status.promptCopyDone": "已复制 Prompt：{title}",
    "status.promptAddEmpty": "新增失败：Prompt 内容不能为空。",
    "status.promptAddDone": "已新增 Prompt 指令。",
    "status.promptDeleteDone": "已删除 Prompt 指令。",
    "status.promptExportDone": "Prompt 指令已导出为 JSON。",
    "status.promptImportEmpty": "导入失败：JSON 文件中没有可用 Prompt。",
    "status.promptImportNoNew": "导入完成：没有新增内容。",
    "status.promptImportDone": "导入完成：新增 {count} 条 Prompt。",
    "status.promptImportInvalid": "导入失败：请检查 JSON 格式。",
    "status.latexCopyDone": "已复制 LaTeX 公式。",
    "status.latexCopyMissing": "复制失败：未找到公式源码。",
    "status.latexCopyBlocked": "复制失败：浏览器不允许访问剪贴板。",

    "search.noMatch": "未找到匹配",

    "latex.copy": "复制 LaTeX",
    "latex.copyAria": "复制该公式的 LaTeX 源码",

    "timeline.title": "时间线",
    "timeline.ariaLabel": "对话时间线",
    "timeline.hintNoMore": "已经没有消息了",
    "timeline.hintRestore": "请恢复隐藏消息",
    "timeline.hintLocating": "正在定位消息...",
    "timeline.hintMessageNotLoaded": "\u8be5\u6d88\u606f\u5f53\u524d\u672a\u6e32\u67d3\uff0c\u8bf7\u6eda\u52a8\u5230\u9644\u8fd1\u52a0\u8f7d\u3002",
    "timeline.countAria": "当前节点 {current}，总用户节点 {total}",
    "timeline.jumpAria": "跳转到第 {index} 条用户消息",
    "timeline.previewFallback": "用户消息 {index}",

    "prompt.untitled": "未命名指令",
    "prompt.uncategorized": "未分类",
    "prompt.toastCopyDone": "复制成功",
    "prompt.toastCopyFailed": "复制失败",
    "prompt.title": "Prompt 指令列表",
    "prompt.modalAria": "Prompt 指令列表",
    "prompt.close": "关闭",
    "prompt.searchPlaceholder": "搜索标题/内容/分类",
    "prompt.allCategories": "全部分类",
    "prompt.sortUpdatedDesc": "最近更新",
    "prompt.sortUpdatedAsc": "最早更新",
    "prompt.sortTitleAsc": "标题 A-Z",
    "prompt.sortTitleDesc": "标题 Z-A",
    "prompt.sortCategoryAsc": "分类排序",
    "prompt.empty": "暂无可用 Prompt。",
    "prompt.titlePlaceholder": "标题（可选）",
    "prompt.categoryPlaceholder": "分类（可选）",
    "prompt.contentPlaceholder": "输入 Prompt 内容",
    "prompt.add": "添加 Prompt",
    "prompt.count": "{visible} / {total} 条",
    "prompt.importJson": "导入 JSON",
    "prompt.exportJson": "导出 JSON",
    "prompt.delete": "删除",
    "prompt.itemMetaWithTime": "{category} · {time} · 单击复制",
    "prompt.itemMetaNoTime": "{category} · 单击复制",
    "prompt.deleteConfirm": "确认删除 Prompt「{title}」吗？",

    "folder.defaultName": "新文件夹 {index}",
    "folder.managerLabel": "文件夹",
    "folder.ungrouped": "未分组",
    "folder.create": "新建",
    "folder.menuRename": "重命名",
    "folder.menuDelete": "删除",
    "folder.menuOpenAria": "打开文件夹菜单",
    "folder.emptyHint": "拖动聊天到这里",
    "folder.createPrompt": "输入文件夹名称",
    "folder.renamePrompt": "重命名文件夹",
    "folder.deleteConfirm": "删除文件夹“{name}”？其中会话会回到未分组。",

    "settings.title": "常用配置",
    "settings.close": "关闭",
    "settings.save": "保存",
    "settings.saved": "设置已保存。",
    "settings.keepLatest.label": "保留最新消息数",
    "settings.keepLatest.desc": "长会话优化时，保留在画布中的最新消息数量。",
    "settings.autoReoptimizeBuffer.label": "自动优化缓冲池",
    "settings.autoReoptimizeBuffer.desc": "超出保留最新消息数此数量后，触发自动折叠。",
    "settings.timelineVisibleNodeCapacity.label": "时间线可见节点数",
    "settings.timelineVisibleNodeCapacity.desc": "时间线轨道中同屏显示的最多节点数。",
    "settings.timelineMaxNodes.label": "时间线最大节点数",
    "settings.timelineMaxNodes.desc": "时间线中采样的历史消息最大节点数。",
    "settings.collapseMemoryRetentionDays.label": "记忆保留天数",
    "settings.collapseMemoryRetentionDays.desc": "单个会话开启自动优化的记忆保留天数。",
    "settings.exportFormat.label": "聊天记录导出格式",
    "settings.exportFormat.desc": "选择导出按钮生成的文件格式。",
    "settings.exportFormat.json": ".json",
    "settings.exportFormat.txt": ".txt",
    "settings.exportFormat.md": ".md",
    "settings.messageMode.label": "消息数据模式",
    "settings.messageMode.desc": "仅已加载模式性能更高；扩展缓存模式会额外使用离屏缓存消息用于搜索与导出。",
    "settings.messageMode.loaded": "仅已加载（推荐）",
    "settings.messageMode.extended": "扩展缓存",
  },
};

const normalizeToolkitLanguage = (value) => {
  const nextValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!nextValue) {
    return null;
  }
  if (nextValue.startsWith("zh")) {
    return "zh-CN";
  }
  if (nextValue.startsWith("en")) {
    return "en";
  }
  return null;
};

const getLanguageDisplayName = (language) => {
  if (language === "zh-CN") {
    return t("language.chinese");
  }
  return t("language.english");
};

const detectToolkitLanguageFromBrowser = () => {
  const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];

  for (const candidate of candidates) {
    const normalized = normalizeToolkitLanguage(candidate);
    if (normalized && TOOLKIT_SUPPORTED_LANGUAGES.includes(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_TOOLKIT_LANGUAGE;
};

const loadLanguagePreference = () => {
  try {
    const stored = localStorage.getItem(LANGUAGE_PREFERENCE_KEY);
    if (!stored) {
      return TOOLKIT_LANGUAGE_AUTO;
    }
    if (stored === TOOLKIT_LANGUAGE_AUTO) {
      return TOOLKIT_LANGUAGE_AUTO;
    }
    return normalizeToolkitLanguage(stored) || TOOLKIT_LANGUAGE_AUTO;
  } catch (error) {
    return TOOLKIT_LANGUAGE_AUTO;
  }
};

const saveLanguagePreference = (preference) => {
  try {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, preference);
  } catch (error) {
    // Ignore storage write failures.
  }
};

const getCurrentLanguage = () => i18nState.locale;
const getLanguagePreference = () => i18nState.preference;

const formatMessageTemplate = (template, params = {}) =>
  template.replace(/\{(\w+)\}/g, (matched, key) => {
    const value = params[key];
    return value === null || value === undefined ? matched : String(value);
  });

const t = (key, params = {}) => {
  const locale = getCurrentLanguage();
  const localized =
    I18N_MESSAGES[locale]?.[key] ||
    I18N_MESSAGES[DEFAULT_TOOLKIT_LANGUAGE]?.[key] ||
    key;
  return formatMessageTemplate(localized, params);
};

const getLanguageMenuLabel = (preference) => {
  if (preference === TOOLKIT_LANGUAGE_AUTO) {
    return t("language.autoWithLocale", {
      language: getLanguageDisplayName(i18nState.detected),
    });
  }

  return getLanguageDisplayName(preference);
};

const refreshLocalizedUi = () => {
  if (typeof refreshToolbarLocalization === "function") {
    refreshToolbarLocalization();
  }
  if (typeof refreshTimelineLocalization === "function") {
    refreshTimelineLocalization();
  }
  if (typeof refreshPromptLocalization === "function") {
    refreshPromptLocalization();
  }
  if (typeof refreshFolderLocalization === "function") {
    refreshFolderLocalization();
  }
  if (typeof refreshLatexCopyLocalization === "function") {
    refreshLatexCopyLocalization();
  }
  if (typeof refreshSettingsLocalization === "function") {
    refreshSettingsLocalization();
  }
};

const setLanguagePreference = (preference, options = {}) => {
  const { persist = true, refresh = true } = options;
  const normalizedPreference =
    preference === TOOLKIT_LANGUAGE_AUTO
      ? TOOLKIT_LANGUAGE_AUTO
      : normalizeToolkitLanguage(preference) || DEFAULT_TOOLKIT_LANGUAGE;

  i18nState.preference = normalizedPreference;
  i18nState.detected = detectToolkitLanguageFromBrowser();
  i18nState.locale =
    normalizedPreference === TOOLKIT_LANGUAGE_AUTO ? i18nState.detected : normalizedPreference;

  if (persist) {
    saveLanguagePreference(normalizedPreference);
  }

  if (refresh) {
    refreshLocalizedUi();
  }
};

const initI18n = () => {
  setLanguagePreference(loadLanguagePreference(), {
    persist: false,
    refresh: false,
  });
};
