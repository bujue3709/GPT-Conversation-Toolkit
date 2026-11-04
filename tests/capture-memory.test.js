const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "features", name), "utf8");

test("capture cache evicts both indexes by count and retained size; misses never return another conversation", () => {
  const listeners = {};
  const window = {
    location: {
      href: "https://chatgpt.com/c/fixture-000",
      pathname: "/c/fixture-000",
    },
    addEventListener: (name, fn) => (listeners[name] = fn),
    dispatchEvent() {},
  };
  vm.runInNewContext(source("conversation-capture-bridge.js"), {
    window,
    URL,
    CustomEvent: class {},
  });
  for (let i = 0; i < 50; i++) {
    const id = `fixture-${String(i).padStart(3, "0")}`;
    listeners.message({
      source: window,
      data: {
        source: "chatgpt-toolkit-conversation-capture",
        type: "conversation",
        data: { conversation_id: id, mapping: { message: "x".repeat(600000) } },
        url: `https://chatgpt.com/backend-api/conversation/${id}`,
      },
    });
  }
  const cache = window.__chatgptConversationToolkitConversationCache;
  assert(cache.items.length <= 20);
  assert.equal(Object.keys(cache.byId).length, cache.items.length);
  assert(
    cache.items.reduce((sum, item) => sum + item.estimatedBytes, 0) <=
      32 * 1024 * 1024,
  );
  assert.equal(
    window.getCapturedConversationApiResponse(["fixture-000"]),
    null,
  );
  assert.equal(
    window.getCapturedConversationApiResponse(["fixture-049"]).conversationId,
    "fixture-049",
  );
});

async function capture(response, url) {
  const posted = [];
  let clones = 0;
  const originalClone = response.clone.bind(response);
  response.clone = () => {
    clones++;
    return originalClone();
  };
  const window = {
    location: {
      href: "https://chatgpt.com/c/fixture-001",
      origin: "https://chatgpt.com",
    },
    fetch: async () => response,
    postMessage: (data) => posted.push(data),
  };
  vm.runInNewContext(source("conversation-capture-page.js"), {
    window,
    URL,
    TextDecoder,
  });
  const result = await window.fetch(url);
  const text = await result.text();
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { posted, clones, text };
}

test("SSE and unrelated JSON responses are never cloned", async () => {
  const stream = await capture(
    new Response("data: fixture\n\n", {
      headers: { "content-type": "text/event-stream" },
    }),
    "/backend-api/conversation",
  );
  assert.equal(stream.clones, 0);
  assert.equal(stream.text, "data: fixture\n\n");
  const unrelated = await capture(
    new Response("{}", { headers: { "content-type": "application/json" } }),
    "/backend-api/accounts",
  );
  assert.equal(unrelated.clones, 0);
});

test("JSON conversation capture preserves the original response", async () => {
  const text = JSON.stringify({
    conversation_id: "fixture-001",
    mapping: { a: { message: "fixture" } },
  });
  const result = await capture(
    new Response(text, { headers: { "content-type": "application/json" } }),
    "/backend-api/conversation/fixture-001",
  );
  assert.equal(result.clones, 1);
  assert.equal(result.posted.length, 1);
  assert.equal(result.text, text);
});

test("oversized chunked capture stops before JSON parse and leaves ChatGPT's stream readable", async () => {
  const text = "x".repeat(21 * 1024 * 1024);
  const result = await capture(
    new Response(text, { headers: { "content-type": "application/json" } }),
    "/backend-api/conversation/fixture-001",
  );
  assert.equal(result.clones, 1);
  assert.equal(result.posted.length, 0);
  assert.equal(result.text.length, text.length);
});
