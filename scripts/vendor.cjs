const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
fs.mkdirSync(path.join(root, "vendor"), { recursive: true });
for (const [source, target] of [
  ["umd/index.js", "fflate.js"],
  ["LICENSE", "fflate.LICENSE"],
]) {
  fs.copyFileSync(
    path.join(root, "node_modules/fflate", source),
    path.join(root, "vendor", target),
  );
}
