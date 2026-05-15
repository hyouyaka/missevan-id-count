import { pinyin } from "pinyin-pro";
import { normalizeSearchText } from "./searchUtils.js";

function normalizePinyinToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function flattenSearchValues(values) {
  return (Array.isArray(values) ? values : [values]).flatMap((value) =>
    Array.isArray(value) ? flattenSearchValues(value) : [value]
  );
}

export function buildPinyinSearchTokens(value) {
  const text = String(value ?? "").trim();
  if (!text || !/\p{Script=Han}/u.test(text)) {
    return [];
  }

  const full = normalizePinyinToken(
    pinyin(text, { toneType: "none", type: "array" }).join("")
  );
  const initials = normalizePinyinToken(
    pinyin(text, { toneType: "none", pattern: "first", type: "array" }).join("")
  );

  return Array.from(
    new Set([normalizeSearchText(full), normalizeSearchText(initials)].filter(Boolean))
  );
}

export function buildPinyinFullSearchTokens(value) {
  const text = String(value ?? "").trim();
  if (!text || !/\p{Script=Han}/u.test(text)) {
    return [];
  }

  const full = normalizePinyinToken(
    pinyin(text, { toneType: "none", type: "array" }).join("")
  );
  return full ? [normalizeSearchText(full)].filter(Boolean) : [];
}

export function buildCombinedPinyinSearchTokens(values) {
  return Array.from(
    new Set(flattenSearchValues(values).flatMap(buildPinyinSearchTokens).filter(Boolean))
  );
}
