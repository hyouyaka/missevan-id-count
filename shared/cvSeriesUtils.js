export function buildCvSeriesIndex(snapshot = {}) {
  const index = new Map();
  Object.entries(snapshot || {}).forEach(([key, record]) => {
    const platform = { 猫耳: "missevan", 漫播: "manbo", missevan: "missevan", manbo: "manbo" }[record?.platform];
    const title = String(record?.["series title"] ?? "").trim();
    if (!platform || !title || !Array.isArray(record?.dramaIds)) return;
    record.dramaIds.forEach((id) => {
      const workKey = `${platform}:${String(id).trim()}`;
      if (!index.has(workKey)) index.set(workKey, { seriesId: `${platform}:series:${key}`, seriesTitle: title });
    });
  });
  return index;
}

export function attachCvSeries(works = [], index = new Map()) {
  return works.map((work) => {
    const workKey = `${work.platform}:${String(work.id ?? work.dramaId)}`;
    return { ...work, ...(index.get(workKey) || { seriesId: `work:${workKey}`, seriesTitle: work.title }) };
  });
}

function playback(work) {
  const value = work.playCount !== undefined ? work.playCount : work.viewCount;
  return Number.isFinite(value) ? value : null;
}

function comparePlayback(leftValue, rightValue, leftTitle, rightTitle) {
  if ((leftValue === null) !== (rightValue === null)) return leftValue === null ? 1 : -1;
  return (rightValue ?? 0) - (leftValue ?? 0) || String(leftTitle).localeCompare(String(rightTitle), "zh-Hans-CN");
}

export function getCvSeriesId(work) {
  return work.seriesId || `work:${work.platform}:${String(work.id ?? work.dramaId)}`;
}

export function groupCvSeries(works = []) {
  const groups = new Map();
  works.forEach((work) => {
    const id = getCvSeriesId(work);
    if (!groups.has(id)) groups.set(id, { id, platform: work.platform, title: work.seriesTitle || work.title, playCount: null, works: [] });
    groups.get(id).works.push(work);
  });
  return [...groups.values()].map((group) => {
    const values = group.works.map(playback).filter((value) => value !== null);
    return {
      ...group,
      playCount: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
      works: group.works.sort((a, b) => comparePlayback(playback(a), playback(b), a.title, b.title)),
    };
  }).sort((a, b) => comparePlayback(a.playCount, b.playCount, a.title, b.title));
}
