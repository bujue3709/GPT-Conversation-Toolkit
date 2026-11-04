const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const fflate = require("fflate");
const source = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=",
  "base64",
);

function setup(extra = {}) {
  const ctx = vm.createContext({
    Blob,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    DataView,
    Map,
    Set,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    fflate,
    window: {
      location: {
        origin: "https://chatgpt.com",
        href: "https://chatgpt.com/c/conversation-1",
      },
    },
    TOOLKIT_EXPORT_ROLE_ALL: "all",
    TOOLKIT_EXPORT_ROLE_ASSISTANT: "assistant",
    serializeExportApiError: () => null,
    ExportApiError: Error,
    t: (key) => key,
    ...extra,
  });
  for (const file of [
    "features/export-images.js",
    "features/export-normalizer.js",
    "features/export-formatters.js",
    "features/export-archive.js",
  ])
    vm.runInContext(source(file), ctx);
  return { ctx, run: (code) => vm.runInContext(code, ctx) };
}

test("uploaded, generated and image-only tool messages survive active-branch export", () => {
  const { run, ctx } = setup();
  ctx.data = {
    current_node: "reply",
    mapping: {
      user: {
        id: "user",
        parent: null,
        message: {
          id: "user",
          author: { role: "user" },
          content: {
            parts: [
              "Look",
              {
                content_type: "image_asset_pointer",
                asset_pointer: "sediment://file-upload",
              },
            ],
          },
        },
      },
      tool: {
        id: "tool",
        parent: "user",
        message: {
          id: "tool",
          author: { role: "tool" },
          content: {
            content_type: "execution_output",
            parts: ["private tool output"],
          },
          metadata: {
            aggregate_result: {
              messages: [
                { message_type: "image", image_url: "sediment://file-chart" },
              ],
            },
          },
        },
      },
      reply: {
        id: "reply",
        parent: "tool",
        message: {
          id: "reply",
          author: { role: "assistant" },
          content: {
            parts: [
              {
                content_type: "image_asset_pointer",
                asset_pointer: "sediment://file-generated",
              },
            ],
          },
        },
      },
      alternate: {
        id: "alternate",
        parent: "user",
        message: {
          author: { role: "assistant" },
          content: { parts: ["wrong branch"] },
        },
      },
    },
  };
  const payload = run("normalizeConversationApiResponse(data)");
  assert.equal(payload.messages.length, 3);
  assert.deepEqual(
    Array.from(payload.messages, (m) => m.images[0].source),
    [
      "sediment://file-upload",
      "sediment://file-chart",
      "sediment://file-generated",
    ],
  );
  assert.equal(payload.messages[1].text, "");
  assert.equal(payload.messages[1].role, "assistant");
  assert(!JSON.stringify(payload).includes("private tool output"));
});

test("selection filters images with their message and does not mutate prepared data", () => {
  const { run } = setup();
  const result = run(`(() => {
    const image = makeExportImage('https://example.test/image.png?secret=value');
    const payload = { messages: [{index:1,role:'user',text:'u',images:[image]}, {index:2,role:'assistant',text:'a',images:[image]}, {index:3,role:'user',text:'second'}] };
    const selected = applyExportSelection(payload, { scope:'selected', selectedTurnIds:['turn-1'], roleFilter:'assistant' });
    selected.messages[0].images[0].path = 'images/image-0001.png';
    return { selected, original:image, source:selected.messages[0].images[0].source };
  })()`);
  assert.equal(result.selected.messages.length, 1);
  assert.equal(result.selected.messages[0].sourceIndex, 2);
  assert.equal(result.original.path, undefined);
  assert.match(result.source, /secret=value/);
  assert(!JSON.stringify(result.selected).includes("secret"));
});

test("explicitly hidden tool images are not exported", () => {
  const { run } = setup();
  assert.equal(
    run(
      "normalizeApiMessage({message:{author:{role:'tool'},metadata:{is_visually_hidden_from_conversation:true},content:{parts:[{content_type:'image_asset_pointer',asset_pointer:'sediment://file-hidden'}]}}},1,'')",
    ),
    null,
  );
});

