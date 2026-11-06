const fs = require("node:fs");
const path = require("node:path");
const { zipSync } = require("fflate");
const root = path.join(__dirname, "..");
const files = {};
function add(relative) {
  const absolute = path.join(root, relative);
  if (fs.lstatSync(absolute).isDirectory()) {
    for (const child of fs.readdirSync(absolute)) add(`${relative}/${child}`);
  } else if (fs.lstatSync(absolute).isFile())
    files[relative] = fs.readFileSync(absolute);
}
for (const entry of [
  "manifest.json",
  "styles.css",
  "core",
  "utils",
  "features",
  "ui",
  "vendor",
  "image",
  "contentScript.js",
  "LICENSE",
  "README.md",
  "README.en.md",
  "docs/image-export.md",
  "docs/reliability.md",
])
  add(entry);
const manifest = JSON.parse(files["manifest.json"]);
for (const script of manifest.content_scripts.flatMap((entry) => [
  ...(entry.js || []),
  ...(entry.css || []),
])) {
  if (!files[script])
    throw new Error(`Missing extension dependency: ${script}`);
}
const destination = path.join(
  root,
  "output",
  "GPT-Conversation-Toolkit-image-export-preview.zip",
);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, zipSync(files, { level: 6 }));
console.log(destination);
