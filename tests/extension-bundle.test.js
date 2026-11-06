const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const contentScripts = manifest.content_scripts
  .flatMap((entry) => entry.js || [])
  .filter((file) => !file.startsWith("vendor/"));

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Content scripts share one global scope: a duplicate top-level binding in two
// files breaks the whole extension at load time, so it has to fail here.
test("all content scripts share one scope without duplicate declarations", () => {
  const seen = new Map();
  const duplicates = [];

  for (const file of contentScripts) {
    const source = read(file);
    const pattern = /^(?:const|let|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm;
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      const previous = seen.get(name);
      if (previous && previous !== file) {
        duplicates.push(`${name} (${previous} and ${file})`);
      } else {
        seen.set(name, file);
      }
    }
  }

  assert.deepEqual(duplicates, []);
});

test("the concatenated bundle parses in manifest order", () => {
  const source = contentScripts.map(read).join("\n;\n");
  assert.doesNotThrow(() => new vm.Script(source, { filename: "bundle.js" }));
});

test("every referenced content script exists", () => {
  for (const file of manifest.content_scripts.flatMap((entry) => entry.js || [])) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} is missing`);
  }
});