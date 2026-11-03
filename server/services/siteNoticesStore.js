import { randomUUID } from "node:crypto";
import { normalizeSiteNoticeEntries } from "../../shared/siteNotices.js";

export const SITE_NOTICES_KEY = "site:notices:v1";

export class SiteNoticesError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function freezeSnapshot(snapshot) {
  snapshot.entries.forEach(Object.freeze);
  Object.freeze(snapshot.entries);
  return Object.freeze(snapshot);
}

// One GET per process startup. Public/admin reads never probe Redis. All mutations
// are serialized in this process so a slow startup/reload cannot overwrite a publish.
export function createSiteNoticesStore({ client, now = () => new Date(), makeRevision = randomUUID }) {
  const enabled = Boolean(client.enabled);
  let snapshot = null;
  let initialization;
  let queue = Promise.resolve();

  function enqueue(operation) {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  }

  async function load() {
    if (!enabled) throw new SiteNoticesError(503, "公告存储尚未配置。");
    const raw = await client.command(["GET", SITE_NOTICES_KEY], { timeoutMs: 10000 });
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    let next;
    if (value === null) {
      next = { version: 1, revision: "empty", updatedAt: null, entries: [] };
    } else {
      if (!value || value.version !== 1 || typeof value.revision !== "string" ||
          !/^[a-zA-Z0-9_-]{1,64}$/.test(value.revision) ||
          typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
        throw new Error("Invalid site notices snapshot");
      }
      next = { version: 1, revision: value.revision, updatedAt: value.updatedAt,
        entries: normalizeSiteNoticeEntries(value.entries) };
    }
    snapshot = freezeSnapshot(next);
    return snapshot;
  }

  function initialize() {
    initialization ??= enqueue(load);
    return initialization;
  }

  async function read() {
    await initialize().catch(() => {});
    if (!snapshot) throw new SiteNoticesError(503, "公告暂时无法读取，请稍后再试。");
    return snapshot;
  }

  async function publish(payload = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.revision !== "string") {
      throw new SiteNoticesError(400, "发布内容格式无效。");
    }
    const { revision, entries } = payload;
    let normalized;
    try {
      normalized = normalizeSiteNoticeEntries(entries);
    } catch (error) {
      throw new SiteNoticesError(400, error.message);
    }
    await read();
    return enqueue(async () => {
      if (revision !== snapshot.revision) {
        throw new SiteNoticesError(409, "内容已更新，请重新载入已发布内容后再编辑。");
      }
      if (JSON.stringify(normalized) === JSON.stringify(snapshot.entries)) return snapshot;
      const next = { version: 1, revision: makeRevision(), updatedAt: now().toISOString(), entries: normalized };
      const result = await client.command(["SET", SITE_NOTICES_KEY, JSON.stringify(next)], { timeoutMs: 10000 });
      if (result !== "OK") throw new Error("Site notices write not acknowledged");
      snapshot = freezeSnapshot(next);
      return snapshot;
    });
  }

  return { enabled, initialize, read, publish, reload: () => enqueue(load) };
}
