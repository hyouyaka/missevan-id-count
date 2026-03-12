<template>
  <div class="search-results">
    <div class="toolbar-shell">
      <div class="toolbar-group">
        <div class="toolbar-label">批量选择</div>
        <div class="toolbar-actions toolbar-actions-select">
          <button class="select-btn" @click="selectAll">全选</button>
          <button class="select-btn" @click="clearAll">清空</button>
        </div>
      </div>

      <div class="toolbar-group toolbar-group-run">
        <div class="toolbar-label">执行操作</div>
        <div class="toolbar-actions">
          <button class="run-btn" @click="addSelected">导入分集</button>
          <button class="run-btn run-btn-secondary" @click="estimateRevenue">
            最低收益预估
          </button>
        </div>
      </div>
    </div>

    <div v-if="results.length" class="result-list">
      <div v-for="item in results" :key="item.id" class="result-card">
        <label class="result-check">
          <input v-model="item.checked" type="checkbox" />
        </label>

        <div class="cover-wrap">
          <img
            v-if="buildProxyImageUrl(item.cover)"
            :src="buildProxyImageUrl(item.cover)"
            :alt="item.name"
            class="result-cover"
          />
          <div v-else class="cover-placeholder">暂无封面</div>
        </div>

        <div class="result-info">
          <div class="result-title">{{ item.name }}</div>
          <div class="result-meta">剧集ID：{{ item.id }}</div>
          <div class="result-meta">
            总播放量：{{ getPlayCountText(item) }}
            <template v-if="hasSubscriptionNum(item)">
              / 追剧人数：{{ formatNumber(item.subscription_num) }}
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-title">还没有搜索结果</div>
      <div class="empty-text">先搜索关键词，或输入剧集ID后将结果导入到这里。</div>
    </div>
  </div>
</template>

<script>
export default {
  name: "SearchResults",
  props: {
    results: {
      type: Array,
      default: () => [],
    },
  },
  methods: {
    buildProxyImageUrl(url) {
      return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
    },
    formatPlayCount(value) {
      const count = Number(value ?? 0);
      if (!Number.isFinite(count) || count <= 0) {
        return "0";
      }

      if (count < 10000) {
        return `${count}`;
      }

      if (count < 100000000) {
        return `${(count / 10000).toFixed(1)}万`;
      }

      return `${(count / 100000000).toFixed(2)}亿`;
    },
    formatNumber(value) {
      const count = Number(value ?? 0);
      if (!Number.isFinite(count) || count < 0) {
        return "0";
      }

      return this.formatPlayCount(count);
    },
    getPlayCountText(item) {
      if (item.playCountWan) {
        return item.playCountWan;
      }

      return this.formatPlayCount(item.view_count);
    },
    hasSubscriptionNum(item) {
      return Number.isFinite(Number(item.subscription_num));
    },
    getSelectedIds() {
      return this.results
        .filter((result) => result.checked)
        .map((result) => Number(result.id));
    },
    selectAll() {
      this.results.forEach((result) => {
        result.checked = true;
      });
    },
    clearAll() {
      this.results.forEach((result) => {
        result.checked = false;
      });
    },
    addSelected() {
      this.$emit("addDramas", this.getSelectedIds());
    },
    estimateRevenue() {
      this.$emit("startRevenueEstimate", this.getSelectedIds());
    },
  },
};
</script>

<style scoped>
.search-results {
  display: grid;
}

.toolbar-shell {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 18px 20px 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(250, 248, 245, 0.88));
  border-bottom: 1px solid rgba(29, 53, 87, 0.08);
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 14px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(47, 93, 124, 0.1);
  border-radius: 16px;
}

.toolbar-group-run {
  background: rgba(255, 241, 235, 0.76);
  border-color: rgba(207, 92, 54, 0.12);
}

.toolbar-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-actions-select {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  flex: 1 1 220px;
}

.select-btn,
.run-btn {
  border-radius: 999px;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.select-btn {
  padding: 9px 14px;
  color: var(--select-text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  background: var(--select-bg);
  border: 1px solid var(--select-border);
}

.select-btn:hover {
  background: #e6eef8;
  transform: translateY(-1px);
}

.run-btn {
  padding: 10px 16px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border: none;
  box-shadow: 0 10px 20px rgba(207, 92, 54, 0.2);
}

.run-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 24px rgba(207, 92, 54, 0.25);
}

.run-btn-secondary {
  background: linear-gradient(135deg, #2f5d7c, #244962);
  box-shadow: 0 10px 20px rgba(47, 93, 124, 0.18);
}

.run-btn-secondary:hover {
  box-shadow: 0 14px 24px rgba(47, 93, 124, 0.24);
}

.result-list {
  display: grid;
  max-height: 420px;
  padding: 10px 20px 20px;
  overflow-y: auto;
}

.result-card {
  display: grid;
  grid-template-columns: auto 60px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid rgba(29, 53, 87, 0.08);
}

.result-card:last-child {
  border-bottom: none;
}

.result-check {
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-wrap {
  width: 60px;
  height: 60px;
  overflow: hidden;
  background: linear-gradient(135deg, #eff4fa, #f7ece7);
  border-radius: 14px;
}

.result-cover,
.cover-placeholder {
  width: 100%;
  height: 100%;
}

.result-cover {
  display: block;
  object-fit: cover;
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
}

.result-info {
  min-width: 0;
}

.result-title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-strong);
  font-weight: 700;
  line-height: 1.45;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.result-meta {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.4;
}

.empty-state {
  padding: 28px 20px;
  text-align: center;
}

.empty-title {
  margin-bottom: 6px;
  font-weight: 700;
}

.empty-text {
  color: var(--text-muted);
  line-height: 1.6;
}

@media (max-width: 640px) {
  .toolbar-shell {
    grid-template-columns: 1fr;
    padding-left: 16px;
    padding-right: 16px;
  }

  .result-list {
    padding-left: 16px;
    padding-right: 16px;
  }

  .toolbar-group {
    align-items: flex-start;
  }

  .toolbar-actions {
    width: 100%;
  }

  .run-btn {
    flex: 1 1 calc(50% - 4px);
    justify-content: center;
  }

  .result-card {
    grid-template-columns: auto 52px minmax(0, 1fr);
    gap: 10px;
  }

  .cover-wrap {
    width: 52px;
    height: 52px;
  }
}
</style>
