const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "features", "conversation-api.js"),
  "utf8",
);

const jsonResponse = (data, init = {}) => ({
  ok: init.ok !== false,
  status: init.status || 200,
  headers: { get: (name) => init.headers?.[name.toLowerCase()] ?? null },
  json: async () => data,
});

const createFixture = () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    throw new Error(`unexpected request ${url}`);
  };

  const sandbox = {
    fetch: (url, init) => fetchImpl(url, init),
    window: {
      location: {
        origin: "https://chatgpt.com",
        hostname: "chatgpt.com",
        href: "https://chatgpt.com/c/conv-1",
      },
      addEventListener: () => {},
    },
    document: {},
    setTimeout,
    clearTimeout,
    console,
    AbortController,
    URL,
    Headers,
    t: (key) => key,
    normalizeStrictConversationId: (value) =>
      typeof value === "string" && value.length >= 6 ? value : null,
    getStrictConversationIdCandidates: () => ["conv-1"],
    getCapturedConversationApiResponse: () => null,
  };

  vm.runInNewContext(
    `${source}
globalThis.apiTest = {
  fetchJsonWithTimeout,
  fetchConversationByIdCandidates,
  fetchConversationById,
  assessConversationCompleteness,
  getConversationPageInfo,
  isCompleteConversationMapping,
  isConversationAccessBlocked,
  clearConversationAccessBlock,
  getConversationApiCooldownRemainingMs,
  clearConversationApiCooldown,
  getExportApiDiagnostics,
  getExportApiErrorText,
  getConversationRequestKey,
  parseExportApiRetryAfterMs,
};`,
    sandbox,
  );

  sandbox.apiTest.requests = requests;
  sandbox.apiTest.setFetch = (impl) => {
    sandbox.fetch = async (url, init) => {
      requests.push(String(url));
      return impl(url, init);
    };
  };
  return sandbox.apiTest;
};

const completeMapping = () => ({
  mapping: {
    m1: {
      id: "m1",
      parent: null,
      message: { id: "m1", author: { role: "user" }, content: { parts: ["hello"] } },
    },
    m2: {
      id: "m2",
      parent: "m1",
      message: { id: "m2", author: { role: "assistant" }, content: { parts: ["hi"] } },
    },
  },
  current_node: "m2",
  conversation_id: "conv-1",
});

const sessionResponse = () =>
  jsonResponse({ accessToken: "token-abcdefghijklmnopqrstuvwxyz" });

test("completeness needs paging information, not only a terminating chain", () => {
  const api = createFixture();
  const data = completeMapping();

  assert.equal(api.assessConversationCompleteness(data).complete, true);

  // A paged response that still has older pages must not read as complete.
  const partial = {
    ...data,
    page_info: { has_previous_page: true, start_cursor: "cursor-1" },
  };
  const assessment = api.assessConversationCompleteness(partial);
  assert.equal(assessment.chainComplete, true);
  assert.equal(assessment.paginationComplete, false);
  assert.equal(assessment.complete, false);

  // Same data, but the paginator walked every page: complete again.
  assert.equal(
    api.assessConversationCompleteness(partial, { paginationComplete: true }).complete,
    true,
  );
});

test("a refusing session endpoint falls back to cookie-only conversation reads", async () => {
  const api = createFixture();
  const sent = [];
  api.setFetch(async (url, init) => {
    if (String(url).includes("/api/auth/session")) {
      sent.push({ url: String(url), headers: init?.headers || {} });
      return jsonResponse(null, { ok: false, status: 403 });
    }
    sent.push({ url: String(url), headers: init?.headers || {} });
    return jsonResponse(completeMapping());
  });

  const response = await api.fetchConversationByIdCandidates(["conv-1"]);

  assert.equal(response.data.current_node, "m2");
  const conversationRequest = sent.find((entry) =>
    entry.url.includes("/backend-api/conversation/conv-1"),
  );
  assert.ok(conversationRequest, "the conversation endpoint must still be read");
  // No bearer token was obtained, so the request goes out with cookies only.
  assert.equal(conversationRequest.headers.Authorization, undefined);

  // A refused session endpoint must not be recorded as a conversation block:
  // the page itself keeps working, and so must the timeline and the export.
  assert.equal(api.isConversationAccessBlocked("conv-1"), false);
  const sessionDiagnostic = api
    .getExportApiDiagnostics()
    .find((entry) => entry.category === "session");
  assert.equal(sessionDiagnostic.status, 403);
  api.clearConversationAccessBlock();
});

