import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = process.cwd();
const manifestPath = path.join(root, "dist", ".vite", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const toolViewSource = await readFile(path.join(root, "src", "app", "ToolView.jsx"), "utf8");
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

const reachableDynamicImports = new Set();
const reachableModules = new Set();
function visitReachable(key) {
  if (reachableModules.has(key)) {
    return;
  }
  reachableModules.add(key);
  for (const dependency of manifest[key]?.imports || []) {
    visitReachable(dependency);
  }
  for (const dependency of manifest[key]?.dynamicImports || []) {
    reachableDynamicImports.add(dependency);
    visitReachable(dependency);
  }
}
visitReachable(entryKey);

const forbiddenStaticModules = [
  "src/app/RankTrendDialog.jsx",
  "src/app/rankTrendUi.jsx",
  "src/app/rankTrendChartUtils.js",
  "src/app/SearchWorkspace.jsx",
  "src/app/SearchResults.jsx",
  "src/app/OutputPanel.jsx",
  "src/app/FavoritesPanel.jsx",
  "src/app/CvProfileView.jsx",
];
for (const moduleId of forbiddenStaticModules) {
  if (visited.has(moduleId)) {
    throw new Error(`Homepage entry statically imports ${moduleId}`);
  }
}

if (!toolViewSource.includes('import { SearchPanel } from "@/app/SearchPanel";')) {
  throw new Error("SearchPanel must remain statically loaded by ToolView");
}
if (/lazy\([^)]*SearchPanel|import\("@\/app\/SearchPanel"\)/s.test(toolViewSource)) {
  throw new Error("SearchPanel must not be lazy loaded");
}

for (const dynamicName of ["SearchWorkspace", "FavoritesPanel", "CvProfileView"]) {
  const dynamicEntry = Object.entries(manifest).find(
    ([, value]) => value?.name === dynamicName && value?.isDynamicEntry
  );
  if (!dynamicEntry) {
    throw new Error(`${dynamicName} must be emitted as a dynamic entry`);
  }
  if (!reachableDynamicImports.has(dynamicEntry[0])) {
    throw new Error(`Homepage entry must load ${dynamicName} dynamically`);
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
const p2BaselineGzipBytes = 73725;
const p2TargetGzipBytes = Math.floor(p2BaselineGzipBytes * 0.9);
if (gzipBytes > maxGzipBytes) {
  throw new Error(
    `Homepage entry gzip size ${gzipBytes} exceeds budget ${maxGzipBytes}`
  );
}
if (gzipBytes > p2TargetGzipBytes) {
  throw new Error(
    `Homepage entry gzip size ${gzipBytes} misses the P2 10% reduction target ${p2TargetGzipBytes}`
  );
}

console.log(
  `bundle boundaries ok: entry=${manifest[entryKey].file} gzip=${gzipBytes} bytes baseline=${p2BaselineGzipBytes} bytes`
);
