import fs from "node:fs/promises";
import path from "node:path";

function sanitizeTask(task) {
  const {
    abortSignal: _abortSignal,
    controller: _controller,
    ...snapshot
  } = task || {};
  return structuredClone(snapshot);
}

export function createJsonTaskStoreAdapter(filePath) {
  return {
    async load() {
      try {
        const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
        return {
          tasks: Array.isArray(payload?.tasks) ? payload.tasks : [],
          staleIds: [],
        };
      } catch (error) {
        if (error?.code === "ENOENT") {
          return { tasks: [], staleIds: [] };
        }
        throw error;
      }
    },

    async save(tasks) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await fs.writeFile(
        temporaryPath,
        JSON.stringify({ version: 1, tasks }, null, 2),
        "utf8"
      );
      await fs.rename(temporaryPath, filePath);
    },
  };
}

export function createUpstashTaskStoreAdapter({
  client,
  instanceId,
  ttlSeconds = 3600,
  commandTimeoutMs = 10_000,
  now = Date.now,
  ttlRefreshIntervalMs = Math.min(5 * 60 * 1000, Math.floor(ttlSeconds * 1000 / 3)),
} = {}) {
  const hashKey = `stats:tasks:v2:${instanceId}`;
  const legacyIndexKey = `stats:tasks:v1:${instanceId}`;
  const commandOptions = { timeoutMs: commandTimeoutMs };
  const normalizedTtlRefreshIntervalMs = Math.max(
    1000,
    Number.isFinite(Number(ttlRefreshIntervalMs))
      ? Math.floor(Number(ttlRefreshIntervalMs))
      : Math.min(5 * 60 * 1000, Math.floor(ttlSeconds * 1000 / 3))
  );
  let lastExpiryRefreshAt = null;

  function parseTask(value, expectedTaskId = "") {
    try {
      const task = typeof value === "string" ? JSON.parse(value) : value;
      if (!task || typeof task !== "object" || Array.isArray(task)) {
        return null;
      }
      const taskId = String(task.taskId ?? "").trim();
      if (!taskId || (expectedTaskId && taskId !== expectedTaskId)) {
        return null;
      }
      return task;
    } catch {
      return null;
    }
  }

  function parseHashTasks(raw) {
    const entries = raw && !Array.isArray(raw) && typeof raw === "object"
      ? Object.entries(raw)
      : Array.isArray(raw)
        ? Array.from({ length: Math.floor(raw.length / 2) }, (_, index) => [
            raw[index * 2],
            raw[index * 2 + 1],
          ])
        : [];
    const tasks = [];
    const staleIds = [];
    for (const [field, value] of entries) {
      const taskId = String(field ?? "").trim();
      const task = parseTask(value, taskId);
      if (task) {
        tasks.push(task);
      } else if (taskId) {
        staleIds.push(taskId);
      }
    }
    return { tasks, staleIds, fieldCount: entries.length };
  }

  function getTaskTimestamp(task) {
    const timestamp = Number(task?.updatedAt ?? task?.createdAt ?? 0);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function mergeTasks(v2Tasks, legacyTasks) {
    const merged = new Map();
    for (const task of v2Tasks) {
      merged.set(String(task.taskId), task);
    }
    for (const task of legacyTasks) {
      const taskId = String(task.taskId);
      const current = merged.get(taskId);
      if (!current || getTaskTimestamp(task) > getTaskTimestamp(current)) {
        merged.set(taskId, task);
      }
    }
    return [...merged.values()];
  }

  async function refreshHashExpiry({ force = false } = {}) {
    const currentTime = Number(now());
    if (
      !force
      && lastExpiryRefreshAt != null
      && currentTime - lastExpiryRefreshAt < normalizedTtlRefreshIntervalMs
    ) {
      return false;
    }
    const result = await client.command(["EXPIRE", hashKey, ttlSeconds], commandOptions);
    if (result !== true && Number(result) !== 1) {
      throw new Error(`Failed to refresh stats task hash TTL key=${hashKey}`);
    }
    lastExpiryRefreshAt = currentTime;
    return true;
  }

  async function writeTasksToHash(tasks) {
    if (!tasks.length) {
      return;
    }
    await client.command([
      "HSET",
      hashKey,
      ...tasks.flatMap((task) => [String(task.taskId), JSON.stringify(task)]),
    ], commandOptions);
  }

  return {
    async load() {
      const rawHash = await client.command(["HGETALL", hashKey], commandOptions);
      const v2 = parseHashTasks(rawHash);
      const rawLegacyIds = await client.command(["SMEMBERS", legacyIndexKey], commandOptions);
      const legacyIds = Array.isArray(rawLegacyIds)
        ? rawLegacyIds.map((id) => String(id ?? "").trim()).filter(Boolean)
        : [];
      let legacyTasks = [];
      if (legacyIds.length > 0) {
        const legacyValues = await client.command([
          "MGET",
          ...legacyIds.map((id) => `${legacyIndexKey}:${id}`),
        ], commandOptions);
        legacyTasks = legacyIds
          .map((id, index) => parseTask(legacyValues?.[index], id))
          .filter(Boolean);
      }

      const tasks = mergeTasks(v2.tasks, legacyTasks);
      const validTaskIds = new Set(tasks.map((task) => String(task.taskId)));
      if (legacyIds.length > 0) {
        if (tasks.length > 0) {
          await writeTasksToHash(tasks);
          await refreshHashExpiry({ force: true });
        }
        await client.command([
          "DEL",
          legacyIndexKey,
          ...legacyIds.map((id) => `${legacyIndexKey}:${id}`),
        ], commandOptions);
      } else if (v2.fieldCount > 0) {
        await refreshHashExpiry({ force: true });
      }

      return {
        tasks,
        staleIds: v2.staleIds.filter((taskId) => !validTaskIds.has(taskId)),
      };
    },

    async saveTask(task) {
      await writeTasksToHash([task]);
      await refreshHashExpiry();
    },

    async remove(taskId) {
      await client.command(["HDEL", hashKey, String(taskId)], commandOptions);
      lastExpiryRefreshAt = null;
    },
  };
}

export function createStatsTaskStore({ adapter, onError = console.warn } = {}) {
  const supportsFullSnapshots = typeof adapter?.save === "function";
  const supportsIncrementalSnapshots = typeof adapter?.saveTask === "function";
  const supportsRemoval = typeof adapter?.remove === "function";
  if (
    !adapter ||
    typeof adapter.load !== "function" ||
    (!supportsFullSnapshots && !supportsIncrementalSnapshots) ||
    (supportsIncrementalSnapshots && !supportsFullSnapshots && !supportsRemoval)
  ) {
    throw new TypeError(
      "Stats task store requires load plus save, or saveTask plus remove"
    );
  }
  const tasks = new Map();
  let writeTail = Promise.resolve();

  async function persistAll() {
    await adapter.save([...tasks.values()].map(sanitizeTask));
  }

  async function persistTask(task) {
    if (supportsIncrementalSnapshots) {
      await adapter.saveTask(sanitizeTask(task));
      return;
    }
    await persistAll();
  }

  return {
    async loadTasks({ now = Date.now(), retentionMs = Infinity } = {}) {
      const payload = await adapter.load();
      const loaded = Array.isArray(payload) ? payload : payload?.tasks;
      const staleIds = Array.isArray(payload?.staleIds)
        ? payload.staleIds
        : [];
      const validStatuses = new Set([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ]);
      const removedIds = [...staleIds];
      tasks.clear();
      for (const task of Array.isArray(loaded) ? loaded : []) {
        const updatedAt = Number(task?.updatedAt ?? task?.createdAt ?? now);
        const expired =
          Number.isFinite(retentionMs) &&
          now - updatedAt > retentionMs;
        if (
          !task?.taskId ||
          !validStatuses.has(task.status) ||
          expired
        ) {
          if (task?.taskId) {
            removedIds.push(String(task.taskId));
          }
          continue;
        }
        tasks.set(String(task.taskId), sanitizeTask(task));
      }
      if (adapter.remove) {
        for (const taskId of new Set(removedIds)) {
          await adapter.remove(taskId);
        }
      } else if (removedIds.length > 0) {
        await persistAll();
      }
      return [...tasks.values()].map(sanitizeTask);
    },

    save(task) {
      const snapshot = sanitizeTask(task);
      if (task?.taskId) {
        tasks.set(String(task.taskId), snapshot);
      }
      writeTail = writeTail
        .catch(() => {})
        .then(() => persistTask(snapshot))
        .catch((error) => {
          onError?.(error);
        });
      return writeTail;
    },

    remove(taskId) {
      const key = String(taskId);
      tasks.delete(key);
      writeTail = writeTail
        .catch(() => {})
        .then(() => adapter.remove ? adapter.remove(key) : persistAll())
        .catch((error) => {
          onError?.(error);
        });
      return writeTail;
    },
  };
}