test("a refused include_full_conversation variant cannot block the plain endpoint", async () => {
  const api = createFixture();
  const sent = [];
  api.setFetch(async (url) => {
    const target = String(url);
    sent.push(target);
    if (target.includes("/api/auth/session")) return sessionResponse();
    // Real-machine shape: this variant answers 403 Forbidden while the plain
    // conversation endpoint answers 200 with the complete mapping.
    if (target.includes("include_full_conversation=true")) {
      return jsonResponse({ detail: "Forbidden" }, { ok: false, status: 403 });
    }
    if (/\/backend-api\/conversation\/conv-1(\?|$)/.test(target)) {
      return jsonResponse(completeMapping());
    }
    return jsonResponse({ detail: "Not Found" }, { ok: false, status: 404 });
  });

  const response = await api.fetchConversationByIdCandidates(["conv-1"]);

  assert.equal(response.data.current_node, "m2");
  assert.equal(response.completeness.chainComplete, true);
  assert.equal(api.isConversationAccessBlocked("conv-1"), false);
  // The plain endpoint is read first, so the dead variant is never requested.
  assert.equal(
    sent.some((url) => url.includes("include_full_conversation=true")),
    false,
  );
  api.clearConversationAccessBlock();
});

test("one refused variant does not report the conversation as blocked", async () => {
  const api = createFixture();
  api.setFetch(async (url) => {
    const target = String(url);
    if (target.includes("/api/auth/session")) return sessionResponse();
    if (target.includes("include_full_conversation=true")) {
      return jsonResponse(null, { ok: false, status: 403 });
    }
    return jsonResponse({ detail: { code: "conversation_inaccessible" } }, { ok: false, status: 404 });
  });

  await assert.rejects(() => api.fetchConversationByIdCandidates(["conv-1"]), (error) => {
    // The user-facing reason is the real failure (404 / inaccessible), not the
    // 403 of a variant this account simply cannot use.
    assert.equal(error.code, "NOT_FOUND");
    assert.equal(error.fallbackAllowed, true);
    return true;
  });
  assert.equal(api.isConversationAccessBlocked("conv-1"), false);
});

test("an anonymous-looking 404 refreshes the token and retries once", async () => {
  const api = createFixture();
  let conversationCalls = 0;
  api.setFetch(async (url, init) => {
    const target = String(url);
    if (target.includes("/api/auth/session")) return sessionResponse();
    conversationCalls += 1;
    if (conversationCalls === 1) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => "application/json" },
        clone() {
          return { text: async () => JSON.stringify({ detail: { code: "conversation_inaccessible" } }) };
        },
        json: async () => ({}),
      };
    }
    assert.ok(init?.headers?.Authorization, "the retry must carry a bearer token");
    return jsonResponse(completeMapping());
  });

  const response = await api.fetchConversationByIdCandidates(["conv-1"]);

  assert.equal(response.data.current_node, "m2");
  assert.equal(conversationCalls, 2);
  api.clearConversationAccessBlock();
});

test("HTTP 403 stops further conversation requests and is recorded", async () => {
  const api = createFixture();
  let conversationRequests = 0;
  api.setFetch(async (url) => {
    if (String(url).includes("/api/auth/session")) return sessionResponse();
    conversationRequests += 1;
    return jsonResponse(null, { ok: false, status: 403 });
  });

  await assert.rejects(
    () =>
      api.fetchJsonWithTimeout("https://chatgpt.com/backend-api/conversation/conv-1", {
        conversationId: "conv-1",
      }),
    (error) => {
      assert.equal(error.code, "ACCESS_BLOCKED");
      assert.equal(error.status, 403);
      assert.equal(error.fallbackAllowed, false);
      return true;
    },
  );

  assert.equal(api.isConversationAccessBlocked("conv-1"), true);
  const diagnostic = api
    .getExportApiDiagnostics()
    .find((entry) => entry.category === "conversation");
  assert.equal(diagnostic.status, 403);
  assert.equal(diagnostic.challenge, false);
  assert.equal(diagnostic.category, "conversation");
  assert.equal(diagnostic.outcome, "blocked");
  assert.equal(typeof diagnostic.durationMs, "number");
  assert.equal(diagnostic.path, "/backend-api/conversation/:id");

  // The stop survives: no second request is attempted for the same conversation.
  await assert.rejects(() => api.fetchConversationByIdCandidates(["conv-1"]), (error) => {
    assert.equal(error.fallbackAllowed, false);
    return true;
  });
  assert.equal(conversationRequests, 1);
});

