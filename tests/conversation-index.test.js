const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "features", "conversation-index.js"),
  "utf8",
);

// The index is tested against a stubbed transport: what matters here is that a
// failed or truncated refresh never loses the messages we already know about.
const createFixture = () => {
  class ExportApiError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = "ExportApiError";
      this.code = code;
      this.status = options.status || 0;
      this.fallbackAllowed = options.fallbackAllowed !== false;
    }
  }

  let conversationIds = ["conv-1"];

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
      const path = [];
      const seen = new Set();
      let cursor = currentNodeId;
      while (cursor && mapping[cursor] && !seen.has(cursor)) {
        seen.add(cursor);
        path.push(mapping[cursor]);
        cursor = mapping[cursor].parent;
      }
      return path.reverse();
    },
    resolveConversationTitleFromApi: (data) => data?.title || "",
    isCompleteConversationMapping: () => true,
    assessConversationCompleteness: (data) => ({
      chainComplete: true,
      paginated: false,
      paginationComplete: true,
      complete: data?.partial !== true,
      pageCount: 0,
    }),
    getStrictConversationIdCandidates: () => conversationIds,
    fetchConversationByIdCandidates: async () => {
      throw new ExportApiError("UNSET", "fetch stub not configured", { fallbackAllowed: true });
    },
    getCapturedConversationApiResponse: () => null,
    isConversationAccessBlocked: () => false,
    clearConversationAccessBlock: () => {},
    scheduleTimelineRefresh: () => {},
    timelineState: { visible: true },
    conversationIndexState,
    window: { addEventListener: () => {} },
    setTimeout,
    clearTimeout,
    console,
  };

  vm.runInNewContext(
    `${source}
globalThis.indexTest = {
  loadConversationIndex,
  getReadyConversationIndex,
  getFreshConversationIndex,
  isConversationIndexStale,
  canLoadConversationIndex,
  mergeConversationIndexMessageLists,
  buildConversationIndexFromApiResponse,
  setConversationIndexFailed,
  indexConversationMessages,
  mergeIndexFromCapturedResponse,
  applyConversationIndex,
  isConversationIndexRefreshing,
};`,
    sandbox,
  );

  sandbox.indexTest.setFetch = (impl) => {
    sandbox.fetchConversationByIdCandidates = impl;
  };
  sandbox.indexTest.state = conversationIndexState;
  sandbox.indexTest.setConversationIds = (ids) => {
    conversationIds = ids;
  };
  return sandbox.indexTest;
};

const buildMapping = (count, { prefix = "m", roles } = {}) => {
  const mapping = {};
  let parent = null;
  for (let i = 1; i <= count; i += 1) {
    const id = `${prefix}${i}`;
    mapping[id] = {
      id,
      parent,
      message: {
        id,
        author: { role: roles ? roles(i) : i % 2 === 1 ? "user" : "assistant" },
        content: { parts: [`message ${id}`] },
      },
    };
    parent = id;
  }
  return mapping;
};

const buildResponse = (mapping, currentNodeId) => ({
  data: { mapping, current_node: currentNodeId, title: "Fixture" },
  conversationId: "conv-1",
  completeness: {
    chainComplete: true,
    paginated: false,
    paginationComplete: true,
    complete: true,
    pageCount: 0,
  },
});

const seedPartial = (fixture, count = 3) => {
  const data = { ...buildResponse(buildMapping(count), `m${count}`).data, partial: true };
  fixture.mergeIndexFromCapturedResponse({ data, conversationId: "conv-1" });
  return data;
};

test("a ready partial capture triggers one complete read and shares its pending task", async () => {
  const fixture = createFixture();
  const partial = seedPartial(fixture);
  let resolveRead, started, calls = 0;
  const ready = new Promise((resolve) => { started = resolve; });
  fixture.setFetch(() => {
    calls++;
    started();
    return new Promise((resolve) => { resolveRead = resolve; });
  });
  const pending = fixture.loadConversationIndex();
  await ready;
  assert.equal(fixture.isConversationIndexRefreshing(), true);
  const shared = fixture.loadConversationIndex();
  const token = fixture.state.activeToken;
  fixture.mergeIndexFromCapturedResponse({ data: partial, conversationId: "conv-1" });
  assert.equal(fixture.state.activeToken, token);
  assert.equal(fixture.isConversationIndexRefreshing(), true);
  resolveRead(buildResponse(buildMapping(47), "m47"));
  await Promise.all([pending, shared]);
  assert.equal(calls, 1);
  assert.equal(fixture.state.messages.length, 47);
  assert.equal(fixture.state.completeness.complete, true);
  assert.equal(fixture.isConversationIndexRefreshing(), false);
});

