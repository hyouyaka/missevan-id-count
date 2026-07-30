import {
  buildPinyinFullSearchTokens,
  buildPinyinSearchTokens,
} from "./pinyinSearchUtils.js";
import { canonicalizeCompatibleSearchText } from "./searchCompatibility.js";
import { normalizeSearchText } from "./searchUtils.js";

function normalizeName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(value) {
  return normalizeSearchText(canonicalizeCompatibleSearchText(normalizeName(value)));
}

function uniqueNames(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(normalizeName)
    .filter((value) => {
      const key = normalizeNameKey(value);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function normalizeCvPlatformId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
  }
  if (typeof value === "bigint") {
    return value > 0n ? value.toString() : "";
  }
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    return "";
  }
  try {
    const parsed = BigInt(normalized);
    return parsed > 0n ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function buildMappedIdentityKeys(platformIds = {}) {
  return ["missevan", "manbo"].flatMap((platform) =>
    (Array.isArray(platformIds[platform]) ? platformIds[platform] : [])
      .map(normalizeCvPlatformId)
      .filter(Boolean)
      .map((id) => `mapped:${platform}:${id}`)
  );
}

function buildMappedProfileId(platformIds = {}) {
  const missevanId = (Array.isArray(platformIds.missevan) ? platformIds.missevan : [])
    .map(normalizeCvPlatformId)
    .find(Boolean);
  if (missevanId) {
    return `mapped:missevan:${missevanId}`;
  }
  const manboId = (Array.isArray(platformIds.manbo) ? platformIds.manbo : [])
    .map(normalizeCvPlatformId)
    .find(Boolean);
  return manboId ? `mapped:manbo:${manboId}` : "";
}

function quoteJsonIntegerField(source, field) {
  const pattern = new RegExp(`("${field}"\\s*:\\s*)(-?\\d+)`, "g");
  return source.replace(pattern, '$1"$2"');
}

function quoteJsonIntegerArrayField(source, field) {
  const pattern = new RegExp(`("${field}"\\s*:\\s*)\\[([^\\]]*)\\]`, "g");
  return source.replace(pattern, (match, prefix, body) => {
    const protectedBody = body.replace(
      /(^|,)(\s*)(-?\d+)(\s*)(?=,|$)/g,
      '$1$2"$3"$4'
    );
    return `${prefix}[${protectedBody}]`;
  });
}

export function parseManboInfoSnapshotPreservingCvIds(raw) {
  const source = quoteJsonIntegerArrayField(String(raw ?? ""), "mainCvIds");
  return JSON.parse(source);
}

function compareCvInfoCanonicalCandidates(left, right) {
  const leftCoverage = ["missevan", "manbo"]
    .filter((platform) => left.platformIds[platform].length > 0).length;
  const rightCoverage = ["missevan", "manbo"]
    .filter((platform) => right.platformIds[platform].length > 0).length;
  return (
    rightCoverage - leftCoverage ||
    Number(right.platformIds.missevan.length > 0) -
      Number(left.platformIds.missevan.length > 0) ||
    right.aliases.length - left.aliases.length ||
    left.name.localeCompare(right.name, "zh-Hans-CN") ||
    left.sourceIndex - right.sourceIndex
  );
}

function consolidateCvInfoRecords(records) {
  const parents = records.map((_, index) => index);
  const find = (index) => {
    let current = index;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]];
      current = parents[current];
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents[rightRoot] = leftRoot;
    }
  };
  const platformIdOwners = new Map();
  const duplicatePlatformIds = new Set();

  records.forEach((record, index) => {
    ["missevan", "manbo"].forEach((platform) => {
      record.platformIds[platform].forEach((id) => {
        const key = `${platform}:${id}`;
        const owner = platformIdOwners.get(key);
        if (owner === undefined) {
          platformIdOwners.set(key, index);
          return;
        }
        duplicatePlatformIds.add(key);
        union(owner, index);
      });
    });
  });

  const groups = new Map();
  records.forEach((record, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), record]);
  });

  const consolidated = Array.from(groups.values()).map((members) => {
    const sortedMembers = [...members].sort(compareCvInfoCanonicalCandidates);
    const canonical = sortedMembers[0];
    const platformIds = {
      missevan: Array.from(new Set(sortedMembers.flatMap((record) => record.platformIds.missevan))),
      manbo: Array.from(new Set(sortedMembers.flatMap((record) => record.platformIds.manbo))),
    };
    const aliases = uniqueNames(
      members.flatMap((record) => [record.name, ...record.aliases])
    ).filter((alias) => normalizeNameKey(alias) !== normalizeNameKey(canonical.name));
    const profileId = buildMappedProfileId(platformIds);
    return {
      profileId,
      identityKeys: Array.from(new Set([
        profileId,
        ...buildMappedIdentityKeys(platformIds),
      ].filter(Boolean))),
      name: canonical.name,
      avatar: canonical.avatar ||
        sortedMembers.map((record) => record.avatar).find(Boolean) ||
        "",
      aliases,
      platformIds,
    };
  });

  return {
    records: consolidated,
    duplicatePlatformIds: Array.from(duplicatePlatformIds).sort(),
  };
}

