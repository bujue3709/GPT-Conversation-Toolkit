const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const timelineSource = fs.readFileSync(
  path.join(__dirname, "..", "features", "timeline.js"),
  "utf8",
);

// The timeline source builder is extracted instead of loading the whole file:
// everything else in timeline.js only matters once the DOM exists.
const start = timelineSource.indexOf("let timelineSourceCache");
const end = timelineSource.indexOf("const normalizeTimelineText");
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const sourceBlock = timelineSource.slice(start, end);

class FakeNode {
  constructor() {
    this.isConnected = true;
  }
}

const buildIndex = (count, overrides = {}) => {
  const userMessages = [];
  let userOrder = 1;
  for (let i = 1; i <= count; i += 1) {
    const messageId = `u${i}`;
    userMessages.push({
      key: `api:${messageId}`,
      messageId,
      role: "user",
      index: i * 2 - 1,
      userOrder: userOrder++,
      text: `question ${i}`,
      previewText: `question ${i}`,
      node: null,
    });
  }
  return {
    conversationId: "conv-1",
    status: "ready",
    version: 1,
    loadedAt: 1000,
    updatedAt: 1000,
    branchId: "a47",
    completeness: { complete: true, chainComplete: true, paginationComplete: true },
    messages: userMessages,
    userMessages,
    warnings: [],
    ...overrides,
  };
};

const createFixture = ({ index = null, liveIds = [], detachedIds = [], blocked = false, restoring = false, indexStatus = "ready", indexConversationId = "conv-1", indexMessageCount = 0, indexIds = ["conv-1"] } = {}) => {
  const live = liveIds.map((id) => {
    const node = new FakeNode();
    node.messageId = id;
    return { node, role: "user", text: `live ${id}`, order: 1 };
  });
  for (const id of detachedIds) {
    const node = new FakeNode();
    node.messageId = id;
    node.isConnected = false;
    live.push({ node, role: "user", text: `live ${id}`, order: 1 });
  }

  const sandbox = {
    HTMLElement: FakeNode,
    state: { conversationKey: "conv-1", messageCacheRevision: 7 },
    timelineState: {
      visible: false,
      countPartial: false,
      countStale: false,
      indexUpdatedAt: 0,
      indexBlocked: false,
      branchDiverged: false,
    },
    TOOLKIT_MESSAGE_MODE_LOADED: "loaded",
    getReadyConversationIndex: () => index,
    getConversationMessageEntries: () => live,
    getDomMessageIdCandidates: (node) => (node?.messageId ? [node.messageId] : []),
    canLoadConversationIndex: () => !blocked,
    loadConversationIndex: async () => index,
    scheduleTimelineRefresh: () => {},
    conversationIndexState: {
      status: indexStatus,
      conversationId: indexConversationId,
      messages: Array.from({ length: indexMessageCount }, (_, index) => ({ messageId: `old${index + 1}` })),
    },
    getConversationIndexIdCandidates: () => indexIds,
    isConversationIndexRestoring: () => restoring,
    setTimeout: () => 1,
    clearTimeout: () => {},
    Date,
    console,
  };

  vm.runInNewContext(
    `${sourceBlock}
globalThis.timelineTest = { getTimelineSourceNodes };`,
    sandbox,
  );
  return { get: sandbox.timelineTest.getTimelineSourceNodes, state: sandbox.timelineState };
};

test("47 indexed turns survive when only 6 unknown DOM turns are mounted", () => {
  const index = buildIndex(47);
  const fixture = createFixture({
    index,
    liveIds: ["dom-a", "dom-b", "dom-c", "dom-d", "dom-e", "dom-f"],
  });

  const sources = fixture.get();
  assert.equal(sources.length, 47);
  assert.equal(sources[46].messageId, "u47");
  assert.equal(fixture.state.branchDiverged, true);
  assert.equal(fixture.state.countPartial, false, "a complete index is not partial");
  assert.equal(fixture.state.countStale, false);
});