test("HTTP 429 shares one cooldown across features", async () => {
  const api = createFixture();
  api.setFetch(async (url) => {
    if (String(url).includes("/api/auth/session")) return sessionResponse();
    return jsonResponse(null, {
      ok: false,
      status: 429,
      headers: { "retry-after": "60" },
    });
  });

  await assert.rejects(
    () => api.fetchJsonWithTimeout("https://chatgpt.com/backend-api/conversations/conv-1"),
    (error) => {
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.fallbackAllowed, false);
      assert.equal(error.details.retryAfterMs, 60000);
      return true;
    },
  );

  const remaining = api.getConversationApiCooldownRemainingMs();
  assert.equal(remaining > 15000, true);

  // A different endpoint waits on the same cooldown instead of retrying now.
  await assert.rejects(
    () => api.fetchJsonWithTimeout("https://chatgpt.com/backend-api/conversation/conv-1"),
    (error) => {
      assert.equal(error.code, "RATE_LIMITED");
      return true;
    },
  );
  api.clearConversationApiCooldown();
});

test("concurrent reads of one conversation share a single request chain", async () => {
  const api = createFixture();
  api.setFetch(async (url) => {
    if (String(url).includes("/api/auth/session")) return sessionResponse();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return jsonResponse(completeMapping());
  });

  const [first, second] = await Promise.all([
    api.fetchConversationByIdCandidates(["conv-1"]),
    api.fetchConversationByIdCandidates(["conv-1"]),
  ]);

  const conversationCalls = api.requests.filter((url) =>
    url.includes("/backend-api/conversation/conv-1"),
  );
  assert.equal(conversationCalls.length, 1);
  assert.equal(first.data.conversation_id, "conv-1");
  assert.equal(second.data.conversation_id, "conv-1");

  // Different options are a different request key, not a shared response.
  assert.notEqual(
    api.getConversationRequestKey(["conv-1"], {}),
    api.getConversationRequestKey(["conv-1"], { legacyOnly: true }),
  );
});

test("cancelling one subscriber keeps the shared read alive; the last one stops pagination", async () => {
  const api = createFixture();
  let announcePage, pageSignal;
  const pageStarted = new Promise((resolve) => { announcePage = resolve; });
  api.setFetch(async (url, init) => {
    if (String(url).includes("/api/auth/session")) return sessionResponse();
    if (String(url).includes("/conversation/")) return jsonResponse({}, { ok: false, status: 404 });
    if (!String(url).includes("/messages")) return jsonResponse({
      messages: [{ id: "m2", author: { role: "user" }, content: { parts: ["hello"] } }],
      page_info: { has_previous_page: true, start_cursor: "older-page" },
    });
    pageSignal = init.signal;
    announcePage();
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }, { once: true }));
  });
  const first = new AbortController(), second = new AbortController();
  const p1 = api.fetchConversationByIdCandidates(["conv-1"], { signal: first.signal });
  const p2 = api.fetchConversationByIdCandidates(["conv-1"], { signal: second.signal });
  await pageStarted;
  first.abort();
  await assert.rejects(p1, (error) => error.code === "CANCELLED");
  assert.equal(pageSignal.aborted, false);
  second.abort();
  await assert.rejects(p2, (error) => error.code === "CANCELLED");
  assert.equal(pageSignal.aborted, true);
  const count = api.requests.length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.requests.length, count, "no more pages or endpoint fallbacks after cancellation");
});

test("an already-aborted read starts no requests and request budgets have separate keys", async () => {
  const api = createFixture(), controller = new AbortController();
  controller.abort();
  await assert.rejects(api.fetchConversationByIdCandidates(["conv-1"], { signal: controller.signal }),
    (error) => error.code === "CANCELLED");
  assert.equal(api.requests.length, 0);
  const key = api.getConversationRequestKey(["conv-1"]);
  assert.notEqual(key, api.getConversationRequestKey(["conv-1"], { timeoutMs: 50 }));
  assert.notEqual(key, api.getConversationRequestKey(["conv-1"], { retries: 0 }));
});

test("an explicit challenge stops the chain even when endpoint fallback is enabled", async () => {
  const api = createFixture();
  api.setFetch(async (url) => String(url).includes("/api/auth/session") ? sessionResponse() :
    jsonResponse({}, { ok: false, status: 403, headers: { "cf-mitigated": "challenge" } }));
  await assert.rejects(api.fetchConversationByIdCandidates(["conv-1"]), (error) => error.code === "ACCESS_CHALLENGE");
  assert.equal(api.requests.filter((url) => url.includes("/backend-api/")).length, 1);
});
