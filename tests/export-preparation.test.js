const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "features", "export.js"),
  "utf8",
);

class ExportApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ExportApiError";
    this.code = code;
    this.status = options.status || 0;
    this.fallbackAllowed = options.fallbackAllowed !== false;
  }
}

const createFixture = ({ cachedIndex = null, fetchError = null, data = null } = {}) => {
  const statuses = [];
  const sandbox = {
    ExportApiError,
    console,
    setTimeout,
    clearTimeout,
    t: (key) => key,
    status: {},
    getStrictConversationIdCandidates: () => ["conv-1"],
    fetchConversationByIdCandidates: async () => {
      if (fetchError) throw fetchError;
      return { data, conversationId: "conv-1", captured: false };
    },
    normalizeConversationApiResponse: (payload, options) => ({
      messages: [{ id: "m1", role: "user", text: "hello" }],
      conversationId: options.conversationId,
      completeness: options.completeness?.complete === false ? "partial" : "complete",
    }),
    normalizeExportApiError: (error) => error,
    getReadyConversationIndex: () => cachedIndex,
    buildConversationExportPayloadFromIndex: (index, options) => ({
      messages: index.messages,
      completeness: "complete",
      source: "conversation-index",
      apiError: options.apiError || null,
      indexMessages: index.messages.length,
    }),
    collectMessagesFromDomFallback: ({ apiError }) => ({
      messages: [{ id: "dom1", role: "user" }],
      completeness: "partial",
      apiError,
    }),
    updateStatusByKey: (key, tone) => statuses.push({ key, tone }),
    applyExportSelection: (payload) => payload,
    downloadConversationExport: () => {},
    exportConversationPng: async () => {},
    exportConversationImageArchive: async () => {},
    setExportSelectionImageProgress: () => {},
    updateExportSelectionProgress: () => {},
    saveToolkitConfig: () => {},
    getPngExportFailureStatusKey: () => "status.exportFailed",
    TOOLKIT_EXPORT_IMAGES: false,
    TOOLKIT_EXPORT_FORMAT: "json",
    TOOLKIT_EXPORT_FORMAT_PNG: "png",
    document: {},
    window: { location: { href: "https://chatgpt.com/c/conv-1" } },
    AbortController,
  };

  vm.runInNewContext(
    `${source}
globalThis.exportTest = { prepareConversationExportPayload, exportMessages };`,
    sandbox,
  );

  sandbox.exportTest.statuses = statuses;
  return sandbox.exportTest;
};

test("API success is used directly", async () => {
  const api = createFixture({ data: { mapping: {}, current_node: "x" } });
  const result = await api.prepareConversationExportPayload();
  assert.equal(result.usedFallback, false);
  assert.equal(result.fromCache, false);
  assert.equal(result.requiresPartialConsent, false);
  assert.equal(result.payload.completeness, "complete");
});

test("403 with a complete cached index still exports, and says it is cached", async () => {
  const api = createFixture({
    fetchError: new ExportApiError("ACCESS_BLOCKED", "blocked", {
      status: 403,
      fallbackAllowed: false,
    }),
    cachedIndex: {
      status: "stale",
      updatedAt: 1700000000000,
      dataSource: "captured-page-response",
      messages: [
        { id: "m1", role: "user", text: "a" },
        { id: "m2", role: "assistant", text: "b" },
      ],
    },
  });

  const result = await api.prepareConversationExportPayload();
  assert.equal(result.usedFallback, false);
  assert.equal(result.fromCache, true);
  assert.equal(result.requiresPartialConsent, false);
  assert.equal(result.apiError.code, "ACCESS_BLOCKED");
  assert.equal(result.payload.messages.length, 2);
  assert.equal(result.payload.indexUpdatedAt, 1700000000000);
  assert.equal(result.payload.indexStatus, "stale");
  assert.equal(
    api.statuses.some((entry) => entry.key === "status.exportCacheUsed"),
    true,
  );
});

test("403 without a cache asks before exporting the loaded part", async () => {
  const api = createFixture({
    fetchError: new ExportApiError("ACCESS_BLOCKED", "blocked", {
      status: 403,
      fallbackAllowed: false,
    }),
  });

  const result = await api.prepareConversationExportPayload();
  assert.equal(result.payload, null);
  assert.equal(result.requiresPartialConsent, true);
  assert.equal(result.usedFallback, false);
  assert.equal(result.apiError.code, "ACCESS_BLOCKED");
  assert.equal(
    api.statuses.some((entry) => entry.key === "status.exportNeedsConsent"),
    true,
  );

  // Only an explicit choice produces a partial export.
  const partial = await api.prepareConversationExportPayload({ allowPartial: true });
  assert.equal(partial.usedFallback, true);
  assert.equal(partial.requiresPartialConsent, false);
  assert.equal(partial.payload.completeness, "partial");
});

test("a cancelled preparation is not converted into a partial export", async () => {
  const api = createFixture({
    fetchError: new ExportApiError("CANCELLED", "cancelled", { fallbackAllowed: false }),
    cachedIndex: null,
  });

  await assert.rejects(() => api.prepareConversationExportPayload(), (error) => {
    assert.equal(error.code, "CANCELLED");
    return true;
  });
});

test("exportMessages refuses to run without a prepared payload", async () => {
  const api = createFixture({
    fetchError: new ExportApiError("ACCESS_BLOCKED", "blocked", {
      status: 403,
      fallbackAllowed: false,
    }),
  });
  const result = await api.exportMessages({});
  assert.equal(result, null);
  assert.equal(
    api.statuses.some((entry) => entry.key === "status.exportNeedsConsent"),
    true,
  );
});