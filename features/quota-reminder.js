/*
 * ChatGPT Conversation Toolkit - Usage quota reminder
 */
const QUOTA_BUCKET_REQUEST_LIMIT = 240;
const QUOTA_BUCKET_RETENTION_LIMIT = 18;
const QUOTA_REFRESH_INTERVAL_MS = 60 * 1000;
const QUOTA_NOTICE_SCAN_INTERVAL_MS = 30 * 1000;
const QUOTA_DRAG_THRESHOLD = 5;

const normalizeQuotaModelKey = (value) => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text.replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
};

const getQuotaConfig = () =>
  typeof getToolkitConfig === "function" ? getToolkitConfig() : normalizeToolkitConfig({});

const getQuotaWindowMs = () => getQuotaConfig().quotaResetIntervalMinutes * 60 * 1000;

const buildQuotaBucketKey = (modelKey, windowStartAt) =>
  `${normalizeQuotaModelKey(modelKey)}:${Math.floor(windowStartAt / getQuotaWindowMs())}`;

const pruneQuotaSnapshot = (snapshot) => {
  const buckets = snapshot?.buckets && typeof snapshot.buckets === "object" ? snapshot.buckets : {};
  const entries = Object.entries(buckets).sort(
    (a, b) => Number(b[1]?.windowStartAt || 0) - Number(a[1]?.windowStartAt || 0),
  );
  return {
    version: 1,
    activeBucketKey: snapshot?.activeBucketKey || "",
    buckets: Object.fromEntries(entries.slice(0, QUOTA_BUCKET_RETENTION_LIMIT)),
  };
};

const persistQuotaSnapshot = () => {
  quotaState.snapshot = pruneQuotaSnapshot(quotaState.snapshot);
  saveQuotaSnapshot(quotaState.snapshot);
};

const getOrCreateQuotaBucket = (options = {}) => {
  const config = getQuotaConfig();
  const now = options.now || Date.now();
  const modelKey = normalizeQuotaModelKey(options.modelKey || quotaState.currentModelKey || "default");
  quotaState.currentModelKey = modelKey;

  const snapshot = normalizeQuotaSnapshot(quotaState.snapshot);
  quotaState.snapshot = snapshot;

  let activeBucket = snapshot.buckets[snapshot.activeBucketKey];
  const windowMs = config.quotaResetIntervalMinutes * 60 * 1000;
  const activeExpired =
    !activeBucket ||
    activeBucket.modelKey !== modelKey ||
    now >= Number(activeBucket.resetAt || 0);

  if (!activeExpired) {
    return activeBucket;
  }

  const windowStartAt = now;
  const resetAt = windowStartAt + windowMs;
  const bucketKey = buildQuotaBucketKey(modelKey, windowStartAt);
  activeBucket = snapshot.buckets[bucketKey] || {
    modelKey,
    planKey: config.quotaPlanPreset,
    windowStartAt,
    resetAt,
    sentCount: 0,
    requestIds: [],
    officialResetAt: 0,
    officialNoticeText: "",
  };
  activeBucket.modelKey = modelKey;
  activeBucket.planKey = config.quotaPlanPreset;
  activeBucket.resetAt = Number(activeBucket.resetAt || resetAt);
  activeBucket.requestIds = Array.isArray(activeBucket.requestIds) ? activeBucket.requestIds : [];
  snapshot.buckets[bucketKey] = activeBucket;
  snapshot.activeBucketKey = bucketKey;
  quotaState.activeBucketKey = bucketKey;
  persistQuotaSnapshot();
  return activeBucket;
};

const rollQuotaWindowIfExpired = () => {
  const bucket = getOrCreateQuotaBucket();
  if (Date.now() >= Number(bucket.resetAt || 0)) {
    resetQuotaWindow({ silent: true });
  }
};

