/*
 * ChatGPT Conversation Toolkit - Toolbar and drag behavior
 */
const TOOLKIT_REPO_URL = "https://github.com/bujue3709/chatgpt-Long-conversation-optimization";
const TOOLKIT_FEEDBACK_URL = `${TOOLKIT_REPO_URL}/issues/new`;

const getSnappedFloatingButtonPlacement = (left, top, width, height) => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 16;
  const centerX = left + width / 2;
  const edge = centerX <= viewportWidth / 2 ? "left" : "right";
  const nextTop = clampFloatingButtonPosition(left, top, width, height).top;

  return {
    edge,
    top: Math.min(nextTop, Math.max(margin, viewportHeight - height - margin)),
  };
};

const applySnappedFloatingButtonPlacement = (button, placement, savePosition = true) => {
  if (!(button instanceof HTMLElement) || !placement) {
    return;
  }

  button.style.transform = "";
  if (placement.edge === "left") {
    button.style.left = "16px";
    button.style.right = "auto";
  } else {
    button.style.left = "auto";
    button.style.right = "16px";
  }
  button.style.top = `${Math.round(placement.top)}px`;
  button.style.bottom = "auto";

  if (savePosition) {
    saveMinimizedPosition({
      edge: placement.edge,
      top: Math.round(placement.top),
    });
  }
};

const snapToEdge = (button, savePosition = true) => {
  const rect = button.getBoundingClientRect();
  const placement = getSnappedFloatingButtonPlacement(rect.left, rect.top, rect.width, rect.height);
  applySnappedFloatingButtonPlacement(button, placement, savePosition);
};

const ensureButtonVisible = (button) => {
  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 16;

  let needsAdjustment = false;

  // 检查是否超出可视区域
  if (rect.left < 0 || rect.right > viewportWidth ||
    rect.top < 0 || rect.bottom > viewportHeight) {
    needsAdjustment = true;
  }

  if (needsAdjustment) {
    snapToEdge(button, true);
  }
};

const getToolbarLanguageOptionsMarkup = () => {
  const selectedPreference = getLanguagePreference();
  const options = [
    {
      value: TOOLKIT_LANGUAGE_AUTO,
      label: getLanguageMenuLabel(TOOLKIT_LANGUAGE_AUTO),
    },
    {
      value: "en",
      label: t("language.english"),
    },
    {
      value: "zh-CN",
      label: t("language.chinese"),
    },
  ];

  return options
    .map(
      (option) =>
        `<option value="${option.value}"${option.value === selectedPreference ? " selected" : ""}>${option.label}</option>`,
    )
    .join("");
};

const refreshMinimizedButtonLocalization = () => {
  const button = document.getElementById(MINIMIZED_ID);
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  button.setAttribute("aria-label", t("toolbar.expandAria"));
};

const buildToolbarTickerMarkup = (text) =>
  `<span class="chatgpt-toolkit-cta-track" aria-hidden="true">
    <span class="chatgpt-toolkit-cta-line">${text}</span>
    <span class="chatgpt-toolkit-cta-line">${text}</span>
  </span>`;

