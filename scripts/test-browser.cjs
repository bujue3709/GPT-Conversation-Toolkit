const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const fflate = require("fflate");
const { crc32 } = require("node:zlib");
const root = path.join(__dirname, "..");
const output = path.join(root, "output", "browser");
fs.mkdirSync(output, { recursive: true });
const pngChunk = (type, data) => {
  const head = Buffer.alloc(8),
    tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  head.write(type, 4);
  tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([head, data, tail]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(160);
ihdr.writeUInt32BE(100, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const pixels = Buffer.alloc(100 * (1 + 160 * 3));
for (let y = 0; y < 100; y++)
  for (let x = 0; x < 160; x++) {
    const o = y * 481 + 1 + x * 3;
    pixels[o] = 220;
    pixels[o + 1] = 35;
    pixels[o + 2] = 60;
  }
const imageBytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", Buffer.from(fflate.zlibSync(pixels))),
  pngChunk("IEND", Buffer.alloc(0)),
]);
const imagePart = (id) => ({
  content_type: "image_asset_pointer",
  asset_pointer: `sediment://${id}`,
});
const fixtureMessages = [
  {
    id: "user-1",
    author: { role: "user" },
    content: {
      parts: ["Please inspect this image.", imagePart("file-upload")],
    },
  },
  {
    id: "tool-1",
    author: { role: "tool" },
    content: { content_type: "execution_output", parts: ["hidden tool text"] },
    metadata: {
      aggregate_result: {
        messages: [
          { message_type: "image", image_url: "sediment://file-generated" },
        ],
      },
    },
  },
  {
    id: "assistant-1",
    author: { role: "assistant" },
    content: {
      parts: [
        "Here is the result.",
        imagePart("file-generated"),
        "After the image.",
      ],
    },
  },
  {
    id: "user-2",
    author: { role: "user" },
    content: { parts: ["Second turn"] },
  },
  {
    id: "assistant-2",
    author: { role: "assistant" },
    content: {
      parts: [
        "Second answer with **bold**, a formula $x^2$ and a code block.\n\n```js\nconsole.log(1);\n```",
      ],
    },
  },
];
const conversation = {
  conversation_id: "synthetic-fixture",
  title: "Image export fixture",
  current_node: "assistant-2",
  mapping: Object.fromEntries(
    fixtureMessages.map((message, index) => [
      message.id,
      {
        id: message.id,
        parent: fixtureMessages[index - 1]?.id || null,
        children: [fixtureMessages[index + 1]?.id].filter(Boolean),
        message,
      },
    ]),
  ),
};

(async () => {
  const context = await chromium.launchPersistentContext("", {
    channel:
      process.env.TOOLKIT_BROWSER ||
      (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    acceptDownloads: true,
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const worlds = [];
    cdp.on("Runtime.executionContextCreated", ({ context }) =>
      worlds.push(context),
    );
    await cdp.send("Runtime.enable");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const imageRequests = [];
    let failImage = false;
    await context.route("https://fixture-images.example/**", (route) => {
      imageRequests.push(route.request().url());
      assert(!route.request().headers().authorization);
      return route.fulfill({
        status: failImage ? 404 : 200,
        contentType: "image/png",
        headers: { "access-control-allow-origin": "*" },
        body: imageBytes,
      });
    });
    await page.route("https://chatgpt.com/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/session")
        return route.fulfill({
          json: { accessToken: "synthetic-fixture-token-not-real-123456789" },
        });
      if (url.pathname.startsWith("/backend-api/files/download/"))
        return route.fulfill({
          json: {
            download_url: `https://fixture-images.example/${url.pathname.split("/").at(-1)}.png?fixture-signature=not-real`,
          },
        });
      if (url.pathname.startsWith("/backend-api/conversation/"))
        return route.fulfill({ json: conversation });
      if (url.pathname.startsWith("/backend-api/"))
        return route.fulfill({ json: { items: [] } });
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><title>Toolkit synthetic fixture</title></head><body><main id='main'>${fixtureMessages
          .filter((m) => m.author.role !== "tool")
          .map(
            (m) =>
              `<article data-message-id='${m.id}' data-message-author-role='${m.author.role}'><div class='markdown'><p>${m.id} fixture text</p>${m.id === "user-1" ? "<img src='https://fixture-images.example/dom.png' alt='Fixture image'>" : ""}</div></article>`,
          )
          .join("")}</main></body></html>`,
      });
    });
    await page.goto("https://chatgpt.com/c/synthetic-fixture");
    await page.locator("#chatgpt-conversation-toolkit").waitFor();
    const world = worlds.find((w) =>
      w.origin?.startsWith("chrome-extension://"),
    );
    assert(world, "Extension isolated world must be present");
    const extension = async (fn, ...args) => {
      const response = await cdp.send("Runtime.evaluate", {
        contextId: world.id,
        expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails)
        throw new Error(
          response.exceptionDetails.exception?.description ||
            response.exceptionDetails.text,
        );
      return response.result.value;
    };
    await extension(() => {
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: () => { throw new Error("Save picker must not be invoked"); },
      });
    });
    // Browser DOM equivalence and resource-load regression, in the real content-script world.
    const reading = await extension(async () => {
      let clones = 0;
      const oldClone = Node.prototype.cloneNode;
      Node.prototype.cloneNode = function (...args) {
        clones++;
        return oldClone.apply(this, args);
      };
      const node = document.querySelector("article");
      const before = node.outerHTML;
      for (let i = 0; i < 1000; i++) getElementReadableText(node);
      const cases = [
        "before<button>omit<span>nested</span></button>after",
        "<script>omit</script><style>omit</style>keep",
        '<span aria-hidden="true">omit</span><b>keep</b>',
        "<svg><text>svg</text></svg><template>omit</template>keep",
      ];
      const texts = cases.map((html) => {
        const el = document.createElement("div");
        el.innerHTML = html;
        return getElementReadableText(el);
      });
      Node.prototype.cloneNode = oldClone;
      return { clones, texts, unchanged: before === node.outerHTML };
    });
    assert.equal(reading.clones, 0);
    assert(reading.unchanged);
    assert.deepEqual(reading.texts, ["beforeafter", "keep", "keep", "svgkeep"]);
    await page.locator('[data-action="export"]').click();
    await page.locator("[data-export-selection-export-button]").waitFor();
    await page.locator(".chatgpt-toolkit-export-panel").screenshot({ path: path.join(output, "export-dialog.png") });
    // Images present: default export still downloads the selected standalone format.
    for (const format of ["md", "json", "txt"]) {
      await page.locator('[data-export-selection-field="format"]').selectOption(format);
      assert.equal(await page.locator('[data-export-selection-field="images"]').inputValue(), "false");
      const plainPromise = page.waitForEvent("download");
      await page.locator("[data-export-selection-export-button]").click();
      const plain = await plainPromise;
      assert(plain.suggestedFilename().endsWith("." + format));
      await plain.saveAs(path.join(output, "text-only." + format));
      await page.waitForFunction(() => !document.querySelector("#chatgpt-toolkit-export-selection-modal")?.classList.contains("is-visible"));
      await page.locator('[data-action="export"]').click();
      await page.locator("[data-export-selection-export-button]").waitFor();
    }
    await page
      .locator('[data-export-selection-field="format"]')
      .selectOption("png");
    assert.equal(await page.locator('[data-export-selection-field="images"]').inputValue(), "false");
    assert.equal(
      await extension(() => exportSelectionState.includeImages),
      false,
    );
    await page.locator('[data-export-selection-field="images"]').selectOption("true");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("[data-export-selection-export-button]").click();
    const download = await downloadPromise;
    const archivePath = path.join(output, "image-export.zip");
    await download.saveAs(archivePath);
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#chatgpt-toolkit-export-selection-modal")
          ?.classList.contains("is-visible"),
    );
    const files = fflate.unzipSync(fs.readFileSync(archivePath));
    const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
    assert.equal(manifest.uniqueImageCount, 2);
    assert.equal(manifest.imageCount, 3);
    assert.equal(manifest.completeness, "complete");
    assert.deepEqual(Buffer.from(files["images/image-0001.png"]), imageBytes);
    assert.deepEqual(Buffer.from(files["images/image-0002.png"]), imageBytes);
    assert(!files["conversation.md"] && !files["conversation.json"] && !files["conversation.txt"]);
    for (const format of ["md", "json", "txt"]) {
      const promise = page.waitForEvent("download");
      await extension(async (format) => {
        const prepared = await prepareConversationExportPayload({ updateStatus: false });
        await exportMessages({ preparedExport: prepared, format, includeImages: true });
      }, format);
      const result = await promise;
      const destination = path.join(output, format + "-images.zip");
      await result.saveAs(destination);
      const archive = fflate.unzipSync(fs.readFileSync(destination));
      assert(archive["conversation." + format]);
      for (const other of ["md", "json", "txt"].filter(value => value !== format)) assert(!archive["conversation." + other]);
      assert(!Object.keys(archive).some(name => name.startsWith("pages/")));
      const text = Buffer.from(archive["conversation." + format]).toString();
      assert(!text.includes("fixture-signature"));
      assert(!text.includes("hidden tool text"));
      if (format === "md") assert.match(text, /images\/image-0001.png/);
    }
    const pngName = Object.keys(files).find((name) =>
      name.startsWith("pages/"),
    );
    assert(pngName);
    const renderedPath = path.join(output, "image-export-page.png");
    fs.writeFileSync(renderedPath, files[pngName]);
    const checkPage = await context.newPage();
    const redPixels = await checkPage.evaluate(async (base64) => {
      const blob = await (
        await fetch(`data:image/png;base64,${base64}`)
      ).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > 180 && data[i + 1] < 70 && data[i + 2] < 100) count++;
      bitmap.close();
      canvas.width = canvas.height = 0;
      return count;
    }, Buffer.from(files[pngName]).toString("base64"));
    assert(redPixels > 10000, "PNG must contain actual image pixels");
    await checkPage.close();
    const released = await extension(async () => ({
      prepared: exportSelectionState.preparedExport,
      turns: exportSelectionState.turns.length,
      temporaryDirectories: await (async () => {
        const root = await navigator.storage.getDirectory();
        let n = 0;
        for await (const [name] of root.entries())
          if (name.startsWith("chatgpt-toolkit-export-")) n++;
        return n;
      })(),
    }));
    assert.equal(released.prepared, null);
    assert.equal(released.turns, 0);
    assert.equal(released.temporaryDirectories, 0);
    // Selection must exclude uploaded user images while retaining generated output.
    const selected = await extension(async () => {
      const p = await prepareConversationExportPayload({ updateStatus: false });
      return applyExportSelection(p.payload, {
        scope: "selected",
        selectedTurnIds: ["turn-1"],
        roleFilter: "assistant",
      }).messages.map((m) => ({ role: m.role, images: m.images?.length || 0 }));
    });
    assert(selected.every((m) => m.role === "assistant"));
    assert.equal(
      selected.reduce((n, m) => n + m.images, 0),
      2,
    );
    // Failed images produce an honest partial archive; text still exports.
    failImage = true;
    const partialDownloadPromise = page.waitForEvent("download");
    const pending = extension(async () => {
      const p = await prepareConversationExportPayload({ updateStatus: false });
      return Boolean(
        await exportMessages({
          preparedExport: p,
          format: "md",
          includeImages: true,
        }),
      );
    });
    const partialDownload = await partialDownloadPromise;
    const partialPath = path.join(output, "partial-export.zip");
    await partialDownload.saveAs(partialPath);
    await pending;
    const partialFiles = fflate.unzipSync(fs.readFileSync(partialPath));
    assert.equal(
      JSON.parse(Buffer.from(partialFiles["manifest.json"]).toString())
        .failedImageCount,
      3,
    );
    assert.match(
      Buffer.from(partialFiles["conversation.md"]).toString(),
      /Image unavailable/,
    );
    failImage = false;
    const compatibility = await extension(async () => {
      await performSearch("Second");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const searchMatches = state.searchMatches.length;
      state.keepLatest = 1;
      const collapsed = collapseOldMessages({
        rememberState: false,
        updateStatus: false,
      });
      const fallback = collectMessagesFromDomFallback({});
      const collapsedImageCount = fallback.messages.reduce(
        (sum, m) => sum + (m.images?.length || 0),
        0,
      );
      restoreMessages({ clearRemembered: false, updateStatus: false });
      const restored = !state.isCollapsed && state.collapsedNodes.length === 0;
      setTimelineVisibility(true, { persist: false });
      renderTimeline();
      const timelineVisible =
        Boolean(document.getElementById(TIMELINE_ID)) && timelineState.visible;
      setTimelineVisibility(false, { persist: false });
      await savePromptItems([
        normalizePromptItem({
          id: "synthetic-prompt",
          title: "Fixture prompt",
          content: "Synthetic prompt body",
          category: "Test",
        }),
      ]);
      promptState.loaded = false;
      await ensurePromptLibraryLoaded();
      const promptRoundTrip =
        extractPromptItems(buildPromptStoragePayload(promptState.items))[0]
          ?.content === "Synthetic prompt body";
      return {
        searchMatches,
        collapsed,
        collapsedImageCount,
        restored,
        timelineVisible,
        promptRoundTrip,
      };
    });
    assert(compatibility.searchMatches > 0);
    assert(compatibility.collapsed);
    assert.equal(compatibility.collapsedImageCount, 1);
    assert(compatibility.restored);
    assert(compatibility.timelineVisible);
    assert(compatibility.promptRoundTrip);
    // Cancel a real export while its image fetch is pending; no download occurs.
    let releaseImage, imageStarted;
    const started = new Promise((resolve) => (imageStarted = resolve));
    const held = new Promise((resolve) => (releaseImage = resolve));
    await context.route(
      "https://fixture-images.example/slow.png",
      async (route) => {
        imageStarted();
        await held;
        await route
          .fulfill({
            contentType: "image/png",
            headers: { "access-control-allow-origin": "*" },
            body: imageBytes,
          })
          .catch(() => {});
      },
    );
    await page.locator('[data-action="export"]').click();
    await page.locator("[data-export-selection-export-button]").waitFor();
    const cancelled = extension(async () => {
      const image = makeExportImage("https://fixture-images.example/slow.png");
      const options = {
        preparedExport: {
          payload: {
            messages: [
              {
                index: 1,
                role: "assistant",
                text: "cancel fixture",
                images: [image],
              },
            ],
          },
        },
        format: "md",
        includeImages: true,
      };
      exportSelectionState.preparedExport = options.preparedExport;
      exportSelectionState.format = options.format;
      exportSelectionState.includeImages = true;
      await handleExportSelectionAction("export");
      return null;
    });
    await started;
    assert(await page.locator("[data-export-selection-export-button]").isDisabled());
    assert((await page.locator("[data-export-selection-progress]").innerText()).includes("1"));
    await page.waitForFunction(() => document.querySelector("[data-export-selection-elapsed]")?.textContent.includes("1"));
    await page.locator(".chatgpt-toolkit-export-panel").screenshot({ path: path.join(output, "export-progress.png") });
    await page.locator('[data-export-selection-action="close"]').last().click();
    releaseImage();
    assert.equal(await cancelled, null);
    assert.equal(await extension(() => exportInProgress), false);
    // Repeated exports exercise the real browser download path.
    let repeatedDownloads = 0;
    const countDownload = () => { repeatedDownloads++; };
    page.on("download", countDownload);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    const repeated = await extension(async () => {
      for (let i = 0; i < 10; i++) {
        const prepared = await prepareConversationExportPayload({
          updateStatus: false,
        });
        const result = await exportMessages({
          preparedExport: prepared,
          format: "png",
          includeImages: true,
        });
        if (!result) throw new Error("Repeated export failed");
      }
      const root = await navigator.storage.getDirectory();
      let temporaryDirectories = 0;
      for await (const [name] of root.entries())
        if (name.startsWith("chatgpt-toolkit-export-")) temporaryDirectories++;
      return { temporaryDirectories };
    });
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    await new Promise(resolve => setTimeout(resolve, 1200));
    page.off("download", countDownload);
    assert.equal(repeatedDownloads, 10);
    repeated.downloads = repeatedDownloads;
    assert.equal(repeated.temporaryDirectories, 0);
    assert(
      heapAfter - heapBefore < 8 * 1024 * 1024,
      "Repeated exports must not retain job buffers",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    const result = {
      browser: context.browser().version(),
      realExtensionLoaded: true,
      textReader: reading,
      imageCount: manifest.imageCount,
      uniqueImages: manifest.uniqueImageCount,
      pngRedPixels: redPixels,
      released,
      partialFailureReported: true,
      cancellationPassed: true,
      compatibility,
      repeated: { ...repeated, heapBefore, heapAfter },
      errors,
    };
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
