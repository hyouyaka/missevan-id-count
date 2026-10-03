import { getDramaSearchAliases, normalizeSearchText } from "../../shared/searchUtils.js";
import { buildPinyinSearchTokens } from "../../shared/pinyinSearchUtils.js";
import { getSearchSuggestionKeyword } from "../../shared/searchSuggestionUtils.js";
import { TtlLruCache } from "../../shared/ttlLruCache.js";

const sourceOrder = { cv: 0, missevan: 1, manbo: 2 };
const compareNames = new Intl.Collator("zh-Hans-CN").compare;

function prepareEntry(suggestion, names) {
  const textTokens = [...new Set(names.map(normalizeSearchText).filter(Boolean))];
  const pinyinTokens = [...new Set(names.flatMap(buildPinyinSearchTokens))];
  return { suggestion, textTokens, pinyinTokens };
}

function getMainCvNames(record, platform) {
  const names = platform === "missevan"
    ? (Array.isArray(record?.maincvs) ? record.maincvs : []).map((id) => record?.cvnames?.[String(id)])
    : Array.isArray(record?.mainCvNames) && record.mainCvNames.some((name) => String(name ?? "").trim())
      ? record.mainCvNames : record?.mainCvNicknames || [];
  return [...new Set(names.filter((name) => typeof name === "string").map((name) => name.trim()).filter(Boolean))];
}

export function buildSearchSuggestionIndex({
  missevanRecords = [], manboRecords = [], cvCatalog = [],
  getMissevanContentTypeLabel = () => "", getManboContentTypeLabel = () => "",
} = {}) {
  const entries = new Map();
  for (const [platform, records, labelFor] of [
    ["missevan", missevanRecords, getMissevanContentTypeLabel],
    ["manbo", manboRecords, getManboContentTypeLabel],
  ]) {
    for (const record of records) {
      const id = String(record?.dramaId ?? "").trim();
      const name = String(platform === "missevan" ? record?.title ?? "" : record?.name ?? "").trim();
      if (!/^\d+$/.test(id) || !name) continue;
      const key = `${platform}:${id}`;
      if (entries.has(key)) continue;
      entries.set(key, prepareEntry({
        key, type: "drama", platform, id, name, contentTypeLabel: labelFor(record),
        cover: String(record?.cover ?? "").trim(), mainCvNames: getMainCvNames(record, platform),
      }, [name, String(record?.seriesTitle ?? "").trim(), ...getDramaSearchAliases(record)]));
    }
  }
  for (const cv of cvCatalog) {
    const profileId = String(cv?.profileId ?? "").trim();
    const name = String(cv?.name ?? "").trim();
    if (!profileId || !name) continue;
    const key = `cv:${profileId}`;
    if (entries.has(key)) continue;
    entries.set(key, prepareEntry({ key, type: "cv", name, profileId, avatar: String(cv?.avatar ?? "").trim() }, [name, ...(cv.aliases || [])]));
  }
  return [...entries.values()];
}

export function matchSearchSuggestions(index, keyword) {
  const query = normalizeSearchText(getSearchSuggestionKeyword(keyword));
  if (!query) return [];
  const allowPinyin = /^[a-z0-9]+$/.test(query);
  const matches = [];
  for (const entry of index) {
    let rank = Infinity;
    for (const text of entry.textTokens) {
      if (text === query) rank = 0;
      else if (text.startsWith(query)) rank = Math.min(rank, 1);
      else if (text.includes(query)) rank = Math.min(rank, 2);
    }
    if (rank === Infinity && allowPinyin && entry.pinyinTokens.some((text) => text.includes(query))) rank = 3;
    if (rank !== Infinity) matches.push({ suggestion: entry.suggestion, rank });
  }
  matches.sort((a, b) => a.rank - b.rank ||
    Array.from(a.suggestion.name).length - Array.from(b.suggestion.name).length ||
    compareNames(a.suggestion.name, b.suggestion.name) ||
    sourceOrder[a.suggestion.platform || "cv"] - sourceOrder[b.suggestion.platform || "cv"] ||
    a.suggestion.key.localeCompare(b.suggestion.key));
  return matches.slice(0, 5).map(({ suggestion }) => suggestion);
}

export function createSearchSuggestionService({ now = Date.now } = {}) {
  let snapshots = null;
  let index = [];
  const cache = new TtlLruCache({ maxEntries: 200, ttlMs: 60_000, now });
  return {
    search(keyword, sources) {
      const nextSnapshots = [sources.missevanRecords, sources.manboRecords, sources.cvCatalog];
      if (!snapshots || nextSnapshots.some((snapshot, i) => snapshot !== snapshots[i])) {
        index = buildSearchSuggestionIndex(sources);
        snapshots = nextSnapshots;
        cache.clear();
      }
      const query = getSearchSuggestionKeyword(keyword).toLowerCase();
      if (!query) return [];
      const cached = cache.get(query);
      if (cached !== undefined) return cached;
      const result = matchSearchSuggestions(index, query);
      cache.set(query, result);
      return result;
    },
  };
}