test("partial capture cannot downgrade a complete same-branch index", async () => {
  const fixture = createFixture();
  fixture.setFetch(async () => buildResponse(buildMapping(47), "m47"));
  await fixture.loadConversationIndex();
  const mapping = buildMapping(47);
  const partial = { mapping: { m47: { ...mapping.m47, parent: null } }, current_node: "m47", partial: true };
  fixture.mergeIndexFromCapturedResponse({ data: partial, conversationId: "conv-1" });
  assert.equal(fixture.state.completeness.complete, true);
  assert.equal(fixture.state.messages.length, 47);
});

test("failed partial completion does not poll, but explicit retry reads the network", async () => {
  const fixture = createFixture();
  seedPartial(fixture);
  let calls = 0;
  fixture.setFetch(async () => { calls++; throw new Error("offline"); });
  await assert.rejects(fixture.loadConversationIndex());
  await fixture.loadConversationIndex();
  await fixture.loadConversationIndex();
  assert.equal(calls, 1);
  assert.equal(fixture.state.messages.length, 3);
  fixture.setFetch(async (_, options) => {
    assert.equal(options.skipCaptured, true);
    return buildResponse(buildMapping(47), "m47");
  });
  await fixture.loadConversationIndex({ force: true });
  assert.equal(fixture.state.messages.length, 47);
});

test("a stale in-memory index receives one background refresh", async () => {
  const fixture = createFixture();
  fixture.applyConversationIndex(fixture.buildConversationIndexFromApiResponse(buildResponse(buildMapping(47), "m47").data));
  fixture.state.status = "stale";
  let calls = 0;
  fixture.setFetch(async () => { calls++; return buildResponse(buildMapping(48), "m48"); });
  await fixture.loadConversationIndex();
  assert.equal(calls, 1);
  assert.equal(fixture.state.messages.length, 48);
});

test("a failed refresh keeps the previously loaded 47-message index", async () => {
  const fixture = createFixture();
  const mapping = buildMapping(47);

  fixture.setFetch(async () => buildResponse(mapping, "m47"));
  await fixture.loadConversationIndex();
  assert.equal(fixture.state.messages.length, 47);
  assert.equal(fixture.state.status, "ready");

  // The real machine saw HTTP 403 while reading the session.
  fixture.setFetch(async () => {
    const error = new Error("blocked");
    error.code = "ACCESS_BLOCKED";
    error.fallbackAllowed = false;
    throw error;
  });
  await assert.rejects(() => fixture.loadConversationIndex({ force: true }));

  assert.equal(fixture.state.status, "stale");
  assert.equal(fixture.state.messages.length, 47);
  assert.equal(fixture.state.loadedAt > 0, true);
  assert.notEqual(fixture.getReadyConversationIndex(), null);
  assert.equal(fixture.getFreshConversationIndex(), null);
  assert.equal(fixture.isConversationIndexStale(), true);
});

test("a truncated refresh merges by message id and keeps unmounted messages", async () => {
  const fixture = createFixture();
  const mapping = buildMapping(47);
  fixture.setFetch(async () => buildResponse(mapping, "m47"));
  await fixture.loadConversationIndex();

  // The page only mounts the last six turns; the API response mirrors that.
  const shortMapping = {};
  for (let i = 42; i <= 47; i += 1) {
    shortMapping[`m${i}`] = mapping[`m${i}`];
  }
  fixture.setFetch(async () =>
    buildResponse(shortMapping, "m47"),
  );
  await fixture.loadConversationIndex({ force: true });

  assert.equal(fixture.state.messages.length, 47);
  // Built across the vm realm boundary, so compare joined ids rather than arrays.
  assert.equal(
    Array.from(fixture.state.messages, (message) => message.messageId).join(","),
    Array.from({ length: 47 }, (_, index) => `m${index + 1}`).join(","),
  );
  const ids = new Set(fixture.state.messages.map((message) => message.messageId));
  assert.equal(ids.size, 47);
});