test("Markdown preserves text/image order and JSON uses relative image paths", () => {
  const { run } = setup();
  const result = run(`(() => {
    const media=collectExportImageContent({id:'msg',content:{parts:['before',{content_type:'image_asset_pointer',asset_pointer:'sediment://file-one'},'after']}});
    media.images[0].path='images/image-0001.png';
    const payload={includeImages:true,messages:[{role:'assistant',...media}]};
    return {md:formatConversationExportMarkdown(payload),json:formatConversationExportJson(payload)};
  })()`);
  assert.match(
    result.md,
    /before\n\n!\[Image\]\(images\/image-0001.png\)\n\nafter/,
  );
  assert(!result.json.includes("sediment://"));
});

test("image parsing preserves fenced/inline code and handles parentheses in URLs", () => {
  const { run, ctx } = setup();
  ctx.text =
    "Example `![code](https://example.test/code.png)`\n\n```md\n![fenced](https://example.test/fenced.png)\n```\n\n![actual](https://example.test/image(1).png)";
  const media = run("collectExportImageContent({content:{parts:[text]}})");
  assert.equal(media.images.length, 1);
  assert.equal(media.images[0].source, "https://example.test/image(1).png");
  assert(media.content[0].text.includes("![fenced]"));
  assert(media.content[0].text.includes("![code]"));
});

test("octet-stream responses are accepted only when image bytes are recognized", async () => {
  const { run, ctx } = setup();
  ctx.response = new Response(png, {
    headers: { "content-type": "application/octet-stream" },
  });
  assert.equal(
    (await run("readExportImageResponse(response)")).type,
    "image/png",
  );
  ctx.response = new Response("<html>Not an image</html>", {
    headers: { "content-type": "application/octet-stream" },
  });
  await assert.rejects(
    run("readExportImageResponse(response)"),
    /recognized image/,
  );
});

test("cancelling preparation stops retries and DOM fallback", async () => {
  const controller = new AbortController();
  controller.abort();
  const ctx = vm.createContext({
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    window: {
      location: { origin: "https://chatgpt.com", hostname: "chatgpt.com" },
    },
    signal: controller.signal,
    fetch: () => assert.fail("cancelled preparation must not fetch"),
  });
  vm.runInContext(source("features/conversation-api.js"), ctx);
  await assert.rejects(
    vm.runInContext(
      "fetchJsonWithTimeout('https://chatgpt.com/backend-api/conversation/fixture',{signal})",
      ctx,
    ),
    (error) => error.code === "CANCELLED" && error.fallbackAllowed === false,
  );
});

test("dimension inspection rejects oversized bitmaps before decode", async () => {
  const { run, ctx } = setup();
  ctx.blob = new Blob([png], { type: "image/png" });
  const dims = await run("getExportImageDimensions(blob)");
  assert.equal(dims.width, 1);
  assert.equal(dims.height, 1);
  const huge = Buffer.from(png);
  huge.writeUInt32BE(100000, 16);
  huge.writeUInt32BE(100000, 20);
  ctx.blob = new Blob([huge], { type: "image/png" });
  assert.equal(await run("getExportImageDimensions(blob)"), null);
});

test("download reader enforces actual streamed size even without Content-Length", async () => {
  const { run, ctx } = setup();
  let cancelled = false;
  ctx.response = {
    ok: true,
    headers: new Headers({ "content-type": "image/png" }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(26 * 1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    }),
  };
  await assert.rejects(run("readExportImageResponse(response)"), /25 MiB/);
  assert(cancelled);
});

test("ZIP is valid, preserves original image bytes and awaits every sink write", async () => {
  const { run, ctx } = setup();
  const chunks = [];
  let writing = false,
    closed = false;
  ctx.sink = {
    async write(chunk) {
      assert.equal(writing, false);
      writing = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      chunks.push(Buffer.from(chunk));
      writing = false;
    },
    async close() {
      closed = true;
    },
    async abort() {},
  };
  ctx.blob = new Blob([png]);
  await run(
    "(async()=>{const zip=createExportZipWriter(sink);await zip.add('images/image-0001.png',blob);await zip.add('conversation.md',new Blob(['![Image](images/image-0001.png)']));await zip.close()})()",
  );
  const files = fflate.unzipSync(Buffer.concat(chunks));
  assert.deepEqual(Buffer.from(files["images/image-0001.png"]), png);
  assert.match(
    new TextDecoder().decode(files["conversation.md"]),
    /images\/image-0001.png/,
  );
  assert(closed);
});

