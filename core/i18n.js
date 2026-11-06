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
    "exportImages.estimate": "Image stage: roughly {seconds}s remaining, estimated from completed downloads; may change with network speed. PNG rendering and packaging follow.",
    "exportImages.estimating": "Estimating remaining image-download time…",
    "exportImages.blocked": "Image requests stopped (HTTP {status} / verification or rate limit). Retry later after checking ChatGPT access.",
    "exportImages.running": "Exporting…",
    "exportImages.elapsed": "Elapsed: {seconds}s. Images download sequentially (up to 30s each); cancel to stop.",
    "exportImages.label": "Images in selected messages",
    "exportImages.textOnly": "Don't package these images (keep selected format)",
    "exportImages.include": "Package these images (ZIP with chat export, images and manifest)",
    "exportImages.progress": "Saving image {current} / {total}…",
    "exportImages.done": "Archive saved with {count} images.",
    "exportImages.partial": "Archive saved: {count} images, {failed} unavailable, {previews} PNG previews unavailable. See manifest.json.",
    "exportImages.cancelled": "Export cancelled.",
    "exportImages.memoryLimit": "This browser's download buffer is limited to 64 MiB. Export fewer turns and download in smaller batches.",
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
    "toolbar.export": "Export",
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
    "status.exportEmptySelection": "Select at least one exportable message.",
    "status.exportSelectionReady": "Loaded {count} conversation turns for export.",
    "status.exportNeedsConsent": "Full conversation data is unavailable. Choose whether to export only the loaded part.",
    "status.exportCacheUsed": "Conversation data unavailable; using the previously loaded full history.",
    "status.exportCacheDone": "Exported {count} messages from the cached full history.",
    "export.partialNotice": "Note: this export may not contain the complete conversation history. Some messages or images are missing.",
    "status.pngGenerating": "Generating long image…",
    "status.pngGeneratingPage": "Generating image {current}/{total}…",
    "status.pngDone": "Long image export complete.",
    "status.pngDoneMultiple": "Long image export complete. The content was automatically split into {count} images.",
    "status.pngFallbackDone": "Long image export complete using the currently available loaded/cached messages.",
    "status.pngFallbackDoneMultiple": "Long image export complete using the currently available loaded/cached messages. The content was automatically split into {count} images.",
    "status.pngDataFailed": "Long image export failed (data retrieval): {reason}",
    "status.pngRenderFailed": "Long image export failed (image rendering): {reason}",
    "status.pngContentTooLarge": "Long image export failed (content too large): {reason}",
    "status.pngUnknownFailed": "Long image export failed (unknown error): {reason}",
    "status.searchRestoreFirst": "Restore hidden messages before using search.",
    "status.searchNoMatch": "No matches found.",
    "status.searchNeedLoadMore": "No matches in loaded messages. Scroll up to load more history, then search again.",
    "status.searchScanning": "Scanning loaded messages... {done}/{total}",
    "status.searchApiLoading": "Loading full conversation search index...",
    "status.searchApiScanning": "Scanning full conversation... {done}/{total}",
    "status.searchApiDone": "Full conversation search found {count} matches.",
    "status.searchApiFallback": "Full conversation search is unavailable. Searching loaded messages only.",
    "status.searchApiStale": "Searching the cached full history captured at {time}.",
    "status.searchJumping": "Locating message...",
    "status.searchJumpDone": "Message located.",
    "status.searchJumpFailed": "Could not locate the message: {reason}",
    "status.searchMatchNotLoaded": "This match is cached but not currently rendered. Scroll nearby to load it, then search again.",
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
    "timeline.hintJumping": "Locating message...",
    "timeline.hintMessageNotLoaded": "Message is not currently rendered. Scroll nearby to load it.",
    "timeline.partialCount": "Full history could not be loaded. This is the number of loaded questions; retry to complete the timeline.",
    "timeline.countLoaded": "{count} loaded",
    "timeline.countLoading": "loading…",
    "timeline.countLoadingTitle": "Reading the full conversation history; the count appears once it is available.",
    "timeline.fullCount": "User turns in the current conversation branch (assistant replies are not counted).",
    "timeline.indexStale": "Showing the last complete history; refreshing it failed.",
    "timeline.indexUnavailable": "Full conversation history is unavailable right now.",
    "timeline.indexUpdatedAt": "Last updated: {time}",
    "timeline.retryIndex": "Retry loading full history",
    "timeline.hintLoadingTarget": "Loading target message… ({index}/{total})",
    "timeline.hintAttempt": "attempt {attempt}",
    "timeline.hintCancel": "Cancel",
    "timeline.hintTargetFailed": "Could not locate the message. The full timeline is kept.",
    "timeline.retryJump": "Try again",
    "timeline.countAria": "Current node {current}, total user messages {total}",
    "timeline.jumpAria": "Jump to user message {index}",
    "timeline.previewFallback": "User message {index}",

    "exportSelection.title": "Export Conversation",
    "exportSelection.ariaLabel": "Select conversation content to export",
    "exportSelection.close": "Close",
    "exportSelection.cancel": "Cancel",
    "exportSelection.export": "Export",
    "exportSelection.retry": "Retry",
    "exportSelection.loading": "Loading the full conversation…",
    "exportSelection.partialWarning": "Full conversation data is unavailable. Only loaded or cached messages can be selected.",
    "exportSelection.scopeLabel": "Export scope",
    "exportSelection.scopeAll": "All conversation turns",
    "exportSelection.scopeSelected": "Selected turns",
    "exportSelection.roleLabel": "Content",
    "exportSelection.roleAll": "User questions + GPT answers",
    "exportSelection.roleAssistant": "GPT answers only",
    "exportSelection.formatLabel": "File format",
    "exportSelection.selectAll": "Select all",
    "exportSelection.invert": "Invert",
    "exportSelection.clear": "Clear",
    "exportSelection.selectedCount": "Selected {selected} of {total} turns",
    "exportSelection.resultCount": "{turns} turns · {messages} messages",
    "exportSelection.turn": "Turn {index}",
    "exportSelection.userLabel": "User: ",
    "exportSelection.assistantLabel": "GPT: ",
    "exportSelection.emptyPreview": "No text content",
    "exportSelection.turnListAria": "Conversation turns",
    "exportSelection.prevPage": "Previous",
    "exportSelection.nextPage": "Next",
    "exportSelection.page": "Page {current} / {total}",
    "exportSelection.cacheNotice": "Using cached full history, last updated {time} ({completeness}).",
    "exportSelection.completeLabel": "complete",
    "exportSelection.partialLabel": "partial",
    "exportSelection.unknownTime": "unknown time",
    "exportSelection.partialChoice": "You can export only the currently loaded page, or retry reading the conversation.",
    "exportSelection.exportLoadedHint": "Only messages currently loaded on the page are included; unmounted history and its images are omitted.",
    "exportSelection.exportLoaded": "Export loaded part",
    "exportSelection.retryLoad": "Retry loading",
    "exportSelection.accessDetail": "Request: {category} · {path} · HTTP {status} · {duration} ms",
    "exportAccess.categorySession": "session endpoint",
    "exportAccess.categoryConversation": "conversation endpoint",
    "exportAccess.blocked": "Access to conversation data was blocked (HTTP {status}). Automatic retries have stopped.",
    "exportAccess.challenge": "The service returned a verification challenge (HTTP {status}). Automatic retries have stopped.",
    "exportAccess.unauthorized": "The session is not authorized (HTTP {status}). Sign in again, then retry.",
    "exportAccess.rateLimited": "Rate limited. Please wait {seconds}s before retrying.",
    "exportAccess.session": "Could not read the login session.",
    "exportAccess.sessionTimeout": "Reading the login session timed out.",
    "exportAccess.timeout": "The conversation request timed out.",
    "exportAccess.network": "Network error while reading conversation data.",
    "exportAccess.incomplete": "The returned conversation is incomplete.",
    "exportAccess.invalidResponse": "The conversation response could not be parsed.",
    "exportAccess.paginationStalled": "Pagination stopped making progress.",
    "exportAccess.noConversationId": "No valid conversation id is available.",
    "exportAccess.authRequired": "ChatGPT did not accept this request as signed in. Reload the page or sign in again.",
    "exportAccess.cancelled": "Export cancelled.",
    "png.watermark": "Exported by {project}",

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
    "folder.managerLoading": "Loading {count}",
    "folder.managerLoaded": "Loaded {count}",
    "folder.managerLoadFailed": "Partial {count}",
    "folder.ungrouped": "Ungrouped",
    "folder.create": "New",
    "folder.loadAll": "Load all",
    "folder.cancelLoad": "Cancel",
    "folder.retryLoad": "Retry",
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
    "settings.exportFormat.png": ".png long image",
    "settings.exportRole.label": "Default Export Content",
    "settings.exportRole.desc": "Choose whether exports include both sides or only GPT answers.",
    "settings.exportRole.all": "User questions + GPT answers",
    "settings.exportRole.assistant": "GPT answers only",
    "settings.latexCopyFormat.label": "Formula Copy Format",
    "settings.latexCopyFormat.desc": "Choose the wrapper added when copying a rendered formula. Markdown display is recommended for Obsidian.",
    "settings.latexCopyFormat.raw": "Raw LaTeX source (default)",
    "settings.latexCopyFormat.markdownInline": "Markdown inline ($...$)",
    "settings.latexCopyFormat.markdownBlock": "Markdown display ($$...$$)",
    "settings.latexCopyFormat.latexInline": "LaTeX inline (\\(...\\))",
    "settings.latexCopyFormat.latexDisplay": "LaTeX display (\\[...\\])",
  },
  "zh-CN": {
    "exportImages.estimate": "图片下载阶段预计还需约 {seconds} 秒（按已完成速度估算，随网络变化；之后还需渲染或打包）。",
    "exportImages.estimating": "正在估算图片下载剩余时间…",
    "exportImages.blocked": "图片请求已停止（HTTP {status}／验证或限流），请确认 ChatGPT 可正常访问后稍后重试。",
    "exportImages.running": "正在导出…",
    "exportImages.elapsed": "已用时 {seconds} 秒。图片逐张下载，每张最多等待 30 秒；可点击取消停止。",
    "exportImages.label": "所选消息中的图片",
    "exportImages.textOnly": "不打包这些图片（保留所选导出格式）",
    "exportImages.include": "打包这些图片（ZIP 含聊天文件、图片和清单）",
    "exportImages.progress": "正在保存图片 {current} / {total}…",
    "exportImages.done": "归档已保存，包含 {count} 张图片。",
    "exportImages.partial": "归档已保存：{count} 张图片成功，{failed} 张无法获取，{previews} 张无法在 PNG 中预览。详见 manifest.json。",
    "exportImages.cancelled": "导出已取消。",
    "exportImages.memoryLimit": "当前浏览器的下载缓冲上限为 64 MiB。请减少选中回合，分批下载。",
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
    "toolbar.export": "导出",
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
    "status.exportEmptySelection": "请至少选择一条可导出的消息。",
    "status.exportSelectionReady": "已加载 {count} 个问答回合，可选择导出。",
    "status.exportNeedsConsent": "无法读取完整会话数据，请选择是否只导出已加载部分。",
    "status.exportCacheUsed": "无法读取会话数据，已改用上次取得的完整历史。",
    "status.exportCacheDone": "已从缓存的完整历史导出 {count} 条消息。",
    "export.partialNotice": "注意：该导出可能不包含完整会话历史，部分消息或图片缺失。",
    "status.pngGenerating": "正在生成长图…",
    "status.pngGeneratingPage": "正在生成第 {current}/{total} 张…",
    "status.pngDone": "长图导出完成。",
    "status.pngDoneMultiple": "长图导出完成。内容较长，已自动拆分为 {count} 张图片。",
    "status.pngFallbackDone": "长图导出完成（仅包含当前可获得的已加载/缓存消息）。",
    "status.pngFallbackDoneMultiple": "长图导出完成（仅包含当前可获得的已加载/缓存消息）。内容较长，已自动拆分为 {count} 张图片。",
    "status.pngDataFailed": "长图导出失败（数据获取失败）：{reason}",
    "status.pngRenderFailed": "长图导出失败（图片渲染失败）：{reason}",
    "status.pngContentTooLarge": "长图导出失败（内容过大）：{reason}",
    "status.pngUnknownFailed": "长图导出失败（未知错误）：{reason}",
    "status.searchRestoreFirst": "请先恢复隐藏消息，才能使用搜索功能。",
    "status.searchNoMatch": "未找到匹配。",
    "status.searchNeedLoadMore": "当前已加载消息中未找到匹配。请向上滚动加载更多历史消息后重试。",
    "status.searchScanning": "正在扫描已加载消息... {done}/{total}",
    "status.searchApiLoading": "正在加载全量会话搜索索引...",
    "status.searchApiScanning": "正在扫描全量会话... {done}/{total}",
    "status.searchApiDone": "全量会话搜索找到 {count} 条匹配。",
    "status.searchApiFallback": "无法使用全量会话搜索，已改为仅搜索已加载消息。",
    "status.searchApiStale": "正在搜索 {time} 取得的缓存完整历史。",
    "status.searchJumping": "正在定位消息...",
    "status.searchJumpDone": "已定位消息。",
    "status.searchJumpFailed": "无法定位消息：{reason}",
    "status.searchMatchNotLoaded": "\u8fd9\u6761\u5339\u914d\u6d88\u606f\u5df2\u7f13\u5b58\uff0c\u4f46\u5f53\u524d\u672a\u6e32\u67d3\u3002\u8bf7\u6eda\u52a8\u5230\u9644\u8fd1\u52a0\u8f7d\u540e\u518d\u641c\u7d22\u3002",
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
    "timeline.hintJumping": "正在定位消息...",
    "timeline.hintMessageNotLoaded": "\u8be5\u6d88\u606f\u5f53\u524d\u672a\u6e32\u67d3\uff0c\u8bf7\u6eda\u52a8\u5230\u9644\u8fd1\u52a0\u8f7d\u3002",
    "timeline.partialCount": "完整历史未能载入，当前显示已载入的提问数；可点击重试补齐时间线。",
    "timeline.countLoaded": "已载入 {count} 条",
    "timeline.countLoading": "载入中…",
    "timeline.countLoadingTitle": "正在读取完整会话历史，取得后才会显示条数。",
    "timeline.fullCount": "当前会话分支的提问数，不包含助手回复。",
    "timeline.indexStale": "当前显示最后一次完整历史，后台刷新失败。",
    "timeline.indexUnavailable": "暂时无法读取完整会话历史。",
    "timeline.indexUpdatedAt": "更新时间：{time}",
    "timeline.retryIndex": "重新读取完整历史",
    "timeline.hintLoadingTarget": "正在加载目标消息…（{index}/{total}）",
    "timeline.hintAttempt": "第 {attempt} 次尝试",
    "timeline.hintCancel": "取消",
    "timeline.hintTargetFailed": "未能定位该消息，完整时间线已保留。",
    "timeline.retryJump": "重试定位",
    "timeline.countAria": "当前节点 {current}，总用户节点 {total}",
    "timeline.jumpAria": "跳转到第 {index} 条用户消息",
    "timeline.previewFallback": "用户消息 {index}",

    "exportSelection.title": "导出对话",
    "exportSelection.ariaLabel": "选择要导出的对话内容",
    "exportSelection.close": "关闭",
    "exportSelection.cancel": "取消",
    "exportSelection.export": "导出",
    "exportSelection.retry": "重试",
    "exportSelection.loading": "正在加载完整会话…",
    "exportSelection.partialWarning": "无法读取完整会话数据，只能选择当前已加载或缓存的消息。",
    "exportSelection.scopeLabel": "导出范围",
    "exportSelection.scopeAll": "全部问答回合",
    "exportSelection.scopeSelected": "选择指定回合",
    "exportSelection.roleLabel": "导出内容",
    "exportSelection.roleAll": "用户提问 + GPT 回答",
    "exportSelection.roleAssistant": "仅 GPT 回答",
    "exportSelection.formatLabel": "文件格式",
    "exportSelection.selectAll": "全选",
    "exportSelection.invert": "反选",
    "exportSelection.clear": "清空",
    "exportSelection.selectedCount": "已选择 {selected}/{total} 个回合",
    "exportSelection.resultCount": "{turns} 个回合 · {messages} 条消息",
    "exportSelection.turn": "第 {index} 轮",
    "exportSelection.userLabel": "用户：",
    "exportSelection.assistantLabel": "GPT：",
    "exportSelection.emptyPreview": "无文本内容",
    "exportSelection.turnListAria": "问答回合列表",
    "exportSelection.prevPage": "上一页",
    "exportSelection.nextPage": "下一页",
    "exportSelection.page": "第 {current}/{total} 页",
    "exportSelection.cacheNotice": "正在使用缓存的完整历史，更新于 {time}（{completeness}）。",
    "exportSelection.completeLabel": "完整",
    "exportSelection.partialLabel": "可能不完整",
    "exportSelection.unknownTime": "未知时间",
    "exportSelection.partialChoice": "可以只导出当前已加载的部分，或重试读取会话。",
    "exportSelection.exportLoadedHint": "仅包含当前页面已加载的消息，未挂载的历史及其图片会被省略。",
    "exportSelection.exportLoaded": "导出已加载部分",
    "exportSelection.retryLoad": "重试读取",
    "exportSelection.accessDetail": "请求：{category} · {path} · HTTP {status} · {duration} 毫秒",
    "exportAccess.categorySession": "会话登录接口",
    "exportAccess.categoryConversation": "会话数据接口",
    "exportAccess.blocked": "会话数据访问被拦截（HTTP {status}），已停止自动重试。",
    "exportAccess.challenge": "服务端返回了验证挑战（HTTP {status}），已停止自动重试。",
    "exportAccess.unauthorized": "当前登录会话未获授权（HTTP {status}），请重新登录后再试。",
    "exportAccess.rateLimited": "请求过于频繁，请等待 {seconds} 秒后重试。",
    "exportAccess.session": "无法读取登录会话。",
    "exportAccess.sessionTimeout": "读取登录会话超时。",
    "exportAccess.timeout": "读取会话数据超时。",
    "exportAccess.network": "读取会话数据时发生网络错误。",
    "exportAccess.incomplete": "返回的会话数据不完整。",
    "exportAccess.invalidResponse": "会话数据无法解析。",
    "exportAccess.paginationStalled": "分页读取没有进展，已停止。",
    "exportAccess.noConversationId": "无法确定当前会话 ID。",
    "exportAccess.authRequired": "ChatGPT 没有把这次请求认作已登录，请刷新页面或重新登录后再试。",
    "exportAccess.cancelled": "导出已取消。",
    "png.watermark": "由 {project} 导出",

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
    "folder.managerLoading": "加载中 {count}",
    "folder.managerLoaded": "已加载 {count}",
    "folder.managerLoadFailed": "未完成 {count}",
    "folder.ungrouped": "未分组",
    "folder.create": "新建",
    "folder.loadAll": "加载全部",
    "folder.cancelLoad": "取消加载",
    "folder.retryLoad": "重试加载",
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
    "settings.exportFormat.png": ".png 长图",
    "settings.exportRole.label": "默认导出内容",
    "settings.exportRole.desc": "设置导出时包含完整问答，或只包含 GPT 回答。",
    "settings.exportRole.all": "用户提问 + GPT 回答",
    "settings.exportRole.assistant": "仅 GPT 回答",
    "settings.latexCopyFormat.label": "公式复制格式",
    "settings.latexCopyFormat.desc": "选择复制渲染公式时自动添加的定界符；粘贴到 Obsidian 推荐使用 Markdown 块级格式。",
    "settings.latexCopyFormat.raw": "纯 LaTeX 源码（默认）",
    "settings.latexCopyFormat.markdownInline": "Markdown 行内（$...$）",
    "settings.latexCopyFormat.markdownBlock": "Markdown 块级（$$...$$）",
    "settings.latexCopyFormat.latexInline": "LaTeX 行内（\\(...\\)）",
    "settings.latexCopyFormat.latexDisplay": "LaTeX 展示（\\[...\\]）",
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
  if (typeof refreshExportSelectionLocalization === "function") {
    refreshExportSelectionLocalization();
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

// Use this only in HTML templates. Text nodes and attributes set through DOM
// properties should keep using t() so users see the original characters.
const tHtml = (key, params) => String(t(key, params)).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
