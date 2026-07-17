/*
 * ChatGPT Conversation Toolkit - Selective conversation export
 */
const EXPORT_SELECTION_MODAL_ID = "chatgpt-toolkit-export-selection-modal";
const EXPORT_SELECTION_PAGE_SIZE = 50;

const exportSelectionState = {
  isOpen: false,
  loading: false,
  loadToken: 0,
  preparedExport: null,
  turns: [],
  selectedTurnIds: new Set(),
  scope: EXPORT_SCOPE_ALL,
  roleFilter: TOOLKIT_EXPORT_ROLE_ALL,
  format: TOOLKIT_EXPORT_FORMAT_JSON,
  page: 0,
  lastSelectedTurnIndex: -1,
  error: null,
  previousFocus: null,
};

let exportSelectionEscapeBound = false;

const escapeExportSelectionHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const truncateExportSelectionText = (value, maxLength = 180) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
};

const getExportSelectionModal = () => document.getElementById(EXPORT_SELECTION_MODAL_ID);

const getExportSelectionConfig = () =>
  typeof getToolkitConfig === "function"
    ? getToolkitConfig()
    : {
        exportFormat: TOOLKIT_EXPORT_FORMAT,
        exportRole: TOOLKIT_EXPORT_ROLE,
      };

const resetExportSelectionState = () => {
  const config = getExportSelectionConfig();
  exportSelectionState.loading = true;
  exportSelectionState.preparedExport = null;
  exportSelectionState.turns = [];
  exportSelectionState.selectedTurnIds = new Set();
  exportSelectionState.scope = EXPORT_SCOPE_ALL;
  exportSelectionState.roleFilter = TOOLKIT_EXPORT_ROLE_VALUES.includes(config.exportRole)
    ? config.exportRole
    : TOOLKIT_EXPORT_ROLE_ALL;
  exportSelectionState.format = TOOLKIT_EXPORT_FORMAT_VALUES.includes(config.exportFormat)
    ? config.exportFormat
    : TOOLKIT_EXPORT_FORMAT_JSON;
  exportSelectionState.page = 0;
  exportSelectionState.lastSelectedTurnIndex = -1;
  exportSelectionState.error = null;
};

const closeExportSelectionModal = () => {
  exportSelectionState.isOpen = false;
  exportSelectionState.loadToken += 1;
  const modal = getExportSelectionModal();
  if (modal instanceof HTMLElement) {
    modal.classList.remove("is-visible");
  }
  const previousFocus = exportSelectionState.previousFocus;
  exportSelectionState.previousFocus = null;
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
    requestAnimationFrame(() => previousFocus.focus());
  }
};

const getExportSelectionTurnPreview = (turn, role) => {
  const entries = role === "assistant" ? turn?.assistantMessages : turn?.userMessages;
  const text = (Array.isArray(entries) ? entries : [])
    .map((entry) => entry?.message?.text || "")
    .filter(Boolean)
    .join(" ");
  return truncateExportSelectionText(text) || t("exportSelection.emptyPreview");
};

const getExportSelectionResultPreview = () => {
  const payload = exportSelectionState.preparedExport?.payload;
  if (!payload) {
    return null;
  }
  return applyExportSelection(payload, {
    scope: exportSelectionState.scope,
    selectedTurnIds: Array.from(exportSelectionState.selectedTurnIds),
    roleFilter: exportSelectionState.roleFilter,
  });
};

const getExportSelectionPageCount = () =>
  Math.max(1, Math.ceil(exportSelectionState.turns.length / EXPORT_SELECTION_PAGE_SIZE));

const clampExportSelectionPage = () => {
  exportSelectionState.page = Math.min(
    Math.max(0, exportSelectionState.page),
    getExportSelectionPageCount() - 1,
  );
};

const buildExportSelectionTurnMarkup = () => {
  clampExportSelectionPage();
  const start = exportSelectionState.page * EXPORT_SELECTION_PAGE_SIZE;
  return exportSelectionState.turns
    .slice(start, start + EXPORT_SELECTION_PAGE_SIZE)
    .map((turn) => {
      const checked = exportSelectionState.selectedTurnIds.has(turn.id);
      const userPreview = getExportSelectionTurnPreview(turn, "user");
      const assistantPreview = getExportSelectionTurnPreview(turn, "assistant");
      return `
        <label class="chatgpt-toolkit-export-turn${checked ? " is-selected" : ""}">
          <input
            type="checkbox"
            data-export-turn-checkbox="${escapeExportSelectionHtml(turn.id)}"
            ${checked ? "checked" : ""}
          />
          <span class="chatgpt-toolkit-export-turn-body">
            <strong>${t("exportSelection.turn", { index: turn.order })}</strong>
            <span><b>${t("exportSelection.userLabel")}</b>${escapeExportSelectionHtml(userPreview)}</span>
            <span><b>${t("exportSelection.assistantLabel")}</b>${escapeExportSelectionHtml(assistantPreview)}</span>
          </span>
        </label>
      `;
    })
    .join("");
};

