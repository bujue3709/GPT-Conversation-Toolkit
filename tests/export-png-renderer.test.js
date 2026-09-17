const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rendererPath = path.join(__dirname, "..", "features", "export-png-renderer.js");
const source = fs.readFileSync(rendererPath, "utf8");

let activeLargeCanvases = 0;
let maxActiveLargeCanvases = 0;
let encodeAttempt = 0;
let failEncodeAt = 0;
let filenameBuildCalls = 0;
const downloads = [];
const statuses = [];
const drawnText = [];
let activeLocale = "en";

const createContext2d = () => ({
  font: "400 25px sans-serif",
  fillStyle: "#000",
  strokeStyle: "#000",
  lineWidth: 1,
  textAlign: "left",
  textBaseline: "top",
  measureText(text) {
    const size = Number.parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || "25");
    return { width: Array.from(String(text)).length * size * 0.56 };
  },
  beginPath() {},
  moveTo() {},
  arcTo() {},
  closePath() {},
  fill() {},
  stroke() {},
  fillRect() {},
  strokeRect() {},
  fillText(text) {
    drawnText.push(String(text));
  },
  save() {},
  restore() {},
  rect() {},
  clip() {},
});

const createCanvas = () => {
  let width = 0;
  let height = 0;
  let counted = false;
  return {
    get width() {
      return width;
    },
    set width(value) {
      width = value;
      if (value > 1 && !counted) {
        counted = true;
        activeLargeCanvases += 1;
        maxActiveLargeCanvases = Math.max(maxActiveLargeCanvases, activeLargeCanvases);
      } else if (value === 0 && counted) {
        counted = false;
        activeLargeCanvases -= 1;
      }
    },
    get height() {
      return height;
    },
    set height(value) {
      height = value;
    },
    getContext: () => createContext2d(),
    toBlob(callback) {
      encodeAttempt += 1;
      callback(encodeAttempt === failEncodeAt ? null : new Blob(["png"], { type: "image/png" }));
    },
  };
};

const sandbox = {
  Blob,
  console,
  document: {
    body: { appendChild() {} },
    createElement(tag) {
      if (tag === "canvas") {
        return createCanvas();
      }
      if (tag === "a") {
        return {
          href: "",
          download: "",
          click() {
            downloads.push(this.download);
          },
          remove() {},
        };
      }
      throw new Error(`Unexpected element: ${tag}`);
    },
  },
  URL: {
    createObjectURL: () => "blob:test",
    revokeObjectURL() {},
  },
  setTimeout(callback) {
    callback();
    return 1;
  },
  updateStatusByKey(key, tone, params) {
    statuses.push({ key, tone, params });
  },
  t(key, params = {}) {
    const messages = {
      en: { "png.watermark": "Exported by {project}" },
      "zh-CN": { "png.watermark": "由 {project} 导出" },
    };
    const template = messages[activeLocale]?.[key] || key;
    return template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
  },
  buildConversationExportFilename: () => {
    filenameBuildCalls += 1;
    return "chatgpt-renderer-test-2026-09-17.png";
  },
};
vm.createContext(sandbox);
vm.runInContext(
  `${source}\nthis.__pngTestApi = {\n` +
    "parsePngMarkdownBlocks, createPngMeasureContext, paginateConversationForPng, " +
    "buildConversationPngFilename, getPngWatermarkParts, exportConversationPng, PNG_EXPORT_PAGE_CAPACITY\n};",
  sandbox,
  { filename: rendererPath },
);

const api = sandbox.__pngTestApi;

assert.equal(api.getPngWatermarkParts().prefix, "Exported by ");
assert.equal(api.getPngWatermarkParts().project, "GPT-Conversation-Toolkit");
assert.equal(api.getPngWatermarkParts().suffix, "");
activeLocale = "zh-CN";
assert.equal(api.getPngWatermarkParts().prefix, "由 ");
assert.equal(api.getPngWatermarkParts().suffix, " 导出");

