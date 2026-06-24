/*
 * ChatGPT Conversation Toolkit - Storage utilities
 */
const getExtensionStorageArea = () =>
  typeof chrome !== "undefined" && chrome?.storage?.local ? chrome.storage.local : null;

const saveMinimizedPosition = (position) => {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch (error) {
    // Ignore storage write failures.
  }
};

const saveTimelineVisibility = (visible) => {
  try {
    localStorage.setItem(TIMELINE_VISIBLE_KEY, visible ? "1" : "0");
  } catch (error) {
    // Ignore storage write failures.
  }
};

const saveTimelinePosition = (position) => {
  try {
    localStorage.setItem(TIMELINE_POSITION_KEY, JSON.stringify(position));
  } catch (error) {
    // Ignore storage write failures.
  }
};

const loadTimelineVisibility = () => {
  try {
    const stored = localStorage.getItem(TIMELINE_VISIBLE_KEY);
    if (stored === null) {
      return false;
    }
    return stored === "1" || stored === "true";
  } catch (error) {
    return false;
  }
};

const saveToolbarMinimizedState = (isMinimized) => {
  try {
    localStorage.setItem(TOOLBAR_MINIMIZED_KEY, isMinimized ? "1" : "0");
  } catch (error) {
    // Ignore storage write failures.
  }
};

const loadToolbarMinimizedState = () => {
  try {
    const stored = localStorage.getItem(TOOLBAR_MINIMIZED_KEY);
    if (stored === null) {
      return false;
    }
    return stored === "1" || stored === "true";
  } catch (error) {
    return false;
  }
};

const loadTimelinePosition = () => {
  try {
    const stored = localStorage.getItem(TIMELINE_POSITION_KEY);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }
    return { left, top };
  } catch (error) {
    return null;
  }
};

const normalizeQuotaSnapshot = (snapshot) => {
  const nextSnapshot =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : {
          version: 1,
          activeBucketKey: "",
          buckets: {},
        };
  const buckets =
    nextSnapshot.buckets && typeof nextSnapshot.buckets === "object"
      ? nextSnapshot.buckets
      : {};
  return {
    version: 1,
    activeBucketKey:
      typeof nextSnapshot.activeBucketKey === "string" ? nextSnapshot.activeBucketKey : "",
    buckets,
  };
};

const saveQuotaSnapshot = (snapshot) => {
  try {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(normalizeQuotaSnapshot(snapshot)));
  } catch (error) {
    // Ignore storage write failures.
  }
};

const loadQuotaSnapshot = () => {
  try {
    const stored = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (!stored) {
      return normalizeQuotaSnapshot(null);
    }
    return normalizeQuotaSnapshot(JSON.parse(stored));
  } catch (error) {
    return normalizeQuotaSnapshot(null);
  }
};

const saveQuotaPosition = (position) => {
  try {
    if (!position) {
      localStorage.removeItem(QUOTA_POSITION_KEY);
      return;
    }
    localStorage.setItem(QUOTA_POSITION_KEY, JSON.stringify(position));
  } catch (error) {
    // Ignore storage write failures.
  }
};

const loadQuotaPosition = () => {
  try {
    const stored = localStorage.getItem(QUOTA_POSITION_KEY);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }
    return { left, top };
  } catch (error) {
    return null;
  }
};

const saveQuotaUiState = (uiState) => {
  try {
    localStorage.setItem(
      QUOTA_UI_STATE_KEY,
      JSON.stringify({
        visible: uiState?.visible !== false,
        minimized: !!uiState?.minimized,
      }),
    );
  } catch (error) {
    // Ignore storage write failures.
  }
};

const loadQuotaUiState = () => {
  try {
    const stored = localStorage.getItem(QUOTA_UI_STATE_KEY);
    if (!stored) {
      return { visible: true, minimized: false };
    }
    const parsed = JSON.parse(stored);
    return {
      visible: parsed?.visible !== false,
      minimized: !!parsed?.minimized,
    };
  } catch (error) {
    return { visible: true, minimized: false };
  }
};

const loadMinimizedPosition = () => {
  const stored = localStorage.getItem(POSITION_KEY);
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored);
  } catch (error) {
    return null;
  }
};

const saveFolderSnapshot = (snapshot) => {
  try {
    localStorage.setItem(FOLDER_LOCAL_FALLBACK_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // Ignore storage write failures.
  }

  const storageArea = getExtensionStorageArea();
  if (!storageArea) {
    return;
  }

  try {
    storageArea.set({ [FOLDER_STORAGE_KEY]: snapshot }, () => {
      void chrome?.runtime?.lastError;
    });
  } catch (error) {
    // Ignore storage write failures.
  }
};

const loadFolderSnapshot = () => {
  try {
    const stored = localStorage.getItem(FOLDER_LOCAL_FALLBACK_KEY);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored);
  } catch (error) {
    return null;
  }
};

const loadFolderSnapshotFromExtension = () =>
  new Promise((resolve) => {
    const storageArea = getExtensionStorageArea();
    if (!storageArea) {
      resolve(null);
      return;
    }

    try {
      storageArea.get([FOLDER_STORAGE_KEY], (result) => {
        if (chrome?.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(result?.[FOLDER_STORAGE_KEY] || null);
      });
    } catch (error) {
      resolve(null);
    }
  });

const saveCollapseMemorySnapshot = (snapshot) => {
  try {
    localStorage.setItem(COLLAPSE_MEMORY_LOCAL_FALLBACK_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // Ignore storage write failures.
  }

  const storageArea = getExtensionStorageArea();
  if (!storageArea) {
    return;
  }

  try {
    storageArea.set({ [COLLAPSE_MEMORY_STORAGE_KEY]: snapshot }, () => {
      void chrome?.runtime?.lastError;
    });
  } catch (error) {
    // Ignore storage write failures.
  }
};

const loadCollapseMemorySnapshot = () => {
  try {
    const stored = localStorage.getItem(COLLAPSE_MEMORY_LOCAL_FALLBACK_KEY);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored);
  } catch (error) {
    return null;
  }
};

const loadCollapseMemorySnapshotFromExtension = () =>
  new Promise((resolve) => {
    const storageArea = getExtensionStorageArea();
    if (!storageArea) {
      resolve(null);
      return;
    }

    try {
      storageArea.get([COLLAPSE_MEMORY_STORAGE_KEY], (result) => {
        if (chrome?.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(result?.[COLLAPSE_MEMORY_STORAGE_KEY] || null);
      });
    } catch (error) {
      resolve(null);
    }
  });