export function parseCvIdMapSnapshot(raw) {
  let source = String(raw ?? "");
  source = quoteJsonIntegerField(source, "missevanCvId");
  source = quoteJsonIntegerField(source, "manboCvId");
  const parsed = JSON.parse(source);
  let invalidIdCount = 0;
  let noIdRecordCount = 0;
  const normalizedRecords = Object.entries(
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  )
    .map(([mapName, record], sourceIndex) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        return null;
      }
      const name = normalizeName(record.displayName || mapName);
      if (!name) {
        return null;
      }
      const missevanId = normalizeCvPlatformId(record.missevanCvId);
      const manboId = normalizeCvPlatformId(record.manboCvId);
      [record.missevanCvId, record.manboCvId].forEach((value, index) => {
        if (
          value !== null &&
          value !== undefined &&
          String(value).trim() &&
          !(index === 0 ? missevanId : manboId)
        ) {
          invalidIdCount += 1;
        }
      });
      const platformIds = {
        missevan: missevanId ? [missevanId] : [],
        manbo: manboId ? [manboId] : [],
      };
      const profileId = buildMappedProfileId(platformIds);
      if (!profileId) {
        noIdRecordCount += 1;
        return null;
      }
      return {
        profileId,
        identityKeys: buildMappedIdentityKeys(platformIds),
        name,
        avatar: normalizeName(record.avatar),
        aliases: uniqueNames(record.aliases),
        platformIds,
        sourceIndex,
      };
    })
    .filter(Boolean);
  const consolidated = consolidateCvInfoRecords(normalizedRecords);
  return {
    schemaVersion: 1,
    records: consolidated.records,
    diagnostics: {
      duplicatePlatformIdCount: consolidated.duplicatePlatformIds.length,
      duplicatePlatformIds: consolidated.duplicatePlatformIds,
      invalidIdCount,
      noIdRecordCount,
    },
  };
}

function normalizeCvInfoRecords(records) {
  const normalized = (Array.isArray(records) ? records : [])
    .map((record, sourceIndex) => {
      const name = normalizeName(record?.name);
      if (!name) {
        return null;
      }
      const platformIds = {
        missevan: Array.from(
          new Set((Array.isArray(record?.platformIds?.missevan) ? record.platformIds.missevan : [])
            .map(normalizeCvPlatformId)
            .filter(Boolean))
        ),
        manbo: Array.from(
          new Set((Array.isArray(record?.platformIds?.manbo) ? record.platformIds.manbo : [])
            .map(normalizeCvPlatformId)
            .filter(Boolean))
        ),
      };
      const profileId = buildMappedProfileId(platformIds);
      if (!profileId) {
        return null;
      }
      return {
        profileId,
        identityKeys: Array.from(new Set([
          ...(Array.isArray(record?.identityKeys) ? record.identityKeys : []),
          ...buildMappedIdentityKeys(platformIds),
        ].map((value) => String(value ?? "").trim()).filter(Boolean))),
        name,
        avatar: normalizeName(record?.avatar),
        aliases: uniqueNames(record?.aliases).filter(
          (alias) => normalizeNameKey(alias) !== normalizeNameKey(name)
        ),
        platformIds,
        sourceIndex,
      };
    })
    .filter(Boolean);
  return consolidateCvInfoRecords(normalized).records;
}