const resetQuotaWindow = (options = {}) => {
  const now = Date.now();
  const config = getQuotaConfig();
  const modelKey = normalizeQuotaModelKey(quotaState.currentModelKey || "default");
  const bucketKey = buildQuotaBucketKey(modelKey, now);
  quotaState.snapshot = normalizeQuotaSnapshot(quotaState.snapshot);
  quotaState.snapshot.activeBucketKey = bucketKey;
  quotaState.snapshot.buckets[bucketKey] = {
    modelKey,
    planKey: config.quotaPlanPreset,
    windowStartAt: now,
    resetAt: now + config.quotaResetIntervalMinutes * 60 * 1000,
    sentCount: 0,
    requestIds: [],
    officialResetAt: 0,
    officialNoticeText: "",
  };
  quotaState.activeBucketKey = bucketKey;
  quotaState.officialResetAt = 0;
  quotaState.officialNoticeText = "";
  persistQuotaSnapshot();
  updateQuotaReminder();
  if (!options.silent && typeof updateStatusByKey === "function") {
    updateStatusByKey("quota.resetDone", "success");
  }
};

const incrementQuotaUsage = (detail = {}) => {
  const dedupeKey =
    typeof detail.dedupeKey === "string" && detail.dedupeKey
      ? detail.dedupeKey
      : `${detail.messageId || ""}:${detail.sentAt || Date.now()}`;
  const bucket = getOrCreateQuotaBucket({
    modelKey: detail.modelKey || quotaState.currentModelKey,
    now: Number(detail.sentAt || Date.now()),
  });

  if (bucket.requestIds.includes(dedupeKey)) {
    return;
  }

  bucket.requestIds.push(dedupeKey);
  if (bucket.requestIds.length > QUOTA_BUCKET_REQUEST_LIMIT) {
    bucket.requestIds = bucket.requestIds.slice(-QUOTA_BUCKET_REQUEST_LIMIT);
  }
  bucket.sentCount = Math.max(0, Number(bucket.sentCount || 0)) + 1;
  persistQuotaSnapshot();
  updateQuotaReminder();
};

const formatQuotaDuration = (ms) => {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return t("quota.durationHours", { hours, minutes });
  }
  return t("quota.durationMinutes", { minutes });
};

const formatQuotaResetClock = (timestamp) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (error) {
    return "";
  }
};

const getQuotaStats = () => {
  const config = getQuotaConfig();
  const bucket = getOrCreateQuotaBucket();
  const now = Date.now();
  const maxMessages = Math.max(1, Number(config.quotaMaxMessages || 1));
  const used = Math.max(0, Number(bucket.sentCount || 0));
  const remaining = Math.max(0, maxMessages - used);
  const resetAt = Number(bucket.officialResetAt || quotaState.officialResetAt || bucket.resetAt || 0);
  const usedPercent = Math.min(100, Math.round((used / maxMessages) * 100));
  const elapsedHours = Math.max(1 / 60, (now - Number(bucket.windowStartAt || now)) / 3600000);
  const rate = used / elapsedHours;
  const danger = remaining <= config.quotaDangerRemaining || used >= maxMessages;
  const warning = danger || usedPercent >= config.quotaWarningPercent;
  return {
    used,
    maxMessages,
    remaining,
    resetAt,
    resetInMs: resetAt - now,
    usedPercent,
    rate,
    warning,
    danger,
    officialNoticeText: bucket.officialNoticeText || quotaState.officialNoticeText || "",
  };
};

const getQuotaEstimateNotice = (stats) => {
  if (stats.officialNoticeText) {
    return t("quota.officialCalibrated");
  }
  const config = getQuotaConfig();
  const preset = getQuotaPlanPreset(config.quotaPlanPreset);
  if (config.quotaPlanPreset !== "custom" && preset?.confidenceKey) {
    return t(preset.confidenceKey);
  }
  return t("quota.localEstimate");
};