test("archive cancellation aborts the sink without completing a partial ZIP", async () => {
  const { run, ctx } = setup();
  let aborted = false;
  const controller = new AbortController();
  controller.abort();
  ctx.signal = controller.signal;
  ctx.sink = {
    async write() {
      assert.fail("must not write");
    },
    async close() {
      assert.fail("must not close");
    },
    async abort() {
      aborted = true;
    },
  };
  await assert.rejects(
    run(
      "(async()=>{const zip=createExportZipWriter(sink,signal);try{await zip.add('conversation.md',new Blob(['test']))}catch(e){await zip.abort();throw e}})()",
    ),
    { name: "AbortError" },
  );
  assert(aborted);
});

test("bounded download fallback refuses more than 64 MiB", async () => {
  const { run } = setup();
  await assert.rejects(
    run(
      "(async()=>{const sink=await createExportArchiveSink('test.zip');try{await sink.write({byteLength:65*1024*1024})}finally{await sink.abort()}})()",
    ),
    /memoryLimit/,
  );
});

test("image resolver uses same-origin auth and does not send bearer tokens to image hosts", async () => {
  const calls = [];
  const { run } = setup({
    getAuthenticatedExportApiHeaders: async () => ({
      Authorization: "Bearer synthetic-test",
    }),
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1)
        return new Response(
          JSON.stringify({
            download_url: "https://cdn.example.test/image.png?signed=fixture",
          }),
          { headers: { "content-type": "application/json" } },
        );
      return new Response(png, { headers: { "content-type": "image/png" } });
    },
  });
  const blob = await run(
    "fetchExportImage(makeExportImage('sediment://file-fixture'),{})",
  );
  assert.equal(blob.size, png.length);
  assert.match(
    calls[0].url,
    /^https:\/\/chatgpt.com\/backend-api\/files\/download\/file-fixture/,
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-test");
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.credentials, "omit");
});

test("conversation access denial stops alternate endpoints and retries", async () => {
  for (const status of [401, 403, 429]) {
    let requests = 0;
    const ctx = vm.createContext({ URL, AbortController, setTimeout, clearTimeout,
      normalizeStrictConversationId: value => value,
      window: { location: { origin: "https://chatgpt.com", hostname: "chatgpt.com" } },
      fetch: async url => {
        if (String(url).includes('/api/auth/session')) return new Response(JSON.stringify({accessToken:'fixture'}));
        requests++; return new Response('blocked', {status});
      }
    });
    vm.runInContext(source('features/conversation-api.js'), ctx);
    await assert.rejects(vm.runInContext("fetchConversationById('fixture')",ctx), error => error.code === 'ACCESS_BLOCKED' && error.fallbackAllowed === false);
    assert.equal(requests, 1);
  }
});

test("blocked image access stops later requests but preserves selected text in partial ZIP", async () => {
  let requests = 0, download;
  const {run} = setup({
    fetch: async () => { requests++; return new Response('blocked', { status: 403 }); },
    buildConversationExportFilename: () => 'test.zip',
    updateStatusByKey: () => {},
    downloadExportFile: value => { download = value.content; },
  });
  await run(`exportConversationImageArchive({includeImages:true,messages:[{index:1,role:'assistant',text:'Keep this text',images:[makeExportImage('https://example.test/a.png'),makeExportImage('https://example.test/b.png')]}]}, {format:'md'})`);
  assert.equal(requests, 1);
  const files = fflate.unzipSync(new Uint8Array(await download.arrayBuffer()));
  assert(files['conversation.md']);
  assert(!files['conversation.json']);
  assert.match(new TextDecoder().decode(files['conversation.md']), /Keep this text/);
  assert.equal(JSON.parse(new TextDecoder().decode(files['manifest.json'])).failedImageCount, 2);
});

test("explicit Cloudflare challenge stops image access without reading HTML", () => {
  const {ctx, run} = setup();
  ctx.response = new Response('challenge', {headers:{'cf-mitigated':'challenge'}});
  assert.throws(() => run('checkExportImageAccess(response)'), error => error.stopImageRequests === true);
});
