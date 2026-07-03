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
} = {}) {
  const indexKey = `stats:tasks:v1:${instanceId}`;
  return {
    async load() {
      const ids = await client.command(["SMEMBERS", indexKey]);
      if (!Array.isArray(ids) || ids.length === 0) {
        return { tasks: [], staleIds: [] };
      }
      const values = await client.command([
        "MGET",
        ...ids.map((id) => `${indexKey}:${id}`),
      ]);
      const parsed = (Array.isArray(values) ? values : [])
        .map((value) => {
          try {
            return value ? JSON.parse(value) : null;
          } catch {
            return null;
          }
        })
      return {
        tasks: parsed.filter(Boolean),
        staleIds: ids.filter((_, index) => !parsed[index]),
      };
    },

    async save(tasks) {
      for (const task of tasks) {
        const key = `${indexKey}:${task.taskId}`;
        await client.command(["SET", key, JSON.stringify(task), "EX", ttlSeconds]);
        await client.command(["SADD", indexKey, String(task.taskId)]);
      }
      await client.command(["EXPIRE", indexKey, ttlSeconds]);
    },

    async remove(taskId) {
      await client.command(["DEL", `${indexKey}:${taskId}`]);
      await client.command(["SREM", indexKey, String(taskId)]);
    },
  };
}

export function createStatsTaskStore({ adapter, onError = console.warn } = {}) {
  if (!adapter || typeof adapter.load !== "function" || typeof adapter.save !== "function") {
    throw new TypeError("Stats task store requires a load/save adapter");
  }
  const tasks = new Map();
  let writeTail = Promise.resolve();

  async function persist() {
    await adapter.save([...tasks.values()].map(sanitizeTask));
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
        await persist();
      }
      return [...tasks.values()].map(sanitizeTask);
    },

    save(task) {
      if (task?.taskId) {
        tasks.set(String(task.taskId), sanitizeTask(task));
      }
      writeTail = writeTail
        .catch(() => {})
        .then(persist)
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
        .then(() => adapter.remove ? adapter.remove(key) : persist())
        .catch((error) => {
          onError?.(error);
        });
      return writeTail;
    },
  };
}
