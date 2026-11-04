const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "features", "conversation-index.js"),
  "utf8",
);

/*
 * The stored index is what keeps a 403 from erasing history that was already
 * obtained. These tests use an in-memory stand-in for chrome.storage.local and
 * assert the two invariants: a restored index is always "stale", and a blocked
 * conversation is answered from storage without starting a request.
 */
const createFixture = ({ stored = null, blocked = false } = {}) => {
  class ExportApiError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = "ExportApiError";
      this.code = code;
      this.status = options.status || 0;
      this.fallbackAllowed = options.fallbackAllowed !== false;
    }
  }

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
    updatedAt: 0,
    failedAt: 0,
    completeness: null,
    branchId: "",
    dataSource: "",
    warnings: [],
    error: null,
  };

  const writes = [];
  const storageArea = {
    get: (keys, callback) => {
      const key = Array.isArray(keys) ? keys[0] : keys;
      callback({ [key]: stored });
    },
    set: (payload, callback) => {
      writes.push(payload);
      if (typeof callback === "function") callback();
    },
  };

  const timers = [];
  let fetchCalls = 0;

  const sandbox = {
    ExportApiError,
    AbortController,
    normalizeExportApiError: (error) => ({
      code: error?.code || "UNKNOWN",
      message: error?.message || "",
    }),
    normalizeApiMessage: (node) => node,
    normalizeExportMessageText: (value) => (typeof value === "string" ? value.trim() : ""),
    normalizeExportMarkdownText: (value) => (typeof value === "string" ? value.trim() : ""),
    uniqueExportWarnings: (warnings) => [...new Set(warnings.filter(Boolean))],
    getApiMapping: (data) => data?.mapping || null,
    resolveApiCurrentNodeId: (data) => data?.current_node || "",
    buildActiveApiNodePath: (mapping, currentNodeId) => {
      const activePath = [];
      const seen = new Set();
      let cursor = currentNodeId;
      while (cursor && mapping[cursor] && !seen.has(cursor)) {
        seen.add(cursor);
        activePath.push(mapping[cursor]);
        cursor = mapping[cursor].parent;
      }
      return activePath.reverse();
    },
    resolveConversationTitleFromApi: (data) => data?.title || "",
    isCompleteConversationMapping: () => true,
    assessConversationCompleteness: () => ({
      chainComplete: true,
      paginated: false,
      paginationComplete: true,
      complete: true,
      pageCount: 0,
    }),
    getStrictConversationIdCandidates: () => ["conv-1"],
    fetchConversationByIdCandidates: async () => {
      fetchCalls += 1;
      throw new ExportApiError("UNSET", "fetch stub not configured", { fallbackAllowed: true });
    },
    getCapturedConversationApiResponse: () => null,
    isConversationAccessBlocked: () => blocked,
    clearConversationAccessBlock: () => {},
    getExtensionStorageArea: () => storageArea,
    scheduleTimelineRefresh: () => {},
    timelineState: { visible: true },
    conversationIndexState,
    window: { addEventListener: () => {} },
    setTimeout: (handler, delay) => {
      timers.push({ handler, delay });
      return timers.length;
    },
    clearTimeout: () => {},
    console,
  };

  vm.runInNewContext(
    `${source}
globalThis.cacheTest = {
  loadConversationIndex,
  getReadyConversationIndex,
  ensureConversationIndexRestored,
  restoreConversationIndexFromCache,
  saveConversationIndexToCache,
  applyConversationIndex,
  buildConversationIndexFromApiResponse,
  getCurrentConversationIndexId,
};`,
    sandbox,
  );

  sandbox.cacheTest.setFetch = (impl) => {
    sandbox.fetchConversationByIdCandidates = impl;
  };
  sandbox.cacheTest.state = conversationIndexState;
  sandbox.cacheTest.writes = writes;
  sandbox.cacheTest.fetchCalls = () => fetchCalls;
  return sandbox.cacheTest;
};