function getMissevanCvIdentities(record) {
  const cvNames = record?.cvnames && typeof record.cvnames === "object"
    ? record.cvnames
    : {};
  const mainIds = Array.isArray(record?.maincvs) ? record.maincvs : [];
  const identities = mainIds
    .map((id) => ({
      name: normalizeName(cvNames[String(id)]),
      aliases: [],
      platformId: normalizeCvPlatformId(id),
    }))
    .filter((identity) => identity.name);
  return identities;
}

function getManboCvIdentities(record) {
  const names = (Array.isArray(record?.mainCvNames) ? record.mainCvNames : []).map(normalizeName);
  const nicknames = (Array.isArray(record?.mainCvNicknames) ? record.mainCvNicknames : []).map(normalizeName);
  const ids = (Array.isArray(record?.mainCvIds) ? record.mainCvIds : [])
    .map(normalizeCvPlatformId);
  const tupleCount = Math.max(names.length, nicknames.length, ids.length);
  const seen = new Set();
  return Array.from({ length: tupleCount }, (_, index) => {
    const name = names[index] || nicknames[index] || "";
    const nickname = nicknames[index] || "";
    return {
      name,
      aliases:
        nickname && normalizeNameKey(nickname) !== normalizeNameKey(name)
          ? [nickname]
          : [],
      platformId: ids[index] || "",
    };
  }).filter((identity) => {
    const nameKey = normalizeNameKey(identity.name);
    const tupleKey = `${nameKey}\0${identity.platformId}`;
    if (!nameKey || seen.has(tupleKey)) {
      return false;
    }
    seen.add(tupleKey);
    return true;
  });
}

function getRecordCvIdentities(platform, record) {
  return platform === "manbo"
    ? getManboCvIdentities(record)
    : getMissevanCvIdentities(record);
}

function getRecordTitle(platform, record) {
  return normalizeName(platform === "manbo" ? record?.name : record?.title);
}

function getRecordId(record) {
  return normalizeCvPlatformId(record?.dramaId);
}

function getRecordCategory(platform, record) {
  if (platform === "missevan") {
    const catalog = Number(record?.catalog ?? 0);
    if ([89, 90].includes(catalog)) {
      return "radio_drama";
    }
    return catalog === 93 ? "audio_drama" : "";
  }
  const catalogName = normalizeName(record?.catalogName);
  if (catalogName.includes("广播剧")) {
    return "radio_drama";
  }
  return catalogName.includes("有声剧") || catalogName.includes("有声书")
    ? "audio_drama"
    : "";
}