const refreshToolbarLocalization = () => {
  const toolbar = document.getElementById(TOOLKIT_ID);
  if (!(toolbar instanceof HTMLElement)) {
    refreshMinimizedButtonLocalization();
    return;
  }

  const title = toolbar.querySelector(".chatgpt-toolkit-title");
  if (title instanceof HTMLElement) {
    title.textContent = t("toolbar.title");
  }

  const subtitle = toolbar.querySelector(".chatgpt-toolkit-subtitle");
  if (subtitle instanceof HTMLElement) {
    subtitle.textContent = t("toolbar.subtitle");
  }

  const minimizeButton = toolbar.querySelector('[data-action="minimize"]');
  if (minimizeButton instanceof HTMLButtonElement) {
    minimizeButton.textContent = t("toolbar.minimize");
    minimizeButton.setAttribute("aria-label", t("toolbar.minimizeAria"));
  }

  const languageLabel = toolbar.querySelector(".chatgpt-toolkit-language-label");
  if (languageLabel instanceof HTMLElement) {
    languageLabel.textContent = t("language.label");
  }

  const languageSelect = toolbar.querySelector("#chatgpt-toolkit-language-select");
  if (languageSelect instanceof HTMLSelectElement) {
    languageSelect.innerHTML = getToolbarLanguageOptionsMarkup();
    languageSelect.value = getLanguagePreference();
    languageSelect.setAttribute("aria-label", t("language.label"));
  }

  const exportButton = toolbar.querySelector('[data-action="export"]');
  if (exportButton instanceof HTMLButtonElement) {
    exportButton.textContent = t("toolbar.export");
  }

  const promptButton = toolbar.querySelector('[data-action="prompt-library"]');
  if (promptButton instanceof HTMLButtonElement) {
    promptButton.textContent = t("toolbar.promptLibrary");
  }

  const settingsButton = toolbar.querySelector('[data-action="settings"]');
  if (settingsButton instanceof HTMLButtonElement) {
    settingsButton.textContent = t("toolbar.settings");
  }

  const searchInput = toolbar.querySelector("#chatgpt-toolkit-search-input");
  if (searchInput instanceof HTMLInputElement) {
    searchInput.placeholder = t("toolbar.searchPlaceholder");
  }

  const searchButton = toolbar.querySelector('[data-action="search"]');
  if (searchButton instanceof HTMLButtonElement) {
    searchButton.textContent = t("toolbar.search");
    searchButton.title = t("toolbar.searchTitle");
  }

  const prevButton = toolbar.querySelector('[data-action="search-prev"]');
  if (prevButton instanceof HTMLButtonElement) {
    prevButton.textContent = t("toolbar.searchPrev");
    prevButton.title = t("toolbar.searchPrevTitle");
  }

  const nextButton = toolbar.querySelector('[data-action="search-next"]');
  if (nextButton instanceof HTMLButtonElement) {
    nextButton.textContent = t("toolbar.searchNext");
    nextButton.title = t("toolbar.searchNextTitle");
  }

  const starButton = toolbar.querySelector('[data-action="open-star-project"]');
  if (starButton instanceof HTMLButtonElement) {
    starButton.title = t("toolbar.starProjectAria");
    starButton.setAttribute("aria-label", t("toolbar.starProjectAria"));
    const viewport = starButton.querySelector(".chatgpt-toolkit-cta-viewport");
    if (viewport instanceof HTMLElement) {
      viewport.innerHTML = buildToolbarTickerMarkup(t("toolbar.starProject"));
    }
  }

  const feedbackButton = toolbar.querySelector('[data-action="open-feedback"]');
  if (feedbackButton instanceof HTMLButtonElement) {
    feedbackButton.title = t("toolbar.feedbackAria");
    feedbackButton.setAttribute("aria-label", t("toolbar.feedbackAria"));
    const viewport = feedbackButton.querySelector(".chatgpt-toolkit-cta-viewport");
    if (viewport instanceof HTMLElement) {
      viewport.innerHTML = buildToolbarTickerMarkup(t("toolbar.feedback"));
    }
  }

  refreshStatusLocalization();
  refreshMinimizedButtonLocalization();
  updateSearchUI();
  updateTimelineToggleButton();
};

