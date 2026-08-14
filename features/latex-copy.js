/*
 * ChatGPT Conversation Toolkit - LaTeX quick copy
 */
const LATEX_COPY_VISIBLE_CLASS = "is-visible";
const LATEX_COPY_HIDE_DELAY_MS = 90;
const LATEX_FORMULA_SELECTOR = [
  '[role="math"]',
  "[data-math-source]",
  ".katex-display",
  ".katex",
  "mjx-container",
  "math",
].join(", ");
const LATEX_SOURCE_CONTAINER_SELECTOR = '[data-math-source], [role="math"]';
const LATEX_TOOLKIT_ROOT_SELECTOR = [
  `#${TOOLKIT_ID}`,
  `#${MINIMIZED_ID}`,
  `#${TIMELINE_ID}`,
  `#${PROMPT_MODAL_ID}`,
  `#${FOLDER_MANAGER_ID}`,
  `#${FOLDER_MENU_ID}`,
  `#${LATEX_COPY_ID}`,
].join(", ");

const latexCopyState = {
  initialized: false,
  activeFormula: null,
  hideTimer: 0,
  positionRafId: 0,
};

const toLatexText = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\u00a0/g, " ").trim();
};

const getLatexCopyButton = () => {
  const button = document.getElementById(LATEX_COPY_ID);
  return button instanceof HTMLButtonElement ? button : null;
};

const clearLatexCopyHideTimer = () => {
  if (!latexCopyState.hideTimer) {
    return;
  }
  clearTimeout(latexCopyState.hideTimer);
  latexCopyState.hideTimer = 0;
};

const hideLatexCopyButton = ({ clearFormula = false } = {}) => {
  clearLatexCopyHideTimer();
  const button = getLatexCopyButton();
  if (button) {
    button.classList.remove(LATEX_COPY_VISIBLE_CLASS);
  }
  if (clearFormula) {
    latexCopyState.activeFormula = null;
  }
};

const scheduleLatexCopyHide = () => {
  clearLatexCopyHideTimer();
  latexCopyState.hideTimer = setTimeout(() => {
    latexCopyState.hideTimer = 0;
    hideLatexCopyButton({ clearFormula: true });
  }, LATEX_COPY_HIDE_DELAY_MS);
};

const resolveFormulaElement = (target) => {
  if (!(target instanceof Element)) {
    return null;
  }
  if (target.closest(LATEX_TOOLKIT_ROOT_SELECTOR)) {
    return null;
  }

  let formula = target.closest(LATEX_FORMULA_SELECTOR);
  if (!(formula instanceof Element)) {
    return null;
  }

  // Current ChatGPT pages keep the source on a semantic wrapper outside the
  // generated KaTeX DOM. Prefer that wrapper even when the pointer is over a
  // nearer .katex/.katex-display descendant.
  const sourceContainer = formula.closest(LATEX_SOURCE_CONTAINER_SELECTOR);
  if (sourceContainer instanceof Element) {
    formula = sourceContainer;
  }

  if (formula.matches("math")) {
    const katex = formula.closest(".katex");
    const mathJax = formula.closest("mjx-container");
    formula = katex || mathJax || formula;
  }

  if (formula.classList.contains("katex")) {
    const display = formula.closest(".katex-display");
    if (display instanceof Element) {
      formula = display;
    }
  }

  if (!(formula instanceof Element) || !formula.closest("main")) {
    return null;
  }

  return formula;
};