export function buildCvCatalog({
  missevanRecords = [],
  manboRecords = [],
  cvInfoRecords = [],
} = {}) {
  const catalog = new Map();
  const normalizedCvInfo = normalizeCvInfoRecords(cvInfoRecords);
  const cvInfoByPlatformId = new Map();

  normalizedCvInfo.forEach((record) => {
    ["missevan", "manbo"].forEach((platform) => {
      record.platformIds[platform].forEach((id) => {
        cvInfoByPlatformId.set(`${platform}:${id}`, record);
      });
    });
  });

  function addRecords(platform, records) {
    (Array.isArray(records) ? records : []).forEach((record) => {
      const id = getRecordId(record);
      if (!id || !getRecordTitle(platform, record)) {
        return;
      }
      getRecordCvIdentities(platform, record).forEach((identity) => {
        const cvInfo = identity.platformId
          ? cvInfoByPlatformId.get(`${platform}:${identity.platformId}`) || null
          : null;
        const canonicalName = cvInfo?.name || identity.name;
        const canonicalKey = normalizeNameKey(canonicalName);
        if (!canonicalKey) {
          return;
        }
        const key = cvInfo
          ? cvInfo.profileId
          : identity.platformId
            ? `${platform}:id:${identity.platformId}`
            : `${platform}:name:${canonicalKey}`;
        const current = catalog.get(key) || {
          profileId: key,
          identityKeys: new Set(cvInfo?.identityKeys || [key]),
          name: canonicalName,
          avatar: cvInfo?.avatar || "",
          aliases: new Set(),
          platformIds: {
            missevan: new Set(),
            manbo: new Set(),
          },
          works: {
            missevan: new Set(),
            manbo: new Set(),
          },
        };
        const currentNameKey = normalizeNameKey(current.name);
        if (!current.avatar && cvInfo?.avatar) {
          current.avatar = cvInfo.avatar;
        }
        (cvInfo?.identityKeys || []).forEach((identityKey) => {
          const normalizedIdentityKey = String(identityKey ?? "").trim();
          if (normalizedIdentityKey) {
            current.identityKeys.add(normalizedIdentityKey);
          }
        });
        uniqueNames([
          ...(cvInfo?.aliases || []),
          identity.name,
          ...identity.aliases,
        ]).forEach((alias) => {
          if (normalizeNameKey(alias) !== currentNameKey) {
            current.aliases.add(alias);
          }
        });
        if (identity.platformId) {
          current.platformIds[platform].add(identity.platformId);
        }
        current.works[platform].add(id);
        catalog.set(key, current);
      });
    });
  }

  addRecords("missevan", missevanRecords);
  addRecords("manbo", manboRecords);

  return Array.from(catalog.values()).map((entry) => ({
    profileId: entry.profileId,
    identityKeys: Array.from(entry.identityKeys),
    name: entry.name,
    avatar: entry.avatar,
    aliases: Array.from(entry.aliases),
    platformIds: {
      missevan: Array.from(entry.platformIds.missevan),
      manbo: Array.from(entry.platformIds.manbo),
    },
    workIds: {
      missevan: Array.from(entry.works.missevan),
      manbo: Array.from(entry.works.manbo),
    },
    missevanWorkCount: entry.works.missevan.size,
    manboWorkCount: entry.works.manbo.size,
    workCount: entry.works.missevan.size + entry.works.manbo.size,
  }));
}

function getCvMatchScore(entry, keyword) {
  const query = normalizeNameKey(keyword);
  if (!query) {
    return { score: 0, exactMatch: false };
  }
  const queryPinyinTokens = /\p{Script=Han}/u.test(String(keyword ?? ""))
    ? buildPinyinFullSearchTokens(keyword)
    : [query];
  const values = uniqueNames([entry?.name, ...(entry?.aliases || [])]);
  let score = 0;
  let exactMatch = false;
  values.forEach((value) => {
    const key = normalizeNameKey(value);
    if (key === query) {
      score = Math.max(score, 1000);
      exactMatch = true;
    } else if (key.startsWith(query)) {
      score = Math.max(score, 800);
    } else if (key.includes(query)) {
      score = Math.max(score, 600);
    }
    buildPinyinSearchTokens(value).forEach((token) => {
      queryPinyinTokens.forEach((queryToken) => {
        if (token === queryToken) {
          score = Math.max(score, 900);
          exactMatch = true;
        } else if (token.startsWith(queryToken)) {
          score = Math.max(score, 700);
        } else if (token.includes(queryToken)) {
          score = Math.max(score, 500);
        }
      });
    });
  });
  return { score, exactMatch };
}