const buildToolbar = () => {
  const container = document.createElement("section");
  container.id = TOOLKIT_ID;
  container.innerHTML = `
    <div class="chatgpt-toolkit-header">
      <strong class="chatgpt-toolkit-title">${t("toolbar.title")}</strong>
      <button type="button" class="chatgpt-toolkit-minimize" data-action="minimize" aria-label="${t("toolbar.minimizeAria")}">
        ${t("toolbar.minimize")}
      </button>
      <div class="chatgpt-toolkit-header-meta">
        <div class="chatgpt-toolkit-context">
          <span class="chatgpt-toolkit-subtitle">${t("toolbar.subtitle")}</span>
        </div>
        <label class="chatgpt-toolkit-language" for="chatgpt-toolkit-language-select">
          <span class="chatgpt-toolkit-language-label">${t("language.label")}</span>
          <select id="chatgpt-toolkit-language-select" class="chatgpt-toolkit-language-select" aria-label="${t("language.label")}">
            ${getToolbarLanguageOptionsMarkup()}
          </select>
        </label>
      </div>
    </div>
    <div class="chatgpt-toolkit-actions">
      <button type="button" class="chatgpt-toolkit-button primary" data-action="export">
        ${t("toolbar.export")}
      </button>
      <button type="button" class="chatgpt-toolkit-button" data-action="prompt-library">
        ${t("toolbar.promptLibrary")}
      </button>
      <button type="button" class="chatgpt-toolkit-button" data-action="timeline-toggle">
        ${timelineState.visible ? t("toolbar.timelineHide") : t("toolbar.timelineShow")}
      </button>
      <button type="button" class="chatgpt-toolkit-button" data-action="settings">
        ${t("toolbar.settings")}
      </button>
    </div>
    <div class="chatgpt-toolkit-search">
      <div class="chatgpt-toolkit-search-row">
        <input type="text" id="chatgpt-toolkit-search-input" class="chatgpt-toolkit-search-input" placeholder="${t("toolbar.searchPlaceholder")}" />
        <button type="button" class="chatgpt-toolkit-search-btn" data-action="search" title="${t("toolbar.searchTitle")}">${t("toolbar.search")}</button>
      </div>
      <div class="chatgpt-toolkit-search-nav">
        <button type="button" id="chatgpt-toolkit-search-prev" class="chatgpt-toolkit-nav-btn" data-action="search-prev" disabled title="${t("toolbar.searchPrevTitle")}">${t("toolbar.searchPrev")}</button>
        <span id="chatgpt-toolkit-search-result" class="chatgpt-toolkit-search-result"></span>
        <button type="button" id="chatgpt-toolkit-search-next" class="chatgpt-toolkit-nav-btn" data-action="search-next" disabled title="${t("toolbar.searchNextTitle")}">${t("toolbar.searchNext")}</button>
      </div>
    </div>
    <p id="${STATUS_ID}" class="chatgpt-toolkit-status" data-tone="info">${t("toolbar.ready")}</p>
    <div class="chatgpt-toolkit-cta-row" aria-label="Project actions">
      <button type="button" class="chatgpt-toolkit-cta-btn is-accent" data-action="open-star-project" title="${t("toolbar.starProjectAria")}" aria-label="${t("toolbar.starProjectAria")}">
        <span class="chatgpt-toolkit-cta-viewport">
          ${buildToolbarTickerMarkup(t("toolbar.starProject"))}
        </span>
      </button>
      <button type="button" class="chatgpt-toolkit-cta-btn" data-action="open-feedback" title="${t("toolbar.feedbackAria")}" aria-label="${t("toolbar.feedbackAria")}">
        <span class="chatgpt-toolkit-cta-viewport">
          ${buildToolbarTickerMarkup(t("toolbar.feedback"))}
        </span>
      </button>
    </div>
  `;

  container.addEventListener("click", (event) => {
    const target = event.target;
    const actionTarget =
      target instanceof Element
        ? target.closest("[data-action]")
        : target instanceof Node && target.parentElement
          ? target.parentElement.closest("[data-action]")
          : null;

    if (!(actionTarget instanceof HTMLElement)) {
      return;
    }
    const action = actionTarget.dataset.action;
    if (!action) {
      return;
    }

    const actionHandlers = {
      minimize: () => minimizeToolbar(),
      export: () => void openExportSelectionModal(),
      "prompt-library": () => void openPromptModal(),
      "timeline-toggle": () => toggleTimelineVisibility(),
      settings: () => openSettingsModal(),
      "open-star-project": () => openToolkitLink(TOOLKIT_REPO_URL),
      "open-feedback": () => openToolkitLink(TOOLKIT_FEEDBACK_URL),
      search: () => {
        const input = document.getElementById('chatgpt-toolkit-search-input');
        if (input) performSearch(input.value);
      },
      "search-prev": () => navigateToPrevMatch(),
      "search-next": () => navigateToNextMatch(),
    };

    const handler = actionHandlers[action];
    if (handler) handler();
  });

  // 监听搜索输入框的回车事件
  container.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target.id === 'chatgpt-toolkit-search-input' && event.key === 'Enter') {
      performSearch(target.value);
    }
  });

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.id !== "chatgpt-toolkit-language-select") {
      return;
    }
    setLanguagePreference(target.value, { persist: true, refresh: true });
  });

  return container;
};

