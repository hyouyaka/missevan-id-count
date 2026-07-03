function normalizeMaxEntries(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Infinity;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeTtlMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Infinity;
  }
  return Math.max(0, numeric);
}

export class TtlLruCache {
  constructor({ maxEntries = Infinity, ttlMs = Infinity, now = Date.now } = {}) {
    this.maxEntries = normalizeMaxEntries(maxEntries);
    this.ttlMs = normalizeTtlMs(ttlMs);
    this.now = typeof now === "function" ? now : Date.now;
    this.entries = new Map();
  }

  get size() {
    this.pruneExpired();
    return this.entries.size;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  set(key, value, options = {}) {
    this.pruneExpired();
    this.entries.delete(key);
    if (this.maxEntries === 0) {
      return this;
    }
    const ttlMs = normalizeTtlMs(options?.ttlMs ?? this.ttlMs);
    this.entries.set(key, {
      value,
      expiresAt: ttlMs === Infinity ? Infinity : this.now() + ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
    return this;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  keys() {
    this.pruneExpired();
    return this.entries.keys();
  }

  *values() {
    this.pruneExpired();
    for (const entry of this.entries.values()) {
      yield entry.value;
    }
  }

  isExpired(entry) {
    return entry.expiresAt !== Infinity && this.now() >= entry.expiresAt;
  }

  pruneExpired() {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
      }
    }
  }
}