export function searchCvCatalog(catalog, keyword, limit = 10) {
  const matched = (Array.isArray(catalog) ? catalog : [])
    .map((entry) => ({
      entry,
      ...getCvMatchScore(entry, keyword),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.entry.workCount ?? 0) - Number(left.entry.workCount ?? 0) ||
      String(left.entry.name).localeCompare(String(right.entry.name), "zh-Hans-CN")
    );
  const safeLimit = Math.max(1, Math.min(10, Math.floor(Number(limit) || 10)));
  return {
    results: matched.slice(0, safeLimit).map(({ entry }) => ({
      profileId: entry.profileId,
      name: entry.name,
      avatar: normalizeName(entry.avatar),
      missevanWorkCount: Number(entry.missevanWorkCount ?? 0) || 0,
      manboWorkCount: Number(entry.manboWorkCount ?? 0) || 0,
      workCount: Number(entry.workCount ?? 0) || 0,
    })),
    matchedCount: matched.length,
    exactMatch: Boolean(matched[0]?.exactMatch),
  };
}

export function resolveCvCatalogEntry(catalog, name, profileId = "") {
  const entries = Array.isArray(catalog) ? catalog : [];
  const normalizedProfileId = normalizeName(profileId);
  if (normalizedProfileId) {
    const profileMatches = entries.filter((entry) =>
      entry?.profileId === normalizedProfileId ||
      (Array.isArray(entry?.identityKeys) ? entry.identityKeys : [])
        .includes(normalizedProfileId)
    );
    if (profileMatches.length === 1) {
      return { entry: profileMatches[0], status: 200, code: "" };
    }
    if (profileMatches.length > 1) {
      return { entry: null, status: 409, code: "CV_IDENTITY_AMBIGUOUS" };
    }

    const rankWorkMatch = /^rank-work:(missevan|manbo):(\d+)$/.exec(normalizedProfileId);
    if (rankWorkMatch) {
      const [, platform, rawWorkId] = rankWorkMatch;
      const workId = normalizeCvPlatformId(rawWorkId);
      const requestedNameKey = normalizeNameKey(name);
      const workMatches = entries.filter((entry) => {
        const matchesName = requestedNameKey &&
          uniqueNames([entry?.name, ...(entry?.aliases || [])])
            .some((candidate) => normalizeNameKey(candidate) === requestedNameKey);
        return matchesName &&
          (Array.isArray(entry?.workIds?.[platform]) ? entry.workIds[platform] : [])
            .some((candidate) => normalizeCvPlatformId(candidate) === workId);
      });
      if (workMatches.length === 1) {
        return { entry: workMatches[0], status: 200, code: "" };
      }
      if (workMatches.length > 1) {
        return { entry: null, status: 409, code: "CV_IDENTITY_AMBIGUOUS" };
      }
    }
    return { entry: null, status: 404, code: "CV_IDENTITY_NOT_FOUND" };
  }

  const key = normalizeNameKey(name);
  if (!key) {
    return { entry: null, status: 404, code: "CV_IDENTITY_NOT_FOUND" };
  }
  const nameMatches = entries.filter((entry) =>
    uniqueNames([entry?.name, ...(entry?.aliases || [])])
      .some((candidate) => normalizeNameKey(candidate) === key)
  );
  if (nameMatches.length === 1) {
    return { entry: nameMatches[0], status: 200, code: "" };
  }
  return {
    entry: null,
    status: nameMatches.length > 1 ? 409 : 404,
    code: nameMatches.length > 1
      ? "CV_IDENTITY_AMBIGUOUS"
      : "CV_IDENTITY_NOT_FOUND",
  };
}

export function collectCvWorks({
  name,
  aliases = [],
  platformIds = {},
  workIds = null,
  missevanRecords = [],
  manboRecords = [],
} = {}) {
  if (!workIds || typeof workIds !== "object") {
    return [];
  }
  const identityNameKeys = new Set(
    uniqueNames([name, ...aliases]).map(normalizeNameKey)
  );
  const works = [];

  function addRecords(platform, records) {
    const assignedWorkIds = new Set(
      (Array.isArray(workIds?.[platform]) ? workIds[platform] : [])
        .map(normalizeCvPlatformId)
        .filter(Boolean)
    );
    const assignedPlatformIds = new Set(
      (Array.isArray(platformIds?.[platform]) ? platformIds[platform] : [])
        .map(normalizeCvPlatformId)
        .filter(Boolean)
    );
    (Array.isArray(records) ? records : []).forEach((record) => {
      const id = getRecordId(record);
      const identities = getRecordCvIdentities(platform, record);
      if (!assignedWorkIds.has(id)) {
        return;
      }
      const title = getRecordTitle(platform, record);
      if (!id || !title) {
        return;
      }
      const partners = uniqueNames(
        identities
          .filter((identity) => {
            if (identity.platformId && assignedPlatformIds.size) {
              return !assignedPlatformIds.has(identity.platformId);
            }
            return !uniqueNames([identity.name, ...identity.aliases])
              .some((candidate) => identityNameKeys.has(normalizeNameKey(candidate)));
          })
          .map((identity) => identity.name)
      );
      works.push({
        platform,
        id,
        title,
        cover: normalizeName(record?.cover),
        category: getRecordCategory(platform, record),
        needpay: record?.needpay === true,
        createTime: normalizeName(record?.createTime),
        partners,
      });
    });
  }

  addRecords("missevan", missevanRecords);
  addRecords("manbo", manboRecords);
  return works;
}

function getLatestPlaybackPoint(bundle, id) {
  const dates = Array.isArray(bundle?.dates) ? bundle.dates : [];
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const date = String(dates[index] ?? "").trim();
    const record = bundle?.snapshotsByDate?.[date]?.dramas?.[String(id)];
    const value = Number(record?.view_count ?? record?.watch_count ?? record?.play_count);
    if (date && Number.isFinite(value)) {
      return { date, value };
    }
  }
  return null;
}