test("mounted nodes attach to the index by message id", () => {
  const index = buildIndex(47);
  const fixture = createFixture({ index, liveIds: ["u10", "u11", "u12"] });

  const sources = fixture.get();
  assert.equal(sources.length, 47);
  const attached = sources.filter((source) => source.liveNode);
  assert.equal(attached.length, 3);
  assert.equal(attached[0].messageId, "u10");
  assert.equal(attached[0].liveNode.messageId, "u10");
  assert.equal(fixture.state.branchDiverged, false);
});

test("a genuinely new trailing turn extends a complete branch", () => {
  const index = buildIndex(47);
  const fixture = createFixture({ index, liveIds: ["u46", "u47", "u48"] });

  const sources = fixture.get();
  assert.equal(sources.length, 48);
  assert.equal(sources[47].messageId, "u48");
  assert.equal(fixture.state.branchDiverged, false);
});

test("an unknown turn in the middle never truncates the index", () => {
  const index = buildIndex(47);
  const fixture = createFixture({ index, liveIds: ["u10", "dom-x", "u12"] });

  const sources = fixture.get();
  assert.equal(sources.length, 47);
  assert.equal(fixture.state.branchDiverged, true);
});

test("a detached node is released while its index entry is kept", () => {
  const index = buildIndex(47);
  const fixture = createFixture({ index, liveIds: ["u10"], detachedIds: ["u11"] });

  const sources = fixture.get();
  assert.equal(sources.length, 47);
  const kept = sources.find((source) => source.messageId === "u11");
  assert.ok(kept, "the unmounted turn stays in the full history");
  assert.equal(kept.node, null);
  assert.equal(kept.liveNode, null);
  const attached = sources.filter((source) => source.liveNode);
  assert.equal(attached.length, 1);
  assert.equal(attached[0].messageId, "u10");
});

test("a stale index still provides the full timeline and reports staleness", () => {
  const index = buildIndex(47, { status: "stale", updatedAt: 4242 });
  const fixture = createFixture({ index, liveIds: ["u47"] });

  const sources = fixture.get();
  assert.equal(sources.length, 47);
  assert.equal(fixture.state.countStale, true);
  assert.equal(fixture.state.indexUpdatedAt, 4242);
});

test("without an index the loaded turns are partial and a refresh is attempted", () => {
  const fixture = createFixture({ index: null, liveIds: ["u1", "u2"] });

  const sources = fixture.get();
  assert.equal(sources.length, 2);
  assert.equal(fixture.state.countPartial, true);
});

test("a blocked conversation is reported as unavailable, not as a full timeline", () => {
  const fixture = createFixture({ index: null, liveIds: ["u1"], blocked: true });

  fixture.get();
  assert.equal(fixture.state.countPartial, true);
  assert.equal(fixture.state.indexBlocked, true);
  // A blocked conversation must not keep a loading placeholder forever.
  assert.equal(fixture.state.countPending, false);
});

test("the first render shows a loading count instead of a partial 5/5+", () => {
  const restoring = createFixture({ index: null, liveIds: ["u1", "u2"], restoring: true });
  restoring.get();
  assert.equal(restoring.state.countPending, true);

  const loading = createFixture({ index: null, liveIds: ["u1"], indexStatus: "loading" });
  loading.get();
  assert.equal(loading.state.countPending, true);

  // Once the index arrives the placeholder must give way to the real count.
  const settled = createFixture({ index: null, liveIds: ["u1"], indexStatus: "failed" });
  settled.get();
  assert.equal(settled.state.countPending, false);

  // Switching conversations leaves the previous conversation's index in memory;
  // for this page that is still "not read yet", not a partial count.
  const switched = createFixture({
    index: null,
    liveIds: ["u1"],
    indexStatus: "ready",
    indexConversationId: "conv-old",
    indexMessageCount: 47,
  });
  switched.get();
  assert.equal(switched.state.countPending, true);
});