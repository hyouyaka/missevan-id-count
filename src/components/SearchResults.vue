<template>
  <div class="search-results">
    <div class="toolbar-shell">
      <div class="toolbar-group">
        <div class="toolbar-label">批量选择</div>
        <div class="toolbar-actions toolbar-actions-select">
          <button class="select-btn" @click="selectAllResults">全选作品</button>
          <button class="select-btn" @click="clearAllResults">清空作品</button>
          <button class="select-btn" @click="selectAllPaidEpisodes">付费</button>
        </div>
      </div>

      <div class="toolbar-group toolbar-group-run">
        <div class="toolbar-label">执行操作</div>
        <div class="toolbar-actions toolbar-actions-run">
          <button class="run-btn" @click="addSelected">导入分集</button>
          <button class="run-btn run-btn-secondary" @click="estimateRevenue">
            收益预估
          </button>
          <button
            v-if="platform !== 'manbo'"
            class="run-btn run-btn-secondary"
            @click="startPlayCount"
          >
            统计播放量
          </button>
          <button class="run-btn run-btn-secondary" @click="startIdStats">
            统计弹幕 ID
          </button>
        </div>
      </div>
    </div>

    <div v-if="results.length" class="result-list">
      <div v-for="item in results" :key="item.id" class="result-card">
        <div class="result-summary">
          <label class="result-check">
            <input v-model="item.checked" type="checkbox" />
          </label>

          <button
            v-if="getImportedDrama(item.id)"
            class="toggle-btn"
            type="button"
            :aria-expanded="getImportedDrama(item.id).expanded ? 'true' : 'false'"
            @click="toggleDrama(item.id)"
          >
            {{ getImportedDrama(item.id).expanded ? "v" : ">" }}
          </button>
          <div v-else class="toggle-placeholder" aria-hidden="true"></div>

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
              <template v-if="hasPayCount(item)">
                / 付费人数: {{ formatPlainNumber(item.pay_count) }}
              </template>
              <template v-if="hasRewardNum(item)">
                / 打赏人数: {{ formatPlainNumber(item.reward_num) }}
              </template>
              <template v-if="platform === 'manbo'">
                / 投喂总数: {{ formatNumber(item.diamond_value) }}
              </template>
            </div>
          </div>

          <div
            v-if="getImportedDrama(item.id)"
            class="drama-actions"
          >
            <button class="select-btn select-btn-small" @click="selectAllEpisodes(item.id)">全选</button>
            <button class="select-btn select-btn-small" @click="clearAllEpisodes(item.id)">清空</button>
            <button class="select-btn select-btn-small" @click="selectPaidEpisodes(item.id)">付费</button>
            <button class="select-btn select-btn-small" @click="selectMainEpisodes(item.id)">正片</button>
          </div>
        </div>

        <div
          v-if="getImportedDrama(item.id)?.expanded"
          class="drama-body"
        >
          <div
            v-for="episode in getEpisodes(item.id)"
            :key="episode.sound_id"
            class="episode-row"
          >
            <label class="episode-label">
              <input
                v-model="episode.selected"
                type="checkbox"
                @change="emitSelectionChange"
              />
              <div class="episode-info">
                <div class="episode-title-line">
                  <span class="episode-title">{{ episode.name }}</span>
                  <span class="episode-id">{{ episodeIdLabel }}: {{ episode.sound_id }}</span>
                </div>
              </div>
            </label>
            <span
              v-if="getEpisodeTagText(episode)"
              :class="['episode-tag', { 'episode-tag-member': isMemberEpisode(episode) }]"
            >
              {{ getEpisodeTagText(episode) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-title">还没有导入结果</div>
      <div class="empty-text">
        {{
          platform === "manbo"
            ? "先搜索已收录的漫播索引库，或继续粘贴 Manbo 的 ID / 链接导入。"
            : "先搜索关键词，或直接输入作品 ID 后将结果导入到这里。"
        }}
      </div>
    </div>
  </div>
</template>

<script>
import { isMainEpisode, isMemberEpisode, isPaidEpisode } from "../utils/episodeRules";

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
    dramas: {
      type: Array,
      default: () => [],
    },
    selectedEpisodes: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    idLabel() {
      return this.platform === "manbo" ? "Drama ID" : "作品 ID";
    },
    episodeIdLabel() {
      return this.platform === "manbo" ? "Set ID" : "Sound ID";
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
    hasPayCount(item) {
      return this.platform === "manbo"
        && Number.isFinite(Number(item?.pay_count))
        && Number(item.pay_count) > 0;
    },
    hasRewardNum(item) {
      return this.platform === "missevan"
        && item?.reward_num != null
        && Number.isFinite(Number(item.reward_num));
    },
    getSelectedDramaIds() {
      return this.results
        .filter((result) => result.checked)
        .map((result) =>
          this.platform === "manbo" ? String(result.id) : Number(result.id)
        );
    },
    getSelectedEpisodeIds() {
      return this.selectedEpisodes.map((episode) => episode.sound_id);
    },
    getImportedDrama(dramaId) {
      return this.dramas.find((drama) => String(drama?.drama?.id) === String(dramaId)) || null;
    },
    getEpisodes(dramaId) {
      const drama = this.getImportedDrama(dramaId);
      return Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    },
    selectAllResults() {
      this.results.forEach((result) => {
        result.checked = true;
      });
    },
    clearAllResults() {
      this.results.forEach((result) => {
        result.checked = false;
      });
    },
    selectAllPaidEpisodes() {
      if (!this.dramas.length) {
        window.alert("没有所选分集");
        return;
      }

      let hasPaidEpisode = false;
      this.dramas.forEach((drama) => {
        let dramaHasPaidEpisode = false;
        this.getEpisodes(drama?.drama?.id).forEach((episode) => {
          const selected = this.isPaidOrMemberEpisode(episode);
          if (selected) {
            hasPaidEpisode = true;
            dramaHasPaidEpisode = true;
          }
          episode.selected = selected;
        });
        drama.expanded = dramaHasPaidEpisode;
      });

      if (!hasPaidEpisode) {
        window.alert("没有所选分集");
      }

      this.emitSelectionChange();
    },
    addSelected() {
      this.$emit("addDramas", this.getSelectedDramaIds());
    },
    estimateRevenue() {
      this.$emit("startRevenueEstimate", this.getSelectedDramaIds());
    },
    startPlayCount() {
      this.$emit("startPlayCountStatistics", this.getSelectedEpisodeIds());
    },
    startIdStats() {
      this.$emit("startIdStatistics", this.getSelectedEpisodeIds());
    },
    emitSelectionChange() {
      const selectedEpisodes = [];

      this.dramas.forEach((drama) => {
        const dramaTitle = drama?.drama?.name || "";
        this.getEpisodes(drama?.drama?.id).forEach((episode) => {
          if (episode.selected) {
            selectedEpisodes.push({
              sound_id: episode.sound_id,
              drama_title: dramaTitle,
              episode_title: episode.name,
              duration: Number(episode.duration ?? 0),
            });
          }
        });
      });

      this.$emit("selectionChange", selectedEpisodes);
    },
    toggleDrama(dramaId) {
      const drama = this.getImportedDrama(dramaId);
      if (!drama) {
        return;
      }
      drama.expanded = !drama.expanded;
    },
    setSelectedEpisodes(dramaId, predicate) {
      const drama = this.getImportedDrama(dramaId);
      if (!drama) {
        return;
      }

      this.getEpisodes(dramaId).forEach((episode) => {
        episode.selected = Boolean(predicate(episode));
      });
      drama.expanded = true;
      this.emitSelectionChange();
    },
    isPaidEpisode(episode) {
      return isPaidEpisode(this.platform, episode);
    },
    isMemberEpisode(episode) {
      return isMemberEpisode(this.platform, episode);
    },
    isPaidOrMemberEpisode(episode) {
      return this.isPaidEpisode(episode) || this.isMemberEpisode(episode);
    },
    isMainEpisode(episode) {
      return isMainEpisode(this.platform, episode);
    },
    getEpisodeTagText(episode) {
      if (this.isMemberEpisode(episode)) {
        return "会员";
      }
      return this.isPaidEpisode(episode) ? "付费" : "";
    },
    selectAllEpisodes(dramaId) {
      this.setSelectedEpisodes(dramaId, () => true);
    },
    clearAllEpisodes(dramaId) {
      this.setSelectedEpisodes(dramaId, () => false);
    },
    selectPaidEpisodes(dramaId) {
      this.setSelectedEpisodes(dramaId, (episode) => this.isPaidOrMemberEpisode(episode));
    },
    selectMainEpisodes(dramaId) {
      this.setSelectedEpisodes(dramaId, (episode) => this.isMainEpisode(episode));
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  flex: 1 1 220px;
}

.toolbar-actions-run {
  justify-content: flex-end;
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

.select-btn-small {
  min-height: 34px;
  padding: 6px 10px;
  font-size: 12px;
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
  max-height: 720px;
  padding: 8px 18px 18px;
  overflow-y: auto;
}

.result-card {
  padding: 12px 0;
  border-bottom: 1px solid rgba(29, 53, 87, 0.08);
}

.result-card:last-child {
  border-bottom: none;
}

.result-summary {
  display: grid;
  grid-template-columns: auto auto 60px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.result-check {
  display: flex;
  align-items: center;
  justify-content: center;
}

.toggle-btn,
.toggle-placeholder {
  width: 28px;
  height: 28px;
}

.toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  background: var(--accent-soft);
  border: none;
  border-radius: 50%;
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

.drama-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.drama-body {
  margin-top: 12px;
  margin-left: 44px;
  padding-left: 56px;
}

.episode-row {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-top: 1px dashed rgba(29, 53, 87, 0.08);
}

.episode-label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
}

.episode-info {
  min-width: 0;
}

.episode-title-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  line-height: 1.45;
}

.episode-title {
  word-break: break-word;
}

.episode-id {
  color: var(--text-muted);
  font-size: 13px;
}

.episode-tag {
  flex-shrink: 0;
  padding: 4px 8px;
  color: var(--warning);
  font-size: 12px;
  font-weight: 700;
  background: #fff4d8;
  border-radius: 999px;
}

.episode-tag-member {
  color: #17624d;
  background: #e6f8f1;
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

@media (max-width: 860px) {
  .result-summary {
    grid-template-columns: auto auto 56px minmax(0, 1fr);
  }

  .drama-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
    margin-left: 108px;
  }
}

@media (max-width: 640px) {
  .toolbar-shell {
    grid-template-columns: 1fr;
  }

  .toolbar-actions-run {
    justify-content: stretch;
  }

  .toolbar-actions-run .run-btn {
    flex: 1 1 calc(50% - 8px);
  }

  .result-list {
    max-height: none;
    padding: 8px 14px 14px;
  }

  .result-summary {
    grid-template-columns: auto auto 56px minmax(0, 1fr);
    gap: 10px;
  }

  .cover-wrap {
    width: 56px;
    height: 56px;
  }

  .result-title-row {
    flex-wrap: wrap;
  }

  .drama-actions {
    margin-left: 38px;
  }

  .drama-body {
    margin-left: 0;
    padding-left: 38px;
  }

  .episode-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
