export const SITE_NOTICE_LIMITS = Object.freeze({ entries: 100, title: 120, body: 6000, total: 120000 });

export function normalizeSiteNoticeEntries(entries) {
  if (!Array.isArray(entries) || entries.length > SITE_NOTICE_LIMITS.entries) {
    throw new Error(`最多发布 ${SITE_NOTICE_LIMITS.entries} 条记录。`);
  }
  const ids = new Set();
  const normalized = entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("记录格式无效。");
    const { id, date } = entry;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) {
      throw new Error("记录标识无效或重复。");
    }
    ids.add(id);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error("请填写有效日期。");
    }
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const body = typeof entry.body === "string" ? entry.body.replace(/\r\n?/g, "\n").trim() : "";
    if (title.length > SITE_NOTICE_LIMITS.title) throw new Error(`标题最多 ${SITE_NOTICE_LIMITS.title} 个字符。`);
    if (!body || body.length > SITE_NOTICE_LIMITS.body) throw new Error(`说明需为 1～${SITE_NOTICE_LIMITS.body} 个字符。`);
    // Ignore legacy type/status fields without issuing a migration write.
    return { id, date, title, body };
  });
  if (JSON.stringify(normalized).length > SITE_NOTICE_LIMITS.total) throw new Error("记录总长度过大，请精简旧记录。");
  return normalized;
}