const blocks = api.parsePngMarkdownBlocks([
  "# Heading",
  "",
  "Paragraph with **bold** and `code`.",
  "",
  "- First item",
  "- Second item",
  "",
  "> Quote",
  "",
  "| Name | Value |",
  "| --- | --- |",
  "| A | B |",
  "",
  "```js",
  "const value = 1;",
  "```",
].join("\n"));
assert.deepEqual(
  Array.from(blocks, (block) => block.kind),
  ["heading", "paragraph", "list-item", "list-item", "quote", "table", "code"],
);

const measurement = api.createPngMeasureContext();
const compactPayload = {
  source: "api",
  title: "Compact",
  messages: [
    { role: "user", text: "Short question" },
    { role: "assistant", text: "Short answer" },
  ],
};
const compactPages = api.paginateConversationForPng(compactPayload, measurement.context);
assert.equal(compactPages.length, 1);
assert.equal(compactPages[0].items.length, 2);
assert.ok(compactPages[0].items.every((item) => item.continued === false));

const codeLines = Array.from({ length: 900 }, (_, index) => `const line_${index} = ${index};`).join("\n");
const tableRows = Array.from({ length: 220 }, (_, index) => `| row ${index} | value ${index} |`).join("\n");
const longPayload = {
  source: "api",
  title: "Very long conversation",
  messages: [
    { role: "user", text: "Export all of this" },
    {
      role: "assistant",
      text: [
        "```js",
        codeLines,
        "```",
        "",
        "| Name | Value |",
        "| --- | --- |",
        tableRows,
      ].join("\n"),
    },
  ],
};
const longPages = api.paginateConversationForPng(longPayload, measurement.context);
assert.ok(longPages.length > 2);
assert.ok(longPages.every((page) => page.usedHeight <= api.PNG_EXPORT_PAGE_CAPACITY));
const assistantFragments = longPages.flatMap((page) => page.items).filter((item) => item.role === "assistant");
assert.ok(assistantFragments.length > 1);
assert.equal(assistantFragments[0].continued, false);
assert.ok(assistantFragments.slice(1).every((item) => item.continued === true));
assert.ok(
  assistantFragments
    .flatMap((fragment) => fragment.units)
    .some((unit) => unit.type === "code" && unit.continuedUnit),
);
assert.ok(
  assistantFragments
    .flatMap((fragment) => fragment.units)
    .some((unit) => unit.type === "table" && unit.continuedUnit),
);

assert.equal(api.buildConversationPngFilename(longPayload, 0, longPages.length), "chatgpt-renderer-test-2026-09-17-part-01.png");

(async () => {
  activeLocale = "zh-CN";
  drawnText.length = 0;
  filenameBuildCalls = 0;
  const result = await api.exportConversationPng(longPayload);
  assert.equal(result.pageCount, longPages.length);
  assert.equal(downloads.length, longPages.length);
  assert.match(downloads[0], /-part-01\.png$/);
  assert.match(downloads.at(-1), new RegExp(`-part-${String(longPages.length).padStart(2, "0")}\\.png$`));
  assert.equal(maxActiveLargeCanvases, 1);
  assert.equal(activeLargeCanvases, 0);
  assert.equal(filenameBuildCalls, 1, "all PNG parts must share one timestamped base filename");
  assert.ok(statuses.some((entry) => entry.key === "status.pngGeneratingPage"));
  assert.equal(statuses.at(-1).key, "status.pngDoneMultiple");
  assert.ok(drawnText.includes("由 "));
  assert.ok(drawnText.includes("GPT-Conversation-Toolkit"));
  assert.ok(drawnText.includes(" 导出"));

  downloads.length = 0;
  encodeAttempt = 0;
  failEncodeAt = 3;
  await assert.rejects(
    () => api.exportConversationPng(longPayload),
    (error) => error.code === "PNG_RENDER_FAILED" && /page 3/i.test(error.message),
  );
  assert.equal(downloads.length, 2, "pages after a failed render must not be downloaded");
  assert.equal(activeLargeCanvases, 0);
  console.log(`PNG renderer tests passed (${longPages.length} pages, max ${maxActiveLargeCanvases} large canvas).`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