export function buildCvProfileResponse({
  name,
  avatar = "",
  works = [],
  playbackBundles = {},
} = {}) {
  const normalizedWorks = (Array.isArray(works) ? works : []).map((work) => {
    const point = getLatestPlaybackPoint(playbackBundles?.[work.platform], work.id);
    return {
      platform: work.platform,
      id: String(work.id),
      title: normalizeName(work.title),
      cover: normalizeName(work.cover),
      category: ["radio_drama", "audio_drama"].includes(work.category)
        ? work.category
        : "",
      needpay: work?.needpay === true,
      createTime: normalizeName(work?.createTime),
      partners: uniqueNames(work.partners),
      playCount: point?.value ?? null,
      dataDate: point?.date ?? "",
    };
  });

  const freshness = {};
  ["missevan", "manbo"].forEach((platform) => {
    const platformWorks = normalizedWorks.filter((work) => work.platform === platform);
    const dates = platformWorks.map((work) => work.dataDate).filter(Boolean).sort();
    const latestDate = dates.at(-1) || "";
    freshness[platform] = {
      latestDate,
      staleWorkCount: latestDate
        ? platformWorks.filter((work) => work.dataDate && work.dataDate !== latestDate).length
        : 0,
    };
  });

  function sumPlatform(platform = "") {
    const values = normalizedWorks
      .filter((work) => !platform || work.platform === platform)
      .map((work) => work.playCount)
      .filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  }

  const availableWorkCount = normalizedWorks.filter((work) => Number.isFinite(work.playCount)).length;
  const stats = Object.fromEntries(
    ["missevan", "manbo"].map((platform) => {
      const platformWorks = normalizedWorks.filter((work) => work.platform === platform);
      return [
        platform,
        {
          workCount: platformWorks.length,
          playback: sumPlatform(platform),
          dataUpdatedAt: freshness[platform].latestDate,
          staleWorkCount: freshness[platform].staleWorkCount,
        },
      ];
    })
  );
  return {
    success: true,
    cv: {
      name: normalizeName(name),
      avatar: normalizeName(avatar),
    },
    stats,
    totals: {
      playback: sumPlatform(),
      missevanPlayback: sumPlatform("missevan"),
      manboPlayback: sumPlatform("manbo"),
      workCount: normalizedWorks.length,
      availableWorkCount,
      missingWorkCount: normalizedWorks.length - availableWorkCount,
    },
    freshness,
    works: normalizedWorks.sort((left, right) => {
      const leftMissing = !Number.isFinite(left.playCount);
      const rightMissing = !Number.isFinite(right.playCount);
      if (leftMissing !== rightMissing) {
        return leftMissing ? 1 : -1;
      }
      return Number(right.playCount ?? 0) - Number(left.playCount ?? 0) ||
        left.title.localeCompare(right.title, "zh-Hans-CN");
    }),
  };
}
