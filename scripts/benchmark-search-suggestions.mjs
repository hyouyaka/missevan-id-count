import { performance } from "node:perf_hooks";
import { loadLocalEnv } from "../envConfig.js";
import { createUpstashRestClient } from "../shared/upstashRestClient.js";
import { buildCvCatalog, parseCvIdMapSnapshot, parseManboInfoSnapshotPreservingCvIds } from "../shared/cvProfileUtils.js";
import { buildSearchSuggestionIndex, matchSearchSuggestions, createSearchSuggestionService } from "../server/services/searchSuggestionService.js";

// Read-only benchmark against the configured library snapshots; never print credentials or bodies.
await loadLocalEnv();
const client = createUpstashRestClient();
if (!client.enabled) throw new Error("A configured Upstash library is required for this benchmark.");
const raw = await client.command(["MGET", "missevan:info:v2", "manbo:info:v2", "cvid-map:v1"], { timeoutMs: 15_000 });
if (raw.some((value) => typeof value !== "string")) throw new Error("Library snapshots are unavailable.");
const missevanSnapshot = JSON.parse(raw[0]);
const missevanRecords = Object.values(missevanSnapshot).flatMap((node) =>
  node?.dramaId ? [node] : Object.values(node || {}).filter((record) => record?.dramaId));
const manboRecords = parseManboInfoSnapshotPreservingCvIds(raw[1]).records || [];
const cvInfoRecords = parseCvIdMapSnapshot(raw[2]).records;
const catalogStart = performance.now();
const cvCatalog = buildCvCatalog({ missevanRecords, manboRecords, cvInfoRecords });
const catalogMs = performance.now() - catalogStart;
const sources = { missevanRecords, manboRecords, cvCatalog };
const indexStart = performance.now();
const index = buildSearchSuggestionIndex(sources);
const indexMs = performance.now() - indexStart;
const queries = ["魔", "路", "天", "lu", "lzx", "不存在的作品", ...index.slice(0, 30).map((entry) => entry.suggestion.name.slice(0, 2))];
const samples = [];
for (let round = 0; round < 10; round++) {
  for (const query of queries) {
    const start = performance.now();
    matchSearchSuggestions(index, query);
    samples.push(performance.now() - start);
  }
}
samples.sort((a, b) => a - b);
const service = createSearchSuggestionService();
service.search("魔", sources);
const cachedStart = performance.now();
for (let i = 0; i < 1000; i++) service.search("魔", sources);
console.log(JSON.stringify({
  records: { missevan: missevanRecords.length, manbo: manboRecords.length, cv: cvCatalog.length },
  catalogMs: +catalogMs.toFixed(2), indexMs: +indexMs.toFixed(2), samples: samples.length,
  queryP95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(2),
  queryMaxMs: +samples.at(-1).toFixed(2),
  cachedMeanMs: +((performance.now() - cachedStart) / 1000).toFixed(4),
}));
