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
            收益预估
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
          <div class="result-title-row">
            <div class="result-title">{{ item.name }}</div>
            <span v-if="item.is_member" class="result-badge">会员</span>
          </div>
          <div class="result-meta">{{ idLabel }}: {{ item.id }}</div>
          <div class="result-meta">
            总播放量: {{ getPlayCountText(item) }}
            <template v-if="hasSubscriptionNum(item)">
              / {{ extraMetaLabel }}: {{ formatNumber(item.subscription_num) }}
            </template>
            <template v-if="hasRewardNum(item)">
              / 打赏人数: {{ formatPlainNumber(item.reward_num) }}
            </template>
            <template v-if="platform === 'manbo'">
              / 投喂总数: {{ formatNumber(item.diamond_value) }}
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-title">还没有导入结果</div>
      <div class="empty-text">
        {{
          platform === "manbo"
            ? "先粘贴 Manbo 的 ID 或链接，再把结果导入到这里。"
            : "先搜索关键词，或直接输入作品 ID 后将结果导入到这里。"
        }}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "SearchResults",
  props: {
    platform: {
      type: String,
      default: "missevan",
    },
    results: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    idLabel() {
      return this.platform === "manbo" ? "Drama ID" : "作品 ID";
    },
    extraMetaLabel() {
      return this.platform === "manbo" ? "收藏数" : "追剧人数";
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
      return this.formatPlayCount(value);
    },
    formatPlainNumber(value) {
      const count = Number(value ?? 0);
      return Number.isFinite(count) ? `${Math.trunc(count)}` : "0";
    },
    getPlayCountText(item) {
      return item.playCountWan || this.formatPlayCount(item.view_count);
    },
    hasSubscriptionNum(item) {
      return item?.subscription_num != null
        && Number.isFinite(Number(item.subscription_num));
    },
    hasRewardNum(item) {
      return this.platform === "missevan"
        && item?.reward_num != null
        && Number.isFinite(Number(item.reward_num));
    },
    getSelectedIds() {
      return this.results
        .filter((result) => result.checked)
        .map((result) =>
          this.platform === "manbo" ? String(result.id) : Number(result.id)
        );
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
  padding: 16px 18px 14px;
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
  padding: 12px;
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
  min-height: 40px;
  border-radius: 999px;
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

.run-btn {
  padding: 10px 16px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border: none;
}

.run-btn-secondary {
  background: linear-gradient(135deg, #2f5d7c, #244962);
}

.result-list {
  display: grid;
  max-height: 420px;
  padding: 8px 18px 18px;
  overflow-y: auto;
}

.result-card {
  display: grid;
  grid-template-columns: auto 60px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px 0;
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
  background: linear-gradient(135deg, rgba(207, 92, 54, 0.12), rgba(47, 93, 124, 0.12));
  border-radius: 14px;
}

.result-cover,
.cover-placeholder {
  width: 100%;
  height: 100%;
}

.result-cover {
  object-fit: cover;
}

.cover-placeholder {
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 12px;
}

.result-info {
  min-width: 0;
}

.result-title-row {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.result-title {
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-badge {
  flex: 0 0 auto;
  padding: 3px 8px;
  color: #8b4d00;
  font-size: 12px;
  font-weight: 700;
  background: linear-gradient(135deg, #ffe8a3, #ffd27a);
  border: 1px solid rgba(139, 77, 0, 0.16);
  border-radius: 999px;
}

.result-meta {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.empty-state {
  padding: 28px 18px 30px;
  text-align: center;
}

.empty-title {
  font-size: 16px;
  font-weight: 700;
}

.empty-text {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 640px) {
  .toolbar-shell {
    grid-template-columns: 1fr;
  }

  .result-card {
    grid-template-columns: auto 56px minmax(0, 1fr);
  }

  .cover-wrap {
    width: 56px;
    height: 56px;
  }

  .result-title-row {
    flex-wrap: wrap;
  }
}
</style>