const parseOfficialResetTime = (text) => {
  const value = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!value) {
    return 0;
  }

  const timeMatch = value.match(/\b(?:at|until|after|resets?\s+at|重置(?:时间)?[:：]?)\s*(tomorrow\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!timeMatch) {
    return 0;
  }

  const now = new Date();
  let hours = Number(timeMatch[2]);
  const minutes = Number(timeMatch[3] || 0);
  const meridiem = (timeMatch[4] || "").toLowerCase();
  if (meridiem === "pm" && hours < 12) {
    hours += 12;
  } else if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  const reset = new Date(now);
  reset.setHours(hours, minutes, 0, 0);
  if (timeMatch[1] || reset.getTime() <= now.getTime()) {
    reset.setDate(reset.getDate() + 1);
  }
  return reset.getTime();
};

const scanOfficialQuotaNotice = () => {
  const bodyText = document.body?.innerText || "";
  if (!bodyText) {
    return;
  }
  const lines = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const notice = lines.find((line) =>
    /limit|usage cap|rate limit|resets?|try again|限制|限额|配额|重置/i.test(line),
  );
  if (!notice) {
    return;
  }

  const resetAt = parseOfficialResetTime(notice);
  if (!resetAt) {
    return;
  }

  const bucket = getOrCreateQuotaBucket();
  bucket.officialResetAt = resetAt;
  bucket.officialNoticeText = notice.slice(0, 240);
  quotaState.officialResetAt = resetAt;
  quotaState.officialNoticeText = bucket.officialNoticeText;
  persistQuotaSnapshot();
  updateQuotaReminder();
};

const getQuotaReminder = () => document.getElementById(QUOTA_REMINDER_ID);

