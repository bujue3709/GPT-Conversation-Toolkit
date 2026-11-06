const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const i18nSource = fs.readFileSync(path.join(root, "core", "i18n.js"), "utf8");

const sandbox = {
  navigator: { language: "en-US" },
  document: { documentElement: { lang: "en" } },
  window: { location: { href: "https://chatgpt.com/" } },
  console,
};
vm.runInNewContext(
  `${i18nSource}
globalThis.i18nTest = { I18N_MESSAGES, TOOLKIT_SUPPORTED_LANGUAGES, t, tHtml, i18nState };`,
  sandbox,
);

const messages = sandbox.i18nTest.I18N_MESSAGES;

const collectReferencedKeys = () => {
  const files = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".js") && !next.includes("vendor")) files.push(next);
    }
  };
  ["core", "features", "ui", "utils"].forEach(walk);
  files.push("contentScript.js");

  const keys = new Set();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(/\bt(?:Html)?\(\s*"([a-zA-Z][\w.]*)"\s*[,)]/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
};

test("English and Chinese message sets stay in sync", () => {
  const en = Object.keys(messages.en).sort();
  const zh = Object.keys(messages["zh-CN"]).sort();
  const missingInZh = en.filter((key) => !zh.includes(key));
  const missingInEn = zh.filter((key) => !en.includes(key));
  assert.deepEqual(missingInZh, [], `missing zh-CN keys: ${missingInZh.join(", ")}`);
  assert.deepEqual(missingInEn, [], `missing en keys: ${missingInEn.join(", ")}`);
});

test("every statically referenced translation key exists", () => {
  const keys = collectReferencedKeys();
  assert.equal(keys.length > 100, true);
  const missing = keys.filter((key) => !messages.en[key] || !messages["zh-CN"][key]);
  assert.deepEqual(missing, [], `unknown keys: ${missing.join(", ")}`);
});

test("interpolation placeholders match between locales", () => {
  const placeholders = (value) =>
    [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const mismatched = [];
  for (const [key, value] of Object.entries(messages.en)) {
    const zh = messages["zh-CN"][key];
    if (typeof zh !== "string") continue;
    if (placeholders(value).join(",") !== placeholders(zh).join(",")) {
      mismatched.push(key);
    }
  }
  assert.deepEqual(mismatched, []);
});
test("HTML translations escape dynamic values while text translations stay readable", () => {
  const { t, tHtml, i18nState } = sandbox.i18nTest;
  i18nState.locale = "en";
  const value = '<img src=x onerror="x">&';
  assert(t("exportSelection.cacheNotice", { time: value }).includes(value));
  assert(!tHtml("exportSelection.cacheNotice", { time: value }).includes("<img"));
  assert(tHtml("exportSelection.cacheNotice", { time: value }).includes("&lt;img"));
});