const buildMinimizedButton = () => {
  const button = document.createElement("button");
  button.id = MINIMIZED_ID;
  button.type = "button";
  button.className = "chatgpt-toolkit-minimized";
  button.setAttribute("aria-label", t("toolbar.expandAria"));
  button.innerHTML = `<span class="chatgpt-toolkit-minimized-mark" aria-hidden="true">GPT</span>`;
  return button;
};

const applyMinimizedPosition = (button) => {
  const position = loadMinimizedPosition();
  if (!position) {
    // 默认位置：右边缘
    snapToEdge(button, false);
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const buttonHeight = button.offsetHeight || 48;
  const margin = 16;

  // 新格式：edge + top
  if (position.edge && typeof position.top === "number") {
    let top = position.top;

    // 确保 top 在可视区域内
    if (top < margin) {
      top = margin;
    } else if (top + buttonHeight > viewportHeight - margin) {
      top = viewportHeight - buttonHeight - margin;
    }

    if (position.edge === 'left') {
      button.style.left = `${margin}px`;
      button.style.right = 'auto';
    } else {
      button.style.left = 'auto';
      button.style.right = `${margin}px`;
    }
    button.style.top = `${top}px`;
    button.style.bottom = 'auto';
    return;
  }

  // 兼容旧格式：left + top（迁移到新格式）
  if (typeof position.left === "number" && typeof position.top === "number") {
    let top = position.top;

    // 确保 top 在可视区域内
    if (top < margin) {
      top = margin;
    } else if (top + buttonHeight > viewportHeight - margin) {
      top = viewportHeight - buttonHeight - margin;
    }

    // 判断应该贴哪个边
    const centerX = position.left + 24; // 按钮宽度的一半
    const edge = centerX <= viewportWidth / 2 ? 'left' : 'right';

    if (edge === 'left') {
      button.style.left = `${margin}px`;
      button.style.right = 'auto';
    } else {
      button.style.left = 'auto';
      button.style.right = `${margin}px`;
    }
    button.style.top = `${top}px`;
    button.style.bottom = 'auto';

    // 保存为新格式
    saveMinimizedPosition({ edge, top });
  }
};

const ensureMinimizedButton = () => {
  const existingButton = document.getElementById(MINIMIZED_ID);
  if (existingButton) {
    return existingButton;
  }

  if (!document.body) {
    return null;
  }

  const button = buildMinimizedButton();
  document.body.appendChild(button);
  applyMinimizedPosition(button);
  enableDrag(button);
  syncToolkitTheme();
  return button;
};

const applyToolbarVisibility = () => {
  const toolbar = document.getElementById(TOOLKIT_ID);
  const minimized = ensureMinimizedButton();
  if (!(toolbar instanceof HTMLElement) || !(minimized instanceof HTMLElement)) {
    return;
  }

  toolbar.classList.toggle("is-hidden", Boolean(state.isMinimized));
  minimized.classList.toggle("is-visible", Boolean(state.isMinimized));
};

const minimizeToolbar = () => {
  state.isMinimized = true;
  saveToolbarMinimizedState(true);
  applyToolbarVisibility();
};

const expandToolbar = () => {
  state.isMinimized = false;
  saveToolbarMinimizedState(false);
  applyToolbarVisibility();
};

const applyFloatingButtonPosition = (button, left, top) => {
  button.style.left = `${Math.round(left)}px`;
  button.style.top = `${Math.round(top)}px`;
  button.style.right = "auto";
  button.style.bottom = "auto";
};

const clampFloatingButtonPosition = (left, top, width, height) => {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(top, margin), maxTop),
  };
};