const applyQuotaReminderPosition = (element) => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  const position = quotaState.position;
  if (!position) {
    element.style.left = "";
    element.style.top = "";
    element.style.right = "";
    element.style.bottom = "";
    return;
  }
  const rect = element.getBoundingClientRect();
  const width = rect.width || element.offsetWidth || 240;
  const height = rect.height || element.offsetHeight || 120;
  const next = clampFloatingButtonPosition(position.left, position.top, width, height);
  element.style.left = `${Math.round(next.left)}px`;
  element.style.top = `${Math.round(next.top)}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
  quotaState.position = next;
};

const buildQuotaReminder = () => {
  const element = document.createElement("section");
  element.id = QUOTA_REMINDER_ID;
  element.className = "chatgpt-toolkit-quota-reminder";
  element.setAttribute("aria-label", t("quota.title"));
  element.innerHTML = `
    <div class="chatgpt-toolkit-quota-header">
      <strong class="chatgpt-toolkit-quota-title">${t("quota.title")}</strong>
      <div class="chatgpt-toolkit-quota-actions">
        <button type="button" data-quota-action="reset" title="${t("quota.reset")}">0</button>
        <button type="button" data-quota-action="minimize" title="${t("quota.minimize")}">-</button>
        <button type="button" data-quota-action="close" title="${t("quota.close")}">x</button>
      </div>
    </div>
    <button type="button" class="chatgpt-toolkit-quota-mini" data-quota-action="expand" title="${t("quota.expand")}"></button>
    <div class="chatgpt-toolkit-quota-body">
      <div class="chatgpt-toolkit-quota-progress" aria-hidden="true">
        <span class="chatgpt-toolkit-quota-progress-fill"></span>
      </div>
      <div class="chatgpt-toolkit-quota-main"></div>
      <div class="chatgpt-toolkit-quota-meta"></div>
      <div class="chatgpt-toolkit-quota-notice"></div>
    </div>
  `;

  element.addEventListener("click", (event) => {
    const actionTarget =
      event.target instanceof Element ? event.target.closest("[data-quota-action]") : null;
    if (!(actionTarget instanceof HTMLElement)) {
      return;
    }
    const action = actionTarget.dataset.quotaAction;
    if (action === "minimize") {
      quotaState.minimized = true;
      saveQuotaUiState(quotaState);
      updateQuotaReminder();
    } else if (action === "expand") {
      quotaState.minimized = false;
      saveQuotaUiState(quotaState);
      updateQuotaReminder();
    } else if (action === "close") {
      setQuotaReminderVisible(false);
    } else if (action === "reset" && window.confirm(t("quota.resetConfirm"))) {
      resetQuotaWindow();
    }
  });

  enableQuotaReminderDrag(element);
  return element;
};

const updateQuotaReminder = () => {
  const config = getQuotaConfig();
  let element = getQuotaReminder();
  if (!config.quotaEnabled || !quotaState.visible) {
    if (element) {
      element.remove();
    }
    return;
  }
  if (!element) {
    renderQuotaReminder();
    element = getQuotaReminder();
  }
  if (!(element instanceof HTMLElement)) {
    return;
  }

  rollQuotaWindowIfExpired();
  const stats = getQuotaStats();
  const tone = stats.danger ? "danger" : stats.warning ? "warning" : "ok";
  element.dataset.tone = tone;
  element.classList.toggle("is-minimized", quotaState.minimized);
  element.style.setProperty("--quota-percentage", `${stats.usedPercent}%`);
  element.setAttribute("aria-label", t("quota.title"));

  const main = element.querySelector(".chatgpt-toolkit-quota-main");
  const meta = element.querySelector(".chatgpt-toolkit-quota-meta");
  const notice = element.querySelector(".chatgpt-toolkit-quota-notice");
  const mini = element.querySelector(".chatgpt-toolkit-quota-mini");
  const title = element.querySelector(".chatgpt-toolkit-quota-title");

  if (title instanceof HTMLElement) {
    title.textContent = t("quota.title");
  }
  if (main instanceof HTMLElement) {
    main.textContent = t("quota.used", { used: stats.used, total: stats.maxMessages });
  }
  if (meta instanceof HTMLElement) {
    const resetText = stats.resetInMs > 0
      ? t("quota.resetIn", { time: formatQuotaDuration(stats.resetInMs) })
      : t("quota.resetSoon");
    meta.innerHTML = `
      <span>${t("quota.remaining", { count: stats.remaining })}</span>
      <span>${t("quota.estimatedUsage", { rate: stats.rate.toFixed(1) })}</span>
      <span>${resetText}${formatQuotaResetClock(stats.resetAt) ? ` (${formatQuotaResetClock(stats.resetAt)})` : ""}</span>
    `;
  }
  if (notice instanceof HTMLElement) {
    notice.textContent = stats.danger
      ? t("quota.warningReached")
      : stats.warning
        ? t("quota.warningApproaching")
        : getQuotaEstimateNotice(stats);
  }
  if (mini instanceof HTMLElement) {
    mini.textContent = `${stats.used}/${stats.maxMessages}`;
    mini.setAttribute("title", t("quota.expand"));
  }
};

const renderQuotaReminder = () => {
  if (!document.body || getQuotaReminder()) {
    return;
  }
  const config = getQuotaConfig();
  if (!config.quotaEnabled || !quotaState.visible) {
    return;
  }
  const element = buildQuotaReminder();
  document.body.appendChild(element);
  applyQuotaReminderPosition(element);
  syncToolkitTheme();
  updateQuotaReminder();
};

const setQuotaReminderVisible = (visible) => {
  quotaState.visible = !!visible;
  saveQuotaUiState(quotaState);
  if (quotaState.visible) {
    renderQuotaReminder();
  } else {
    getQuotaReminder()?.remove();
  }
  if (typeof updateQuotaToggleButton === "function") {
    updateQuotaToggleButton();
  }
};

const toggleQuotaReminder = () => {
  setQuotaReminderVisible(!quotaState.visible);
};

const refreshQuotaReminderLocalization = () => {
  const element = getQuotaReminder();
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.querySelector('[data-quota-action="reset"]')?.setAttribute("title", t("quota.reset"));
  element.querySelector('[data-quota-action="minimize"]')?.setAttribute("title", t("quota.minimize"));
  element.querySelector('[data-quota-action="close"]')?.setAttribute("title", t("quota.close"));
  updateQuotaReminder();
};

const onQuotaConfigChanged = () => {
  const bucket = getOrCreateQuotaBucket();
  bucket.planKey = getQuotaConfig().quotaPlanPreset;
  persistQuotaSnapshot();
  updateQuotaReminder();
  if (typeof updateQuotaToggleButton === "function") {
    updateQuotaToggleButton();
  }
};

const enableQuotaReminderDrag = (element) => {
  if (!(element instanceof HTMLElement) || element.dataset.dragEnabled === "1") {
    return;
  }
  element.dataset.dragEnabled = "1";

  let pointerDown = false;
  let moved = false;
  let suppressClick = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let pendingLeft = 0;
  let pendingTop = 0;
  let width = 240;
  let height = 120;
  const dragController = createRafDragController(({ translateX, translateY }) => {
    applyDragTransform(element, translateX, translateY);
  });

  const onPointerMove = (event) => {
    if (!pointerDown) {
      return;
    }
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!moved) {
      if (deltaX * deltaX + deltaY * deltaY < QUOTA_DRAG_THRESHOLD * QUOTA_DRAG_THRESHOLD) {
        return;
      }
      moved = true;
      suppressClick = true;
      quotaState.dragging = true;
      element.classList.add("is-dragging");
      element.style.willChange = "transform";
      document.documentElement.style.userSelect = "none";
    }

    const next = clampFloatingButtonPosition(startLeft + deltaX, startTop + deltaY, width, height);
    pendingLeft = next.left;
    pendingTop = next.top;
    dragController.schedule({
      translateX: next.left - startLeft,
      translateY: next.top - startTop,
    });
  };

  const onPointerUp = () => {
    if (!pointerDown) {
      return;
    }
    pointerDown = false;
    quotaState.pointerDown = false;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    dragController.cancel();
    resetDragTransform(element);
    element.classList.remove("is-dragging");
    element.style.willChange = "";
    document.documentElement.style.userSelect = "";

    if (moved) {
      quotaState.position = { left: Math.round(pendingLeft), top: Math.round(pendingTop) };
      saveQuotaPosition(quotaState.position);
      applyQuotaReminderPosition(element);
    }

    quotaState.dragging = false;
    setTimeout(() => {
      moved = false;
      suppressClick = false;
    }, 0);
  };

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    const dragHandle =
      target instanceof Element
        ? target.closest(".chatgpt-toolkit-quota-header, .chatgpt-toolkit-quota-mini")
        : null;
    if (!dragHandle || target.closest?.("button[data-quota-action]")) {
      return;
    }
    event.preventDefault();
    pointerDown = true;
    quotaState.pointerDown = true;
    moved = false;
    const rect = element.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    pendingLeft = startLeft;
    pendingTop = startTop;
    width = rect.width || element.offsetWidth || 240;
    height = rect.height || element.offsetHeight || 120;
    startX = event.clientX;
    startY = event.clientY;
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  });

  element.addEventListener("click", (event) => {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }
  }, true);
};

const initQuotaReminder = () => {
  if (quotaState.initialized) {
    updateQuotaReminder();
    return;
  }
  quotaState.initialized = true;
  quotaState.snapshot = loadQuotaSnapshot();
  quotaState.position = loadQuotaPosition();
  const uiState = loadQuotaUiState();
  quotaState.visible = uiState.visible;
  quotaState.minimized = uiState.minimized;
  getOrCreateQuotaBucket();

  window.addEventListener("chatgpt-toolkit-quota-message-sent", (event) => {
    incrementQuotaUsage(event.detail || {});
  });
  window.addEventListener("resize", () => {
    const element = getQuotaReminder();
    if (element instanceof HTMLElement && !quotaState.dragging) {
      applyQuotaReminderPosition(element);
    }
  });

  quotaState.refreshTimer = window.setInterval(() => {
    rollQuotaWindowIfExpired();
    updateQuotaReminder();
  }, QUOTA_REFRESH_INTERVAL_MS);
  quotaState.noticeScanTimer = window.setInterval(scanOfficialQuotaNotice, QUOTA_NOTICE_SCAN_INTERVAL_MS);

  renderQuotaReminder();
  scanOfficialQuotaNotice();
  if (typeof updateQuotaToggleButton === "function") {
    updateQuotaToggleButton();
  }
};