const updateLatexCopyButtonPosition = () => {
  latexCopyState.positionRafId = 0;
  const button = getLatexCopyButton();
  const formula = latexCopyState.activeFormula;
  if (!(button instanceof HTMLButtonElement) || !(formula instanceof Element)) {
    hideLatexCopyButton({ clearFormula: true });
    return;
  }

  if (!formula.isConnected) {
    hideLatexCopyButton({ clearFormula: true });
    return;
  }

  const rect = formula.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  ) {
    hideLatexCopyButton({ clearFormula: true });
    return;
  }

  const edgePadding = 8;
  const inset = 6;
  const buttonWidth = button.offsetWidth || 84;
  const buttonHeight = button.offsetHeight || 28;
  const nextLeft = Math.min(
    Math.max(rect.right - buttonWidth - inset, edgePadding),
    window.innerWidth - buttonWidth - edgePadding,
  );
  const nextTop = Math.min(
    Math.max(rect.top + inset, edgePadding),
    window.innerHeight - buttonHeight - edgePadding,
  );

  button.style.left = `${Math.round(nextLeft)}px`;
  button.style.top = `${Math.round(nextTop)}px`;
  button.classList.add(LATEX_COPY_VISIBLE_CLASS);
};

const scheduleLatexCopyPositionUpdate = () => {
  if (latexCopyState.positionRafId) {
    return;
  }
  latexCopyState.positionRafId = requestAnimationFrame(updateLatexCopyButtonPosition);
};