test("an unverified branch never replaces the verified index", async () => {
  const fixture = createFixture();
  const mapping = buildMapping(47);
  fixture.setFetch(async () => buildResponse(mapping, "m47"));
  await fixture.loadConversationIndex();
  assert.equal(fixture.state.branchId, "m47");

  // A different branch (edit) plus an incomplete response: keep what was verified.
  const branchMapping = {
    "b1": { id: "b1", parent: null, message: { id: "b1", author: { role: "user" }, content: { parts: ["edited"] } } },
    "b2": { id: "b2", parent: "b1", message: { id: "b2", author: { role: "assistant" }, content: { parts: ["answer"] } } },
  };
  fixture.setFetch(async () => ({
    data: { mapping: branchMapping, current_node: "b2", title: "Fixture" },
    conversationId: "conv-1",
    completeness: {
      chainComplete: true,
      paginated: true,
      paginationComplete: false,
      complete: false,
      pageCount: 1,
    },
  }));
  await fixture.loadConversationIndex({ force: true });

  assert.equal(fixture.state.messages.length, 47);
  assert.equal(fixture.state.branchId, "m47");
  assert.equal(fixture.state.status, "stale");
  assert.equal(
    fixture.state.warnings.includes("conversation_branch_unverified"),
    true,
  );
});

test("an index filed under the conversation uuid survives a head-id change", async () => {
  const fixture = createFixture();
  fixture.setConversationIds(["proj-1", "conv-1"]);
  fixture.setFetch(async () => buildResponse(buildMapping(47), "m47"));
  await fixture.loadConversationIndex();
  assert.equal(fixture.state.conversationId, "conv-1");
  assert.equal(fixture.getReadyConversationIndex() !== null, true);

  // Project pages expose the project id first once the thread is mounted; the
  // index filed under the uuid must not be discarded because of the order.
  fixture.setConversationIds(["conv-1", "proj-1"]);
  assert.equal(fixture.getReadyConversationIndex() !== null, true);

  fixture.setConversationIds(["proj-1", "conv-1"]);
  assert.equal(fixture.getReadyConversationIndex() !== null, true);
});

test("switching conversations never relabels the previous index", async () => {
  const fixture = createFixture();
  fixture.setFetch(async () => buildResponse(buildMapping(47), "m47"));
  await fixture.loadConversationIndex();
  assert.equal(fixture.state.messages.length, 47);

  // A different conversation whose read fails must not inherit 47 turns.
  fixture.setConversationIds(["conv-2"]);
  fixture.setFetch(async () => {
    const error = new Error("blocked");
    error.code = "ACCESS_BLOCKED";
    error.fallbackAllowed = false;
    throw error;
  });
  await assert.rejects(() => fixture.loadConversationIndex({ force: true }));

  assert.equal(fixture.state.conversationId, "conv-2");
  assert.equal(fixture.state.messages.length, 0);
  assert.equal(fixture.state.status, "failed");
  assert.equal(fixture.getReadyConversationIndex(), null);
});

test("a verified edited branch drops the abandoned branch tail", async () => {
  const fixture = createFixture();
  fixture.setFetch(async () => buildResponse(buildMapping(47), "m47"));
  await fixture.loadConversationIndex();
  const mapping = buildMapping(3);
  mapping.edit = { id: "edit", parent: "m3", message: { id: "edit", author: { role: "user" } } };
  fixture.setFetch(async () => buildResponse(mapping, "edit"));
  await fixture.loadConversationIndex({ force: true });
  assert.equal(fixture.state.messages.map((message) => message.messageId).join(","), "m1,m2,m3,edit");
});

test("a response from the old route cannot populate the newly opened conversation", async () => {
  const fixture = createFixture();
  let release, started;
  const ready = new Promise((resolve) => { started = resolve; });
  fixture.setFetch(() => { started(); return new Promise((resolve) => { release = resolve; }); });
  const pending = fixture.loadConversationIndex();
  await ready;
  fixture.setConversationIds(["conv-2"]);
  release(buildResponse(buildMapping(47), "m47"));
  await pending;
  assert.equal(fixture.getReadyConversationIndex(), null);
  assert.equal(fixture.state.messages.length, 0);
});