const renderExportSelectionModal = () => {
  const modal = getExportSelectionModal();
  if (!(modal instanceof HTMLElement)) {
    return;
  }

  if (exportSelectionState.loading) {
    modal.innerHTML = `
      <div class="chatgpt-toolkit-prompt-backdrop" data-export-selection-action="close"></div>
      <div class="chatgpt-toolkit-prompt-panel chatgpt-toolkit-export-panel" role="dialog" aria-modal="true" aria-label="${t("exportSelection.ariaLabel")}">
        <div class="chatgpt-toolkit-prompt-header">
          <strong>${t("exportSelection.title")}</strong>
          <button type="button" class="chatgpt-toolkit-prompt-close" data-export-selection-action="close">${t("exportSelection.close")}</button>
        </div>
        <div class="chatgpt-toolkit-export-loading">${t("exportSelection.loading")}</div>
      </div>
    `;
    return;
  }

  if (exportSelectionState.error) {
    modal.innerHTML = `
      <div class="chatgpt-toolkit-prompt-backdrop" data-export-selection-action="close"></div>
      <div class="chatgpt-toolkit-prompt-panel chatgpt-toolkit-export-panel" role="dialog" aria-modal="true" aria-label="${t("exportSelection.ariaLabel")}">
        <div class="chatgpt-toolkit-prompt-header">
          <strong>${t("exportSelection.title")}</strong>
          <button type="button" class="chatgpt-toolkit-prompt-close" data-export-selection-action="close">${t("exportSelection.close")}</button>
        </div>
        <div class="chatgpt-toolkit-export-error">${escapeExportSelectionHtml(exportSelectionState.error.message || exportSelectionState.error)}</div>
        <div class="chatgpt-toolkit-prompt-footer">
          <span></span>
          <div class="chatgpt-toolkit-prompt-footer-actions">
            <button type="button" data-export-selection-action="retry">${t("exportSelection.retry")}</button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const resultPreview = getExportSelectionResultPreview();
  const isSelectedScope = exportSelectionState.scope === EXPORT_SCOPE_SELECTED;
  const pageCount = getExportSelectionPageCount();
  const selectedCount = exportSelectionState.selectedTurnIds.size;
  const messageCount = resultPreview?.messageCount || 0;
  const partialWarning = exportSelectionState.preparedExport?.usedFallback
    ? `<div class="chatgpt-toolkit-export-warning">${t("exportSelection.partialWarning")}</div>`
    : "";
  const turnSection = `
    <div data-export-selection-turn-section ${isSelectedScope ? "" : "hidden"}>
      <div class="chatgpt-toolkit-export-selection-tools">
        <span data-export-selection-selected-count>${t("exportSelection.selectedCount", { selected: selectedCount, total: exportSelectionState.turns.length })}</span>
        <div>
          <button type="button" data-export-selection-action="select-all">${t("exportSelection.selectAll")}</button>
          <button type="button" data-export-selection-action="invert">${t("exportSelection.invert")}</button>
          <button type="button" data-export-selection-action="clear">${t("exportSelection.clear")}</button>
        </div>
      </div>
      <div class="chatgpt-toolkit-export-turn-list" data-export-selection-turn-list role="group" aria-label="${t("exportSelection.turnListAria")}">
        ${buildExportSelectionTurnMarkup()}
      </div>
      <div class="chatgpt-toolkit-export-pagination">
        <button type="button" data-export-selection-action="prev-page" ${exportSelectionState.page <= 0 ? "disabled" : ""}>${t("exportSelection.prevPage")}</button>
        <span data-export-selection-page>${t("exportSelection.page", { current: exportSelectionState.page + 1, total: pageCount })}</span>
        <button type="button" data-export-selection-action="next-page" ${exportSelectionState.page >= pageCount - 1 ? "disabled" : ""}>${t("exportSelection.nextPage")}</button>
      </div>
    </div>
  `;

  modal.innerHTML = `
    <div class="chatgpt-toolkit-prompt-backdrop" data-export-selection-action="close"></div>
    <div class="chatgpt-toolkit-prompt-panel chatgpt-toolkit-export-panel" role="dialog" aria-modal="true" aria-label="${t("exportSelection.ariaLabel")}">
      <div class="chatgpt-toolkit-prompt-header">
        <strong>${t("exportSelection.title")}</strong>
        <button type="button" class="chatgpt-toolkit-prompt-close" data-export-selection-action="close">${t("exportSelection.close")}</button>
      </div>
      ${partialWarning}
      <div class="chatgpt-toolkit-export-controls">
        <label class="chatgpt-toolkit-form-group">
          <span class="chatgpt-toolkit-form-label">${t("exportSelection.scopeLabel")}</span>
          <select class="chatgpt-toolkit-input" data-export-selection-field="scope">
            <option value="${EXPORT_SCOPE_ALL}"${exportSelectionState.scope === EXPORT_SCOPE_ALL ? " selected" : ""}>${t("exportSelection.scopeAll")}</option>
            <option value="${EXPORT_SCOPE_SELECTED}"${isSelectedScope ? " selected" : ""}>${t("exportSelection.scopeSelected")}</option>
          </select>
        </label>
        <label class="chatgpt-toolkit-form-group">
          <span class="chatgpt-toolkit-form-label">${t("exportSelection.roleLabel")}</span>
          <select class="chatgpt-toolkit-input" data-export-selection-field="role">
            <option value="${TOOLKIT_EXPORT_ROLE_ALL}"${exportSelectionState.roleFilter === TOOLKIT_EXPORT_ROLE_ALL ? " selected" : ""}>${t("exportSelection.roleAll")}</option>
            <option value="${TOOLKIT_EXPORT_ROLE_ASSISTANT}"${exportSelectionState.roleFilter === TOOLKIT_EXPORT_ROLE_ASSISTANT ? " selected" : ""}>${t("exportSelection.roleAssistant")}</option>
          </select>
        </label>
        <label class="chatgpt-toolkit-form-group">
          <span class="chatgpt-toolkit-form-label">${t("exportSelection.formatLabel")}</span>
          <select class="chatgpt-toolkit-input" data-export-selection-field="format">
            <option value="${TOOLKIT_EXPORT_FORMAT_JSON}"${exportSelectionState.format === TOOLKIT_EXPORT_FORMAT_JSON ? " selected" : ""}>.json</option>
            <option value="${TOOLKIT_EXPORT_FORMAT_TEXT}"${exportSelectionState.format === TOOLKIT_EXPORT_FORMAT_TEXT ? " selected" : ""}>.txt</option>
            <option value="${TOOLKIT_EXPORT_FORMAT_MARKDOWN}"${exportSelectionState.format === TOOLKIT_EXPORT_FORMAT_MARKDOWN ? " selected" : ""}>.md</option>
          </select>
        </label>
      </div>
      ${turnSection}
      <div class="chatgpt-toolkit-prompt-footer">
        <span data-export-selection-result-count>${t("exportSelection.resultCount", { turns: resultPreview?.selectedTurnCount || 0, messages: messageCount })}</span>
        <div class="chatgpt-toolkit-prompt-footer-actions">
          <button type="button" data-export-selection-action="close">${t("exportSelection.cancel")}</button>
          <button type="button" data-export-selection-action="export" data-export-selection-export-button ${messageCount <= 0 ? "disabled" : ""}>${t("exportSelection.export")}</button>
        </div>
      </div>
    </div>
  `;
};

const syncExportSelectionVisibleTurns = () => {
  const modal = getExportSelectionModal();
  if (!(modal instanceof HTMLElement)) {
    return;
  }
  modal.querySelectorAll("[data-export-turn-checkbox]").forEach((checkbox) => {
    if (!(checkbox instanceof HTMLInputElement)) {
      return;
    }
    const checked = exportSelectionState.selectedTurnIds.has(checkbox.dataset.exportTurnCheckbox);
    checkbox.checked = checked;
    checkbox.closest(".chatgpt-toolkit-export-turn")?.classList.toggle("is-selected", checked);
  });
};

const updateExportSelectionInteractiveUi = () => {
  const modal = getExportSelectionModal();
  if (!(modal instanceof HTMLElement) || exportSelectionState.loading || exportSelectionState.error) {
    return;
  }

  const isSelectedScope = exportSelectionState.scope === EXPORT_SCOPE_SELECTED;
  const turnSection = modal.querySelector("[data-export-selection-turn-section]");
  if (turnSection instanceof HTMLElement) {
    turnSection.hidden = !isSelectedScope;
  }

  const selectedCount = modal.querySelector("[data-export-selection-selected-count]");
  if (selectedCount instanceof HTMLElement) {
    selectedCount.textContent = t("exportSelection.selectedCount", {
      selected: exportSelectionState.selectedTurnIds.size,
      total: exportSelectionState.turns.length,
    });
  }

  const resultPreview = getExportSelectionResultPreview();
  const messageCount = resultPreview?.messageCount || 0;
  const resultCount = modal.querySelector("[data-export-selection-result-count]");
  if (resultCount instanceof HTMLElement) {
    resultCount.textContent = t("exportSelection.resultCount", {
      turns: resultPreview?.selectedTurnCount || 0,
      messages: messageCount,
    });
  }
  const exportButton = modal.querySelector("[data-export-selection-export-button]");
  if (exportButton instanceof HTMLButtonElement) {
    exportButton.disabled = messageCount <= 0;
  }
  syncExportSelectionVisibleTurns();
};

const renderExportSelectionPage = () => {
  const modal = getExportSelectionModal();
  if (!(modal instanceof HTMLElement)) {
    return;
  }
  clampExportSelectionPage();
  const turnList = modal.querySelector("[data-export-selection-turn-list]");
  if (turnList instanceof HTMLElement) {
    turnList.innerHTML = buildExportSelectionTurnMarkup();
    turnList.scrollTop = 0;
  }
  const pageCount = getExportSelectionPageCount();
  const previousButton = modal.querySelector('[data-export-selection-action="prev-page"]');
  const nextButton = modal.querySelector('[data-export-selection-action="next-page"]');
  const pageLabel = modal.querySelector("[data-export-selection-page]");
  if (previousButton instanceof HTMLButtonElement) {
    previousButton.disabled = exportSelectionState.page <= 0;
  }
  if (nextButton instanceof HTMLButtonElement) {
    nextButton.disabled = exportSelectionState.page >= pageCount - 1;
  }
  if (pageLabel instanceof HTMLElement) {
    pageLabel.textContent = t("exportSelection.page", {
      current: exportSelectionState.page + 1,
      total: pageCount,
    });
  }
  updateExportSelectionInteractiveUi();
};

const setExportSelectionTurnChecked = (turnIndex, checked, extendRange = false) => {
  if (turnIndex < 0 || turnIndex >= exportSelectionState.turns.length) {
    return;
  }
  let start = turnIndex;
  let end = turnIndex;
  if (extendRange && exportSelectionState.lastSelectedTurnIndex >= 0) {
    start = Math.min(turnIndex, exportSelectionState.lastSelectedTurnIndex);
    end = Math.max(turnIndex, exportSelectionState.lastSelectedTurnIndex);
  }
  for (let index = start; index <= end; index += 1) {
    const turnId = exportSelectionState.turns[index].id;
    if (checked) {
      exportSelectionState.selectedTurnIds.add(turnId);
    } else {
      exportSelectionState.selectedTurnIds.delete(turnId);
    }
  }
  exportSelectionState.lastSelectedTurnIndex = turnIndex;
};

const loadExportSelectionData = async () => {
  const token = exportSelectionState.loadToken + 1;
  exportSelectionState.loadToken = token;
  exportSelectionState.loading = true;
  exportSelectionState.error = null;
  renderExportSelectionModal();

  try {
    const preparedExport = await prepareConversationExportPayload({ updateStatus: false });
    if (!exportSelectionState.isOpen || token !== exportSelectionState.loadToken) {
      return;
    }
    exportSelectionState.preparedExport = preparedExport;
    exportSelectionState.turns = groupExportMessagesIntoTurns(preparedExport.payload.messages);
    exportSelectionState.loading = false;
    updateStatusByKey("status.exportSelectionReady", "success", {
      count: exportSelectionState.turns.length,
    });
  } catch (error) {
    if (!exportSelectionState.isOpen || token !== exportSelectionState.loadToken) {
      return;
    }
    exportSelectionState.loading = false;
    exportSelectionState.error = normalizeExportApiError(error, "Export preparation failed.");
    updateStatusByKey("status.exportFailed", "warn", {
      reason: exportSelectionState.error.message,
    });
  }
  renderExportSelectionModal();
};

const handleExportSelectionAction = async (action) => {
  if (action === "close") {
    closeExportSelectionModal();
    return;
  }
  if (action === "retry") {
    await loadExportSelectionData();
    return;
  }
  if (action === "select-all") {
    exportSelectionState.selectedTurnIds = new Set(exportSelectionState.turns.map((turn) => turn.id));
  } else if (action === "clear") {
    exportSelectionState.selectedTurnIds.clear();
  } else if (action === "invert") {
    exportSelectionState.selectedTurnIds = new Set(
      exportSelectionState.turns
        .filter((turn) => !exportSelectionState.selectedTurnIds.has(turn.id))
        .map((turn) => turn.id),
    );
  } else if (action === "prev-page") {
    exportSelectionState.page -= 1;
    renderExportSelectionPage();
    return;
  } else if (action === "next-page") {
    exportSelectionState.page += 1;
    renderExportSelectionPage();
    return;
  } else if (action === "export") {
    const config = {
      exportFormat: exportSelectionState.format,
      exportRole: exportSelectionState.roleFilter,
    };
    if (typeof saveToolkitConfig === "function") {
      saveToolkitConfig(config);
    }
    const payload = await exportMessages({
      preparedExport: exportSelectionState.preparedExport,
      scope: exportSelectionState.scope,
      selectedTurnIds: Array.from(exportSelectionState.selectedTurnIds),
      roleFilter: exportSelectionState.roleFilter,
      format: exportSelectionState.format,
    });
    if (payload) {
      closeExportSelectionModal();
    }
    return;
  }
  updateExportSelectionInteractiveUi();
};

const ensureExportSelectionModal = () => {
  let modal = getExportSelectionModal();
  if (!(modal instanceof HTMLElement)) {
    modal = document.createElement("section");
    modal.id = EXPORT_SELECTION_MODAL_ID;
    modal.className = "chatgpt-toolkit-prompt-modal";
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.dataset.exportTurnCheckbox) {
        const turnIndex = exportSelectionState.turns.findIndex(
          (turn) => turn.id === target.dataset.exportTurnCheckbox,
        );
        setExportSelectionTurnChecked(turnIndex, target.checked, event.shiftKey);
        updateExportSelectionInteractiveUi();
        return;
      }
      const actionTarget = target instanceof Element
        ? target.closest("[data-export-selection-action]")
        : null;
      const action = actionTarget?.dataset?.exportSelectionAction;
      if (action) {
        void handleExportSelectionAction(action);
      }
    });

    modal.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) {
        return;
      }
      const field = target.dataset.exportSelectionField;
      if (field === "scope") {
        exportSelectionState.scope = target.value === EXPORT_SCOPE_SELECTED
          ? EXPORT_SCOPE_SELECTED
          : EXPORT_SCOPE_ALL;
        exportSelectionState.page = 0;
        renderExportSelectionPage();
        return;
      } else if (field === "role") {
        exportSelectionState.roleFilter = target.value === TOOLKIT_EXPORT_ROLE_ASSISTANT
          ? TOOLKIT_EXPORT_ROLE_ASSISTANT
          : TOOLKIT_EXPORT_ROLE_ALL;
        updateExportSelectionInteractiveUi();
      } else if (field === "format") {
        exportSelectionState.format = TOOLKIT_EXPORT_FORMAT_VALUES.includes(target.value)
          ? target.value
          : TOOLKIT_EXPORT_FORMAT_JSON;
      }
    });
  }

  if (!exportSelectionEscapeBound) {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && exportSelectionState.isOpen) {
        closeExportSelectionModal();
      }
    });
    exportSelectionEscapeBound = true;
  }
  return modal;
};

const refreshExportSelectionLocalization = () => {
  if (exportSelectionState.isOpen) {
    renderExportSelectionModal();
  }
};

const openExportSelectionModal = async () => {
  const modal = ensureExportSelectionModal();
  exportSelectionState.previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  resetExportSelectionState();
  exportSelectionState.isOpen = true;
  renderExportSelectionModal();
  if (typeof syncToolkitTheme === "function") {
    syncToolkitTheme();
  }
  requestAnimationFrame(() => {
    modal.classList.add("is-visible");
    modal.querySelector("button, select")?.focus();
  });
  await loadExportSelectionData();
};

window.addEventListener("__chatgptConversationToolkitRouteChange", () => {
  if (exportSelectionState.isOpen) {
    closeExportSelectionModal();
  }
});