const enableDrag = (button) => {
  const DRAG_THRESHOLD = 5; // 拖拽阈值：超过5px才判定为拖拽
  let isDragging = false;
  let moved = false;
  let suppressClick = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let pendingLeft = 0;
  let pendingTop = 0;
  let buttonWidth = 48;
  let buttonHeight = 48;
  const baseTransform = "";

  const dragController = createRafDragController(({ translateX, translateY }) => {
    applyDragTransform(button, translateX, translateY, baseTransform);
  });

  const onPointerMove = (event) => {
    if (!isDragging) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    // 只有超过阈值才判定为拖拽
    if (!moved) {
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared < DRAG_THRESHOLD * DRAG_THRESHOLD) {
        return; // 未超过阈值，不算拖拽
      }
      moved = true; // 超过阈值，标记为拖拽
      suppressClick = true;
      minimizedButtonState.dragging = true;
      button.classList.add("is-dragging");
      button.style.willChange = "transform";
      button.style.pointerEvents = "none";
      document.documentElement.style.userSelect = "none";
    }

    const nextPosition = clampFloatingButtonPosition(
      startLeft + deltaX,
      startTop + deltaY,
      buttonWidth,
      buttonHeight
    );
    pendingLeft = nextPosition.left;
    pendingTop = nextPosition.top;
    dragController.schedule({
      translateX: nextPosition.left - startLeft,
      translateY: nextPosition.top - startTop,
    });
  };

  const onPointerUp = () => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    minimizedButtonState.pointerDown = false;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    dragController.cancel();
    minimizedButtonState.dragging = false;
    button.classList.remove("is-pointer-down");
    button.classList.remove("is-dragging");
    button.style.willChange = "";
    button.style.pointerEvents = "";
    document.documentElement.style.userSelect = "";

    // 只有实际拖动了才贴合边缘
    if (moved) {
      applySnappedFloatingButtonPlacement(
        button,
        getSnappedFloatingButtonPlacement(pendingLeft, pendingTop, buttonWidth, buttonHeight),
        true
      );
    } else {
      resetDragTransform(button, baseTransform);
    }

    setTimeout(() => {
      moved = false;
      suppressClick = false;
    }, 0);
  };

  button.style.touchAction = "none";
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    isDragging = true;
    minimizedButtonState.pointerDown = true;
    moved = false;
    button.classList.add("is-pointer-down");
    const rect = button.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    pendingLeft = rect.left;
    pendingTop = rect.top;
    buttonWidth = rect.width || button.offsetWidth || 48;
    buttonHeight = rect.height || button.offsetHeight || 48;
    startX = event.clientX;
    startY = event.clientY;
    resetDragTransform(button, baseTransform);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  });

  button.addEventListener("click", () => {
    if (moved || suppressClick) {
      suppressClick = false;
      return;
    }
    expandToolbar();
  });
};
const attachToolbar = () => {
  if (document.getElementById(TOOLKIT_ID)) {
    return;
  }
  if (!document.body) {
    return;
  }
  observeThemeOnBodyIfNeeded();
  const toolbar = buildToolbar();
  document.body.appendChild(toolbar);
  updateStatusByKey("toolbar.ready", "info");
  updateTimelineToggleButton();
  ensureMinimizedButton();
  applyToolbarVisibility();
  refreshToolbarLocalization();
  syncToolkitTheme();
};

const openToolkitLink = (url) => {
  if (!url) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const SETTINGS_MODAL_ID = "chatgpt-toolkit-settings-modal";
const SETTINGS_INPUT_IDS = Object.freeze({
  exportFormat: "toolkit-setting-exportFormat",
  exportRole: "toolkit-setting-exportRole",
  latexCopyFormat: "toolkit-setting-latexCopyFormat",
});

const getSettingsModal = () => document.getElementById(SETTINGS_MODAL_ID);

const closeSettingsModal = () => {
  const modal = getSettingsModal();
  if (modal instanceof HTMLElement) {
    modal.classList.remove("is-visible");
  }
};

const getSettingsFallbackConfig = () => ({
  exportFormat: TOOLKIT_EXPORT_FORMAT || TOOLKIT_EXPORT_FORMAT_JSON,
  exportRole: TOOLKIT_EXPORT_ROLE || TOOLKIT_EXPORT_ROLE_ALL,
  latexCopyFormat: TOOLKIT_LATEX_COPY_FORMAT || TOOLKIT_LATEX_COPY_FORMAT_RAW,
});

const getSettingsConfig = (config) => {
  const currentConfig =
    typeof getToolkitConfig === "function" ? getToolkitConfig() : getSettingsFallbackConfig();
  if (config && typeof normalizeToolkitConfig === "function") {
    return normalizeToolkitConfig({ ...currentConfig, ...config });
  }
  return currentConfig;
};

const readSettingsInputValue = (id) => {
  const input = document.getElementById(id);
  if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
    return input.value;
  }
  return undefined;
};

