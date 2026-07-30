import { loadLocalEnv } from "../envConfig.js";
import {
  normalizeCvPlatformId,
  parseCvIdMapSnapshot,
  parseManboInfoSnapshotPreservingCvIds,
} from "../shared/cvProfileUtils.js";
import { createUpstashRestClient } from "../shared/upstashRestClient.js";

await loadLocalEnv({ projectRoot: process.cwd() });

const client = createUpstashRestClient();
if (!client.enabled) {
  throw new Error("Upstash Redis is not configured");
}

const [rawCvMap, rawManboInfo] = await client.command([
  "MGET",
  "cvid-map:v1",
  "manbo:info:v2",
]);
if (typeof rawCvMap !== "string" || typeof rawManboInfo !== "string") {
  throw new Error("CV ID diagnostics require cvid-map:v1 and manbo:info:v2");
}

const cvSnapshot = parseCvIdMapSnapshot(rawCvMap);
const manboSnapshot = parseManboInfoSnapshotPreservingCvIds(rawManboInfo);
const manboRecords = Array.isArray(manboSnapshot?.records)
  ? manboSnapshot.records
  : [];
const canonicalNameCounts = new Map();
cvSnapshot.records.forEach((record) => {
  const name = String(record?.name ?? "").trim();
  if (name) {
    canonicalNameCounts.set(name, (canonicalNameCounts.get(name) || 0) + 1);
  }
});
const duplicateCanonicalNameCount = Array.from(canonicalNameCounts.values())
  .filter((count) => count > 1).length;
const unsafeLimit = BigInt(Number.MAX_SAFE_INTEGER);
let partialCanonicalNameCount = 0;
let unsafeManboCvIdCount = 0;
let invalidManboCvIdCount = 0;

manboRecords.forEach((record) => {
  const names = Array.isArray(record?.mainCvNames) ? record.mainCvNames : [];
  const nicknames = Array.isArray(record?.mainCvNicknames) ? record.mainCvNicknames : [];
  const ids = Array.isArray(record?.mainCvIds) ? record.mainCvIds : [];
  const tupleCount = Math.max(names.length, nicknames.length, ids.length);
  let hasPartialCanonicalName = false;
  for (let index = 0; index < tupleCount; index += 1) {
    const name = String(names[index] ?? "").trim();
    const nickname = String(nicknames[index] ?? "").trim();
    const rawId = ids[index];
    const id = normalizeCvPlatformId(rawId);
    if (!name && (nickname || id)) {
      hasPartialCanonicalName = true;
    }
    if (rawId !== null && rawId !== undefined && String(rawId).trim() && !id) {
      invalidManboCvIdCount += 1;
    } else if (id && BigInt(id) > unsafeLimit) {
      unsafeManboCvIdCount += 1;
    }
  }
  if (hasPartialCanonicalName) {
    partialCanonicalNameCount += 1;
  }
});

console.log(JSON.stringify({
  cvRecordCount: cvSnapshot.records.length,
  duplicateCanonicalNameCount,
  ...cvSnapshot.diagnostics,
  manboRecordCount: manboRecords.length,
  partialCanonicalNameCount,
  unsafeManboCvIdCount,
  invalidManboCvIdCount,
}, null, 2));
