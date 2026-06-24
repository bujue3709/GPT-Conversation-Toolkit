/*
 * ChatGPT Conversation Toolkit - Theme synchronization
 */
const parseRgbColor = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const matched = value.match(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);
  if (!matched) {
    return null;
  }

  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
};

const isDarkBackground = (element) => {
  if (!element) {
    return false;
  }

  const backgroundColor = window.getComputedStyle(element).backgroundColor;
  const rgb = parseRgbColor(backgroundColor);
  if (!rgb) {
    return false;
  }

  const [red, green, blue] = rgb;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.5;
};

const detectChatGPTTheme = () => {
  const html = document.documentElement;
  const body = document.body;

  const explicitTheme = html?.getAttribute("data-theme") || body?.getAttribute("data-theme");
  if (explicitTheme === "dark" || explicitTheme === "light") {
    return explicitTheme;
  }

  if (html?.classList.contains("dark") || body?.classList.contains("dark")) {
    return "dark";
  }
  if (html?.classList.contains("light") || body?.classList.contains("light")) {
    return "light";
  }

  const colorScheme = (window.getComputedStyle(html).colorScheme || "").toLowerCase();
  if (colorScheme.includes("dark")) {
    return "dark";
  }
  if (colorScheme.includes("light")) {
    return "light";
  }

  if (isDarkBackground(body) || isDarkBackground(html)) {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const applyToolkitTheme = (theme) => {
  const nodes = [
    document.getElementById(TOOLKIT_ID),
    document.getElementById(MINIMIZED_ID),
    document.getElementById(TIMELINE_ID),
    document.getElementById(LATEX_COPY_ID),
    document.getElementById(PROMPT_MODAL_ID),
    document.getElementById("chatgpt-toolkit-settings-modal"),
    document.getElementById(FOLDER_MANAGER_ID),
    document.getElementById(FOLDER_MENU_ID),
    document.querySelector(`[${FOLDER_ROOT_ATTR}="1"]`),
  ];

  nodes.forEach((node) => {
    if (node) {
      node.setAttribute(THEME_ATTR, theme);
    }
  });
};

const syncToolkitTheme = () => {
  applyToolkitTheme(detectChatGPTTheme());
};

const observeThemeOnBodyIfNeeded = () => {
  if (!themeObserver || bodyThemeObserved || !document.body) {
    return;
  }
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: themeAttributeFilter,
  });
  bodyThemeObserved = true;
};

const setupThemeSync = () => {
  if (themeObserver) {
    observeThemeOnBodyIfNeeded();
    syncToolkitTheme();
    return;
  }

  themeObserver = new MutationObserver(() => {
    syncToolkitTheme();
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: themeAttributeFilter,
  });

  observeThemeOnBodyIfNeeded();

  themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  if (typeof themeMediaQuery.addEventListener === "function") {
    themeMediaQuery.addEventListener("change", syncToolkitTheme);
  } else if (typeof themeMediaQuery.addListener === "function") {
    themeMediaQuery.addListener(syncToolkitTheme);
  }

  syncToolkitTheme();
};
