import { pinyin } from "pinyin-pro";
import {
  normalizeSearchText,
  stripSearchSeasonSuffix,
} from "./searchUtils.js";

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

const PINYIN_WORD_SEPARATOR_PATTERN =
  /[\s/／\\＼|｜,_\-+~`!@#$%^&*()[\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】·•‧・—–…]+/u;
const HAN_CHAR_PATTERN = /\p{Script=Han}/u;
const LATIN_WORD_CHAR_PATTERN = /[a-z0-9]/i;

function buildPinyinSyllables(value) {
  const text = String(value ?? "").trim();
  if (!text || !HAN_CHAR_PATTERN.test(text)) {
    return [];
  }

  const pinyinItems = pinyin(text, { toneType: "none", type: "array" });
  const syllables = [];
  let latinBuffer = "";

  function flushLatinBuffer() {
    const token = normalizePinyinToken(latinBuffer);
    if (token) {
      syllables.push(token);
    }
    latinBuffer = "";
  }

  Array.from(text).forEach((char, index) => {
    if (HAN_CHAR_PATTERN.test(char)) {
      flushLatinBuffer();
      const token = normalizePinyinToken(pinyinItems[index] || char);
      if (token) {
        syllables.push(token);
      }
      return;
    }

    if (LATIN_WORD_CHAR_PATTERN.test(char)) {
      latinBuffer += char;
      return;
    }

    flushLatinBuffer();
  });

  flushLatinBuffer();
  return syllables;
}

function buildPinyinInitials(syllables) {
  return normalizeSearchText(
    (Array.isArray(syllables) ? syllables : [])
      .map((item) => String(item ?? "")[0] || "")
      .join("")
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

export function buildPinyinSearchUnits(value, options = {}) {
  const rawText = String(value ?? "").trim();
  const text = options?.stripSeasonSuffix
    ? stripSearchSeasonSuffix(rawText)
    : rawText;
  if (!text || !/\p{Script=Han}/u.test(text)) {
    return [];
  }

  return text
    .split(PINYIN_WORD_SEPARATOR_PATTERN)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => {
      const syllables = buildPinyinSyllables(word);
      if (!syllables.length) {
        return null;
      }
      return {
        syllables,
        full: normalizeSearchText(syllables.join("")),
        initials: buildPinyinInitials(syllables),
      };
    })
    .filter(Boolean);
}

export function buildCombinedPinyinSearchTokens(values) {
  return Array.from(
    new Set(flattenSearchValues(values).flatMap(buildPinyinSearchTokens).filter(Boolean))
  );
}

export function buildCombinedPinyinSearchUnits(values, options = {}) {
  return flattenSearchValues(values).flatMap((value) =>
    buildPinyinSearchUnits(value, options)
  );
}