const extractLatexFromFormula = (formula) => {
  if (!(formula instanceof Element)) {
    return "";
  }

  const sourceElements = [formula];
  const closestSourceContainer = formula.closest(LATEX_SOURCE_CONTAINER_SELECTOR);
  const nestedSourceContainer = formula.querySelector(LATEX_SOURCE_CONTAINER_SELECTOR);
  for (const element of [closestSourceContainer, nestedSourceContainer]) {
    if (element instanceof Element && !sourceElements.includes(element)) {
      sourceElements.push(element);
    }
  }

  for (const sourceElement of sourceElements) {
    const attrCandidates = [
      sourceElement.getAttribute("data-math-source"),
      sourceElement.getAttribute("data-latex"),
      sourceElement.getAttribute("data-tex"),
      sourceElement.getAttribute("data-math-text"),
      sourceElement.getAttribute("data-math"),
    ];
    for (const candidate of attrCandidates) {
      const normalized = toLatexText(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  const annotationCandidates = formula.querySelectorAll(
    'annotation[encoding="application/x-tex"], annotation[encoding="application/tex"], annotation',
  );
  for (const node of annotationCandidates) {
    const normalized = toLatexText(node.textContent);
    if (normalized) {
      return normalized;
    }
  }

  const scriptCandidates = formula.querySelectorAll(
    'script[type="math/tex"], script[type="math/tex; mode=display"]',
  );
  for (const node of scriptCandidates) {
    const normalized = toLatexText(node.textContent);
    if (normalized) {
      return normalized;
    }
  }

  for (const sourceElement of sourceElements) {
    const ariaLabel = toLatexText(sourceElement.getAttribute("aria-label"));
    if (ariaLabel) {
      return ariaLabel;
    }
  }

  return "";
};

const formatLatexForCopy = (latex, format = TOOLKIT_LATEX_COPY_FORMAT) => {
  const source = toLatexText(latex);
  if (!source) {
    return "";
  }

  switch (format) {
    case TOOLKIT_LATEX_COPY_FORMAT_MARKDOWN_INLINE:
      return `$${source}$`;
    case TOOLKIT_LATEX_COPY_FORMAT_MARKDOWN_BLOCK:
      return `$$\n${source}\n$$`;
    case TOOLKIT_LATEX_COPY_FORMAT_LATEX_INLINE:
      return `\\(${source}\\)`;
    case TOOLKIT_LATEX_COPY_FORMAT_LATEX_DISPLAY:
      return `\\[\n${source}\n\\]`;
    case TOOLKIT_LATEX_COPY_FORMAT_RAW:
    default:
      return source;
  }
};

const copyLatexText = async (text) => {
  if (!text) {
    return false;
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }

  textarea.remove();
  return copied;
};

const handleLatexCopyClick = async (event) => {
  event.preventDefault();
  event.stopPropagation();

  const formula = latexCopyState.activeFormula;
  const latex = extractLatexFromFormula(formula);
  if (!latex) {
    updateStatusByKey("status.latexCopyMissing", "info");
    return;
  }

  const copiedText = formatLatexForCopy(latex);
  const copied = await copyLatexText(copiedText);
  if (copied) {
    updateStatusByKey("status.latexCopyDone", "success");
    return;
  }
  updateStatusByKey("status.latexCopyBlocked", "info");
};

const ensureLatexCopyButton = () => {
  const existing = getLatexCopyButton();
  if (existing) {
    return existing;
  }
  if (!document.body) {
    return null;
  }

  const button = document.createElement("button");
  button.id = LATEX_COPY_ID;
  button.type = "button";
  button.className = "chatgpt-toolkit-latex-copy";
  button.textContent = t("latex.copy");
  button.setAttribute("aria-label", t("latex.copyAria"));
  button.addEventListener("click", (event) => {
    void handleLatexCopyClick(event);
  });
  button.addEventListener("pointerenter", () => {
    clearLatexCopyHideTimer();
  });
  button.addEventListener("pointerleave", () => {
    scheduleLatexCopyHide();
  });

  document.body.appendChild(button);
  syncToolkitTheme();
  return button;
};

const handleLatexPointerOver = (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!(target instanceof Element)) {
    return;
  }

  if (target.closest(`#${LATEX_COPY_ID}`)) {
    clearLatexCopyHideTimer();
    return;
  }

  const formula = resolveFormulaElement(target);
  if (!(formula instanceof Element)) {
    return;
  }

  latexCopyState.activeFormula = formula;
  clearLatexCopyHideTimer();
  ensureLatexCopyButton();
  scheduleLatexCopyPositionUpdate();
};

const handleLatexPointerOut = (event) => {
  if (!(latexCopyState.activeFormula instanceof Element)) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
  const activeFormula = latexCopyState.activeFormula;

  if (!(target instanceof Element)) {
    return;
  }

  const sourceFormula = resolveFormulaElement(target);
  if (sourceFormula !== activeFormula) {
    return;
  }

  if (related instanceof Element) {
    if (related.closest(`#${LATEX_COPY_ID}`)) {
      return;
    }
    const nextFormula = resolveFormulaElement(related);
    if (nextFormula === activeFormula) {
      return;
    }
  }

  scheduleLatexCopyHide();
};

const handleLatexViewportChange = () => {
  const button = getLatexCopyButton();
  if (!(button instanceof HTMLButtonElement) || !button.classList.contains(LATEX_COPY_VISIBLE_CLASS)) {
    return;
  }
  scheduleLatexCopyPositionUpdate();
};

const handleLatexPointerDown = (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!(target instanceof Element)) {
    hideLatexCopyButton({ clearFormula: true });
    return;
  }

  if (target.closest(`#${LATEX_COPY_ID}`)) {
    return;
  }
  if (resolveFormulaElement(target)) {
    return;
  }

  hideLatexCopyButton({ clearFormula: true });
};

const refreshLatexCopyLocalization = () => {
  const button = getLatexCopyButton();
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  button.textContent = t("latex.copy");
  button.setAttribute("aria-label", t("latex.copyAria"));
};

const initLatexCopy = () => {
  if (latexCopyState.initialized) {
    return;
  }
  latexCopyState.initialized = true;

  ensureLatexCopyButton();
  hideLatexCopyButton({ clearFormula: true });

  document.addEventListener("pointerover", handleLatexPointerOver, true);
  document.addEventListener("pointerout", handleLatexPointerOut, true);
  document.addEventListener("pointerdown", handleLatexPointerDown, true);
  document.addEventListener("scroll", handleLatexViewportChange, true);
  window.addEventListener("resize", handleLatexViewportChange, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hideLatexCopyButton({ clearFormula: true });
    }
  });
};