const buildMapping = (count, { prefix = "m" } = {}) => {
  const mapping = {};
  let parent = null;
  for (let index = 1; index <= count; index += 1) {
    const id = `${prefix}${index}`;
    mapping[id] = {
      id,
      parent,
      message: {
        id,
        author: { role: index % 2 === 1 ? "user" : "assistant" },
        content: { parts: [`message ${id}`] },
      },
    };
    parent = id;
  }
  return mapping;
};

const buildStoredEntry = (count) => {
  const messages = [];
  for (let index = 1; index <= count; index += 1) {
    const id = `m${index}`;
    messages.push({
      key: `api:${id}`,
      messageId: id,
      parentId: index === 1 ? null : `m${index - 1}`,
      role: index % 2 === 1 ? "user" : "assistant",
      index,
      userOrder: index % 2 === 1 ? Math.ceil(index / 2) : null,
      text: `message ${id}`,
      markdown: `message ${id}`,
      previewText: `message ${id}`,
      createTime: 0,
      updateTime: 0,
      status: "finished_successfully",
      model: "",
      attachments: [],
      parts: [],
      metadata: {},
      images: [],
      source: "api",
    });
  }
  return {
    conversationId: "conv-1",
    title: "Stored conversation",
    savedAt: 1700000000000,
    loadedAt: 1600000000000,
    updatedAt: 1600000000000,
    completeness: { chainComplete: true, paginated: false, paginationComplete: true, complete: true },
    branchId: `m${count}`,
    dataSource: "conversation-api",
    warnings: [],
    messages,
  };
};

test("a stored index is restored as stale after a reload", async () => {
  const fixture = createFixture({ stored: { schema: 2, byId: { "conv-1": buildStoredEntry(47) } } });

  const restored = await fixture.ensureConversationIndexRestored();

  assert.equal(restored.messages.length, 47);
  assert.equal(fixture.state.status, "stale");
  assert.equal(fixture.state.dataSource, "storage-cache");
  assert.equal(fixture.state.branchId, "m47");
  assert.equal(fixture.state.updatedAt, 1600000000000);
  assert.ok(fixture.state.warnings.includes("conversation_index_from_storage"));
  assert.notEqual(fixture.getReadyConversationIndex(), null);
  assert.equal(fixture.fetchCalls(), 0);
});

test("a blocked conversation is answered from storage without a request", async () => {
  const fixture = createFixture({
    stored: { schema: 2, byId: { "conv-1": buildStoredEntry(47) } },
    blocked: true,
  });

  const index = await fixture.loadConversationIndex();

  assert.equal(index.messages.length, 47);
  assert.equal(fixture.state.status, "stale");
  assert.equal(fixture.fetchCalls(), 0);
});

test("a completed read is written to storage with every message", async () => {
  const fixture = createFixture();
  fixture.setFetch(async () => ({
    data: { mapping: buildMapping(47), current_node: "m47", title: "Fixture" },
    conversationId: "conv-1",
    completeness: {
      chainComplete: true,
      paginated: false,
      paginationComplete: true,
      complete: true,
      pageCount: 0,
    },
  }));

  await fixture.loadConversationIndex();
  assert.equal(fixture.state.messages.length, 47);

  const saved = await fixture.saveConversationIndexToCache();
  assert.equal(saved, true);
  assert.equal(fixture.writes.length, 1);

  const payload = fixture.writes[0].conversationIndexCache;
  assert.equal(payload.schema, 2);
  const entry = payload.byId["conv-1"];
  assert.equal(entry.messages.length, 47);
  assert.equal(entry.branchId, "m47");
  assert.equal(entry.messages[0].messageId, "m1");
  assert.equal(entry.messages[46].messageId, "m47");
  // Only the branch itself is stored, never the title's account context.
  assert.equal(Object.keys(entry).includes("byMessageId"), false);
});