const readSettingsDraft = () => {
  const draft = {
    exportFormat: readSettingsInputValue(SETTINGS_INPUT_IDS.exportFormat),
    exportRole: readSettingsInputValue(SETTINGS_INPUT_IDS.exportRole),
    latexCopyFormat: readSettingsInputValue(SETTINGS_INPUT_IDS.latexCopyFormat),
  };
  return Object.values(draft).some((value) => value !== undefined) ? draft : null;
};

const renderSettingsModal = (modal, draftConfig = null) => {
  if (!(modal instanceof HTMLElement)) {
    return;
  }

  const config = getSettingsConfig(draftConfig);
  modal.innerHTML = `
    <div class="chatgpt-toolkit-prompt-backdrop" data-settings-action="close"></div>
    <div class="chatgpt-toolkit-prompt-panel" role="dialog" aria-modal="true" aria-label="${t("settings.title")}" style="max-width: 480px;">
      <div class="chatgpt-toolkit-prompt-header">
        <strong>${t("settings.title")}</strong>
        <button type="button" class="chatgpt-toolkit-prompt-close" data-settings-action="close">${t("settings.close")}</button>
      </div>
      <div class="chatgpt-toolkit-prompt-list" style="padding: 16px; padding-bottom: 24px; overflow-y: auto;">
        <div class="chatgpt-toolkit-form-group">
          <label class="chatgpt-toolkit-form-label" for="${SETTINGS_INPUT_IDS.exportFormat}">${t("settings.exportFormat.label")}</label>
          <select id="${SETTINGS_INPUT_IDS.exportFormat}" class="chatgpt-toolkit-input">
            <option value="${TOOLKIT_EXPORT_FORMAT_JSON}"${config.exportFormat === TOOLKIT_EXPORT_FORMAT_JSON ? " selected" : ""}>
              ${t("settings.exportFormat.json")}
            </option>
            <option value="${TOOLKIT_EXPORT_FORMAT_TEXT}"${config.exportFormat === TOOLKIT_EXPORT_FORMAT_TEXT ? " selected" : ""}>
              ${t("settings.exportFormat.txt")}
            </option>
            <option value="${TOOLKIT_EXPORT_FORMAT_MARKDOWN}"${config.exportFormat === TOOLKIT_EXPORT_FORMAT_MARKDOWN ? " selected" : ""}>
              ${t("settings.exportFormat.md")}
            </option>
          </select>
          <p class="chatgpt-toolkit-form-desc">${t("settings.exportFormat.desc")}</p>
        </div>
        <div class="chatgpt-toolkit-form-group">
          <label class="chatgpt-toolkit-form-label" for="${SETTINGS_INPUT_IDS.exportRole}">${t("settings.exportRole.label")}</label>
          <select id="${SETTINGS_INPUT_IDS.exportRole}" class="chatgpt-toolkit-input">
            <option value="${TOOLKIT_EXPORT_ROLE_ALL}"${config.exportRole === TOOLKIT_EXPORT_ROLE_ALL ? " selected" : ""}>
              ${t("settings.exportRole.all")}
            </option>
            <option value="${TOOLKIT_EXPORT_ROLE_ASSISTANT}"${config.exportRole === TOOLKIT_EXPORT_ROLE_ASSISTANT ? " selected" : ""}>
              ${t("settings.exportRole.assistant")}
            </option>
          </select>
          <p class="chatgpt-toolkit-form-desc">${t("settings.exportRole.desc")}</p>
        </div>
        <div class="chatgpt-toolkit-form-group">
          <label class="chatgpt-toolkit-form-label" for="${SETTINGS_INPUT_IDS.latexCopyFormat}">${t("settings.latexCopyFormat.label")}</label>
          <select id="${SETTINGS_INPUT_IDS.latexCopyFormat}" class="chatgpt-toolkit-input">
            <option value="${TOOLKIT_LATEX_COPY_FORMAT_RAW}"${config.latexCopyFormat === TOOLKIT_LATEX_COPY_FORMAT_RAW ? " selected" : ""}>
              ${t("settings.latexCopyFormat.raw")}
            </option>
            <option value="${TOOLKIT_LATEX_COPY_FORMAT_MARKDOWN_INLINE}"${config.latexCopyFormat === TOOLKIT_LATEX_COPY_FORMAT_MARKDOWN_INLINE ? " selected" : ""}>
              ${t("settings.latexCopyFormat.markdownInline")}
            </option>
            <option value="${TOOLKIT_LATEX_COPY_FORMAT_MARKDOWN_BLOCK}"${config.latexCopyFormat === TOOLKIT_LATEX_COPY_FORMAT_MARKDOWN_BLOCK ? " selected" : ""}>
              ${t("settings.latexCopyFormat.markdownBlock")}
            </option>
            <option value="${TOOLKIT_LATEX_COPY_FORMAT_LATEX_INLINE}"${config.latexCopyFormat === TOOLKIT_LATEX_COPY_FORMAT_LATEX_INLINE ? " selected" : ""}>
              ${t("settings.latexCopyFormat.latexInline")}
            </option>
            <option value="${TOOLKIT_LATEX_COPY_FORMAT_LATEX_DISPLAY}"${config.latexCopyFormat === TOOLKIT_LATEX_COPY_FORMAT_LATEX_DISPLAY ? " selected" : ""}>
              ${t("settings.latexCopyFormat.latexDisplay")}
            </option>
          </select>
          <p class="chatgpt-toolkit-form-desc">${t("settings.latexCopyFormat.desc")}</p>
        </div>
      </div>
      <div class="chatgpt-toolkit-prompt-footer">
        <span></span>
        <div class="chatgpt-toolkit-prompt-footer-actions">
          <button type="button" class="chatgpt-toolkit-settings-save">${t("settings.save")}</button>
        </div>
      </div>
    </div>
  `;

  const saveBtn = modal.querySelector(".chatgpt-toolkit-settings-save");
  if (saveBtn instanceof HTMLButtonElement) {
    saveBtn.addEventListener("click", () => {
      const draft = readSettingsDraft();
      if (typeof saveToolkitConfig === "function") {
        saveToolkitConfig(draft || {});
      } else {
        getSettingsConfig(draft);
      }

      if (typeof updateStatusByKey === "function") {
        updateStatusByKey("settings.saved", "success");
      }
      closeSettingsModal();
    });
  }
};

