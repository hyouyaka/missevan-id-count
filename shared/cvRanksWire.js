export const COMPACT_CV_RANKS_FORMAT = "cv-compact";

const LEGACY_RANK_KEYS = { total: "cv", paid: "cv-paid", labor: "cv-series-count" };
const compactPlatformsCache = new WeakMap();

function mapCvBoards(platforms, mapBoard) {
  return Object.fromEntries(Object.entries(platforms).map(([platform, section]) => [platform, {
    ...section,
    categories: section.categories.map((category) => platform === "cv" || category.key === "cv"
      ? { ...category, ranks: category.ranks.map((board) => mapBoard(board, platform, category.key)) }
      : category),
  }]));
}

function legacyItems(platforms, board, categoryKey) {
  return platforms[board.sourcePlatform]?.categories.find((category) => category.key === "cv")
    ?.ranks.find((rank) => rank.key === LEGACY_RANK_KEYS[categoryKey])?.items;
}

function createPool() {
  const values = [];
  const indices = new Map();
  function add(value) {
    const key = JSON.stringify(value);
    if (!indices.has(key)) {
      indices.set(key, values.length);
      values.push(value);
    }
    return indices.get(key);
  }
  return { values, add };
}

export function compactCvRanks(response) {
  const original = response.platforms;
  if (!original?.cv) return response;

  let compact = compactPlatformsCache.get(original);
  if (!compact) {
    const workPool = createPool();
    const playbackPool = createPool();
    function encodeItem(item) {
      const { works, topWorks, series, topSeries, totalViewCount, playbackDelta, ...row } = item;
      const seriesIndices = new Map(series.map((group, index) => [group, index]));
      return {
        ...row,
        playbackRef: playbackPool.add({ totalViewCount, playbackDelta }),
        works: works.map(workPool.add),
        topWorks: topWorks.map(workPool.add),
        series: series.map((group) => ({ ...group, works: group.works.map(workPool.add) })),
        topSeries: topSeries.map((group) => seriesIndices.get(group)),
      };
    }
    const platforms = mapCvBoards(original, (board, platform, categoryKey) => {
      const { items, ...fields } = board;
      if (platform === "cv" && legacyItems(original, board, categoryKey) === items) {
        return { ...fields, useLegacyItems: true };
      }
      return { ...fields, items: items.map(encodeItem) };
    });
    compact = { platforms, cvData: { works: workPool.values, playback: playbackPool.values } };
    compactPlatformsCache.set(original, compact);
  }
  return { ...response, ...compact };
}

export function expandCvRanks(response) {
  if (!response?.cvData) return response;
  const { cvData, platforms, ...fields } = response;
  const getWork = (index) => cvData.works[index];
  function decodeItem(item) {
    const { works, topWorks, series, topSeries, playbackRef, ...row } = item;
    const groups = series.map((group) => ({ ...group, works: group.works.map(getWork) }));
    return {
      ...row,
      ...cvData.playback[playbackRef],
      works: works.map(getWork),
      topWorks: topWorks.map(getWork),
      series: groups,
      topSeries: topSeries.map((index) => groups[index]),
    };
  }
  const decoded = mapCvBoards(platforms, (board) => {
    if (board.useLegacyItems) return board;
    return { ...board, items: board.items.map(decodeItem) };
  });
  const cv = decoded.cv;
  decoded.cv = { ...cv, categories: cv.categories.map((category) => ({ ...category,
    ranks: category.ranks.map((board) => {
      if (!board.useLegacyItems) return board;
      const { useLegacyItems, ...fields } = board;
      return { ...fields, items: legacyItems(decoded, board, category.key) || [] };
    }),
  })) };
  return { ...fields, platforms: decoded };
}
