import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = process.cwd();
const manifestPath = path.join(root, "dist", ".vite", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
if (!entryKey) {
  throw new Error("Vite manifest does not contain an application entry");
}

const visited = new Set();
function visitStatic(key) {
  if (visited.has(key)) {
    return;
  }
  visited.add(key);
  for (const dependency of manifest[key]?.imports || []) {
    visitStatic(dependency);
  }
}
visitStatic(entryKey);

const reachableDynamicImports = new Set(
  [...visited].flatMap((key) => manifest[key]?.dynamicImports || [])
);

const forbiddenStaticModules = [
  "src/app/RankTrendDialog.jsx",
  "src/app/rankTrendUi.jsx",
  "src/app/rankTrendChartUtils.js",
];
for (const moduleId of forbiddenStaticModules) {
  if (visited.has(moduleId)) {
    throw new Error(`Homepage entry statically imports ${moduleId}`);
  }
}

const trendDialogEntry = Object.entries(manifest).find(
  ([, value]) => value?.name === "RankTrendDialog" && value?.isDynamicEntry
);
if (!trendDialogEntry) {
  throw new Error("RankTrendDialog must be emitted as a dynamic entry");
}
if (!reachableDynamicImports.has(trendDialogEntry[0])) {
  throw new Error("Homepage entry must load RankTrendDialog dynamically");
}

const twikooEntry = Object.entries(manifest).find(
  ([, value]) => value?.name === "twikoo" && !value?.isEntry
);
if (!twikooEntry) {
  throw new Error("Twikoo must be emitted as a dynamic entry");
}
if (visited.has(twikooEntry[0])) {
  throw new Error("Homepage entry must not statically import Twikoo");
}
if (!reachableDynamicImports.has(twikooEntry[0])) {
  throw new Error("Feedback view must load Twikoo dynamically");
}

const entryFile = path.join(root, "dist", manifest[entryKey].file);
const gzipBytes = gzipSync(await readFile(entryFile)).length;
const maxGzipBytes = Math.floor(79.99 * 1024);
if (gzipBytes > maxGzipBytes) {
  throw new Error(
    `Homepage entry gzip size ${gzipBytes} exceeds budget ${maxGzipBytes}`
  );
}

console.log(
  `bundle boundaries ok: entry=${manifest[entryKey].file} gzip=${gzipBytes} bytes`
);