const refreshSettingsLocalization = () => {
  const modal = getSettingsModal();
  if (!(modal instanceof HTMLElement)) {
    return;
  }

  const wasVisible = modal.classList.contains("is-visible");
  renderSettingsModal(modal, readSettingsDraft());
  modal.classList.toggle("is-visible", wasVisible);
  if (typeof syncToolkitTheme === "function") {
    syncToolkitTheme();
  }
};

const openSettingsModal = () => {
  let modal = getSettingsModal();
  if (!modal) {
    modal = document.createElement("section");
    modal.id = SETTINGS_MODAL_ID;
    modal.className = "chatgpt-toolkit-prompt-modal";
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => {
      const target = e.target;
      const actionTarget =
        target instanceof Element
          ? target.closest("[data-settings-action]")
          : target instanceof Node && target.parentElement
            ? target.parentElement.closest("[data-settings-action]")
            : null;
      if (actionTarget) {
        if (actionTarget.dataset.settingsAction === "close") {
          closeSettingsModal();
        }
      }
    });

    if (typeof syncToolkitTheme === "function") {
      syncToolkitTheme();
    }
  }

  renderSettingsModal(modal);
  setTimeout(() => modal.classList.add("is-visible"), 10);
};


// 标志位：避免重复添加 resize 监听器
