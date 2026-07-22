function normalizeWhitespace(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSearchText(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[\/／\\＼|｜,_\-+~`!@#$%^&*()[\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】·•‧・—–…]/g, "")
    .replace(/\s+/g, "");
}

export function isSearchKeywordLongEnough(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return false;
  }

  const hanChars = raw.match(/\p{Script=Han}/gu) || [];
  if (hanChars.length > 0) {
    return hanChars.length >= 2;
  }

  return normalizeSearchText(raw).length >= 3;
}

const MISSEVAN_SHARE_HOSTS = new Set(["missevan.com", "www.missevan.com"]);

function isPositiveNumericId(value) {
  return /^[1-9]\d*$/.test(String(value ?? "").trim());
}

function getMissevanBareNumericTokenType(value) {
  const text = String(value ?? "").trim();
  if (/^[1-9]\d{0,4}$/.test(text)) {
    return "drama";
  }
  if (/^[1-9]\d{5,7}$/.test(text)) {
    return "sound";
  }
  return "";
}

export function parseMissevanInputToken(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const bareNumericType = getMissevanBareNumericTokenType(raw);
  if (bareNumericType) {
    return {
      raw,
      type: bareNumericType,
      id: raw,
    };
  }

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol) || !MISSEVAN_SHARE_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (pathSegments.length !== 2) {
    return null;
  }

  const [kind, id] = pathSegments;
  if (!isPositiveNumericId(id)) {
    return null;
  }

  if (kind === "mdrama") {
    return {
      raw,
      type: "drama",
      id,
    };
  }

  if (kind === "sound") {
    return {
      raw,
      type: "sound",
      id,
    };
  }

  return null;
}

const SEARCH_TERM_BOUNDARY_PATTERN =
  /^[\s\/／\\＼|｜,_\-+~`!@#$%^&*()[\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】·•‧・—–…]/u;
const SEARCH_TERM_BOUNDARY_TRIM_PATTERN =
  /^[\s\/／\\＼|｜,_\-+~`!@#$%^&*()[\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】·•‧・—–…]+/u;
const CHINESE_NUMBER_PATTERN = "[0-9零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+";
const SEARCH_SEPARATOR_PATTERN =
  /[\s\/／\\＼|｜,_\-+~`!@#$%^&*()[\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】·•‧・—–…]/u;
const SEARCH_TERM_SEASON_MARKER_PATTERN = new RegExp(
  `^(?:第\\s*${CHINESE_NUMBER_PATTERN}\\s*[季部册卷期集话章节]?|${CHINESE_NUMBER_PATTERN}\\s*[季部]|[上下]季|全一季)`,
  "u"
);
const SEASON_NUMBER_PATTERN = new RegExp(
  `^(?:第\\s*(${CHINESE_NUMBER_PATTERN})\\s*[季部册卷期集话章节]?|(${CHINESE_NUMBER_PATTERN})\\s*[季部]|([上下])季|(全一季))`,
  "u"
);
const SEARCH_SORT_SEASON_PATTERN = new RegExp(
  `^(?:第\\s*(${CHINESE_NUMBER_PATTERN})\\s*[季部册卷期集话章节]?|(${CHINESE_NUMBER_PATTERN})\\s*[季部]|(全一季))`,
  "u"
);
const SEARCH_SORT_SPECIAL_PATTERN = /^(?:独家番外|番外篇?|特别篇|特别版|小剧场|粤语版|sp|SP|花絮|预告)/u;
const SEARCH_SORT_PART_PATTERN = /^[\s（(【\[]*([上中下前后])[\s）)】\]]*/u;
const SEARCH_TITLE_SUFFIX_PATTERN = new RegExp(
  `[\\s/／\\\\＼|｜,_\\-+~\`!@#$%^&*()[\\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】·•‧・—–…]*(?:` +
    `(?:第\\s*${CHINESE_NUMBER_PATTERN}\\s*[季部册卷期集话章节]?|${CHINESE_NUMBER_PATTERN}\\s*[季部]|[上下]季|全一季)` +
    `[\\s（(【\\[]*[上中下前后]?[\\s）)】\\]]*` +
    `|独家番外|番外篇?|特别篇|特别版|小剧场|粤语版|sp|SP|花絮|预告` +
  `)$`,
  "u"
);

function getRemainderAfterNormalizedPrefix(value, keyword) {
  const normalizedKeyword = normalizeSearchText(keyword);
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedKeyword || !normalizedValue.startsWith(normalizedKeyword)) {
    return null;
  }

  let consumed = "";
  const rawValue = String(value ?? "");
  for (let index = 0; index < rawValue.length; index += 1) {
    consumed = normalizeSearchText(`${consumed}${rawValue[index]}`);
    if (consumed === normalizedKeyword) {
      return rawValue.slice(index + 1);
    }
    if (consumed && !normalizedKeyword.startsWith(consumed)) {
      return null;
    }
  }

  return "";
}

function findNormalizedKeywordRange(value, keyword) {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return null;
  }

  const rawValue = String(value ?? "");
  let normalizedValue = "";
  const rawIndexes = [];
  for (let index = 0; index < rawValue.length; index += 1) {
    const normalizedChar = normalizeSearchText(rawValue[index]);
    for (const char of normalizedChar) {
      normalizedValue += char;
      rawIndexes.push(index);
    }
  }

  const normalizedStart = normalizedValue.indexOf(normalizedKeyword);
  if (normalizedStart < 0) {
    return null;
  }
  const normalizedEnd = normalizedStart + normalizedKeyword.length - 1;
  return {
    start: rawIndexes[normalizedStart],
    end: rawIndexes[normalizedEnd] + 1,
  };
}

function trimSearchBoundary(value) {
  return String(value ?? "")
    .replace(SEARCH_TERM_BOUNDARY_TRIM_PATTERN, "")
    .trim();
}

export function isCompleteSearchTermPrefix(value, keyword) {
  const remainder = getRemainderAfterNormalizedPrefix(value, keyword);
  return (
    remainder !== null &&
    (
      !remainder ||
      SEARCH_TERM_BOUNDARY_PATTERN.test(remainder) ||
      SEARCH_TERM_SEASON_MARKER_PATTERN.test(remainder)
    )
  );
}

const CHINESE_DIGITS = Object.freeze({
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  贰: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
});

function parseChineseSeasonNumber(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  if (!text) {
    return null;
  }
  if (text.length === 1 && Object.prototype.hasOwnProperty.call(CHINESE_DIGITS, text)) {
    return CHINESE_DIGITS[text];
  }

  const normalized = text
    .replace(/拾/g, "十")
    .replace(/佰/g, "百")
    .replace(/仟/g, "千");
  if (!/[十百千万]/u.test(normalized)) {
    return Array.from(normalized).reduce((total, char) => {
      if (!Object.prototype.hasOwnProperty.call(CHINESE_DIGITS, char)) {
        return Number.NaN;
      }
      return total * 10 + CHINESE_DIGITS[char];
    }, 0);
  }

  let total = 0;
  let section = 0;
  let number = 0;
  const unitValues = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  for (const char of normalized) {
    if (Object.prototype.hasOwnProperty.call(CHINESE_DIGITS, char)) {
      number = CHINESE_DIGITS[char];
      continue;
    }
    const unit = unitValues[char];
    if (!unit) {
      return null;
    }
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }

  const result = total + section + number;
  return Number.isFinite(result) && result > 0 ? result : null;
}

export function extractSearchSeasonNumber(value, keyword) {
  const remainder = getRemainderAfterNormalizedPrefix(value, keyword);
  if (remainder === null) {
    return null;
  }

  const markerText = trimSearchBoundary(remainder);
  if (!markerText) {
    return null;
  }
  const match = markerText.match(SEASON_NUMBER_PATTERN);
  if (!match) {
    return null;
  }
  if (match[4]) {
    return 1;
  }
  if (match[3]) {
    return match[3] === "上" ? 1 : 2;
  }

  return parseChineseSeasonNumber(match[1] || match[2]);
}

function isSearchSortMarkerBoundary(value, markerIndex, keywordEnd) {
  if (markerIndex === keywordEnd) {
    return true;
  }
  const previousChar = String(value ?? "")[markerIndex - 1] || "";
  return SEARCH_SEPARATOR_PATTERN.test(previousChar);
}

function findSearchSortMarker(value, keywordEnd) {
  const rawValue = String(value ?? "");
  for (let index = keywordEnd; index < rawValue.length; index += 1) {
    if (!isSearchSortMarkerBoundary(rawValue, index, keywordEnd)) {
      continue;
    }
    const markerText = trimSearchBoundary(rawValue.slice(index));
    const seasonMatch = markerText.match(SEARCH_SORT_SEASON_PATTERN);
    if (seasonMatch) {
      return {
        index,
        kind: 0,
        markerText,
        match: seasonMatch,
      };
    }
    const specialMatch = markerText.match(SEARCH_SORT_SPECIAL_PATTERN);
    if (specialMatch) {
      return {
        index,
        kind: 1,
        markerText,
        match: specialMatch,
      };
    }
  }
  return null;
}

function normalizeSearchSortBaseKey(value) {
  return String(value ?? "")
    .replace(/[\s\/／\\＼|｜,_\-+~`!@#$%^&*()[\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】·•‧・—–…]+$/u, "")
    .trim();
}

export function stripSearchSeasonSuffix(value) {
  let text = String(value ?? "").trim();
  let previous = "";
  while (text && text !== previous) {
    previous = text;
    text = text.replace(SEARCH_TITLE_SUFFIX_PATTERN, "").trim();
  }
  return text;
}

function getSearchPartRank(markerText, markerLength) {
  const rest = String(markerText ?? "").slice(markerLength);
  const match = rest.match(SEARCH_SORT_PART_PATTERN);
  if (!match) {
    return 0;
  }
  switch (match[1]) {
    case "上":
    case "前":
      return 1;
    case "中":
      return 2;
    case "下":
    case "后":
      return 3;
    default:
      return 0;
  }
}

export function extractSearchSortKey(value, keyword) {
  const rawValue = String(value ?? "").trim();
  const keywordRange = findNormalizedKeywordRange(rawValue, keyword);
  if (!rawValue || !keywordRange) {
    return null;
  }

  const marker = findSearchSortMarker(rawValue, keywordRange.end);
  if (!marker) {
    return {
      baseKey: normalizeSearchSortBaseKey(rawValue),
      kind: 2,
      seasonNumber: null,
      partRank: 0,
    };
  }

  const baseKey = normalizeSearchSortBaseKey(rawValue.slice(0, marker.index));
  if (marker.kind === 1) {
    return {
      baseKey,
      kind: 1,
      seasonNumber: null,
      partRank: 0,
    };
  }

  const markerLength = marker.match[0].length;
  return {
    baseKey,
    kind: 0,
    seasonNumber: marker.match[3] ? 1 : parseChineseSeasonNumber(marker.match[1] || marker.match[2]),
    partRank: getSearchPartRank(marker.markerText, markerLength),
  };
}
