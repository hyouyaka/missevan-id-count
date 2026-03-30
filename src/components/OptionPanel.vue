<template>
  <div class="option-panel">
    <div class="toolbar-shell">
      <div class="toolbar-group">
        <div class="toolbar-label">批量选择</div>
        <div class="toolbar-actions toolbar-actions-select">
          <button class="select-btn" @click="selectAll()">全选</button>
          <button class="select-btn" @click="clearAll()">清空</button>
          <button class="select-btn" @click="selectPaid()">付费</button>
          <button class="select-btn" @click="selectMain()">正片</button>
        </div>
      </div>

      <div class="toolbar-group toolbar-group-run">
        <div class="toolbar-label">执行统计</div>
        <div class="toolbar-actions">
          <button v-if="platform !== 'manbo'" class="run-btn" @click="startPlayCount">
            统计播放量
          </button>
          <button class="run-btn run-btn-secondary" @click="startIdStats">
            统计弹幕 ID
          </button>
        </div>
      </div>
    </div>

    <div v-if="dramas.length" class="episode-list">
      <div v-for="drama in dramas" :key="drama.drama.id" class="drama-card">
        <div class="drama-header" @click="toggle(drama)">
          <div class="drama-heading">
            <span class="toggle-icon">{{ drama.expanded ? "-" : "+" }}</span>
            <span class="drama-title">{{ drama.drama.name }}</span>
          </div>
          <div class="drama-actions" @click.stop>
            <button class="select-btn select-btn-small" @click="selectAll(drama)">全选</button>
            <button class="select-btn select-btn-small" @click="clearAll(drama)">清空</button>
            <button class="select-btn select-btn-small" @click="selectPaid(drama)">付费</button>
            <button class="select-btn select-btn-small" @click="selectMain(drama)">正片</button>
          </div>
        </div>

        <div v-show="drama.expanded" class="drama-body">
          <div
            v-for="episode in drama.episodes.episode"
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
                  <span class="episode-id">{{ idLabel }}: {{ episode.sound_id }}</span>
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
      <div class="empty-title">还没有导入分集</div>
      <div class="empty-text">先在上方导入作品，再到这里批量勾选分集。</div>
    </div>
  </div>
</template>

<script>
import { isMainEpisode, isMemberEpisode, isPaidEpisode } from "../utils/episodeRules";

export default {
  props: {
    platform: {
      type: String,
      default: "missevan",
    },
    dramas: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    idLabel() {
      return this.platform === "manbo" ? "Set ID" : "Sound ID";
    },
  },
  methods: {
    toggle(drama) {
      drama.expanded = !drama.expanded;
    },
    emitSelectionChange() {
      const selectedEpisodes = [];

      this.dramas.forEach((drama) => {
        const dramaTitle = drama.drama.name;
        drama.episodes.episode.forEach((episode) => {
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
    setSelected(drama, predicate) {
      const targetDramas = drama ? [drama] : this.dramas;

      targetDramas.forEach((item) => {
        item.episodes.episode.forEach((episode) => {
          episode.selected = Boolean(predicate(episode));
        });
        item.expanded = true;
      });

      this.emitSelectionChange();
    },
    isPaidEpisode(episode) {
      return isPaidEpisode(this.platform, episode);
    },
    isMemberEpisode(episode) {
      return isMemberEpisode(this.platform, episode);
    },
    getEpisodeTagText(episode) {
      if (this.isMemberEpisode(episode)) {
        return "会员";
      }

      return this.isPaidEpisode(episode) ? "付费" : "";
    },
    selectAll(drama = null) {
      this.setSelected(drama, () => true);
    },
    clearAll(drama = null) {
      this.setSelected(drama, () => false);
    },
    selectPaid(drama = null) {
      this.setSelected(drama, (episode) => this.isPaidEpisode(episode));
    },
    selectMain(drama = null) {
      this.setSelected(drama, (episode) => this.isMainEpisode(episode));
    },
    isMainEpisode(episode) {
      return isMainEpisode(this.platform, episode);
    },
    getSelectedIds() {
      const ids = [];

      this.dramas.forEach((drama) => {
        drama.episodes.episode.forEach((episode) => {
          if (episode.selected) {
            ids.push(episode.sound_id);
          }
        });
      });

      return ids;
    },
    startPlayCount() {
      this.$emit("startPlayCountStatistics", this.getSelectedIds());
    },
    startIdStats() {
      this.$emit("startIdStatistics", this.getSelectedIds());
    },
  },
};
</script>

<style scoped>
.option-panel {
  display: grid;
}

.toolbar-shell {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 18px 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(246, 250, 253, 0.88));
  border-bottom: 1px solid rgba(29, 53, 87, 0.08);
}

.toolbar-group {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px 16px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 12px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(47, 93, 124, 0.1);
  border-radius: 16px;
}

.toolbar-group-run {
  background: rgba(255, 241, 235, 0.8);
  border-color: rgba(207, 92, 54, 0.14);
}

.toolbar-label {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.toolbar-actions,
.drama-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-actions-select {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  flex: 1 1 auto;
}

.select-btn {
  min-height: 40px;
  padding: 9px 10px;
  color: var(--select-text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  background: var(--select-bg);
  border: 1px solid var(--select-border);
  border-radius: 999px;
}

.select-btn-small {
  min-height: 34px;
  padding: 6px 10px;
  font-size: 12px;
}

.run-btn {
  min-height: 40px;
  padding: 10px 16px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border: none;
  border-radius: 999px;
}

.run-btn-secondary {
  background: linear-gradient(135deg, #2f5d7c, #244962);
}

.episode-list {
  max-height: 520px;
  padding: 8px 18px 18px;
  overflow-y: auto;
}

.drama-card {
  padding: 12px 0;
  border-bottom: 1px solid rgba(29, 53, 87, 0.08);
}

.drama-header {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.drama-heading {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  gap: 10px;
  align-items: center;
}

.toggle-icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  font-size: 18px;
  font-weight: 700;
  background: var(--accent-soft);
  border-radius: 50%;
}

.drama-title {
  overflow: hidden;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drama-body {
  margin-top: 12px;
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
  padding: 24px 18px;
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
    padding: 14px;
  }

  .toolbar-group {
    flex-wrap: wrap;
    align-items: stretch;
  }

  .toolbar-actions {
    width: 100%;
    gap: 6px;
  }

  .toolbar-group-run .toolbar-actions {
    flex-wrap: nowrap;
  }

  .toolbar-group-run .run-btn {
    flex: 1 1 0;
    min-width: 0;
    padding: 10px 12px;
    font-size: 13px;
  }

  .toolbar-actions-select {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .toolbar-actions-select .select-btn {
    min-width: 0;
    padding: 8px 6px;
    font-size: 12px;
  }

  .episode-list {
    padding: 6px 14px 14px;
  }

  .drama-actions {
    width: 100%;
    flex-wrap: nowrap;
    gap: 6px;
  }

  .drama-actions .select-btn-small {
    flex: 1 1 25%;
    min-width: 0;
    min-height: 30px;
    padding: 6px 4px;
    font-size: 11px;
  }

  .episode-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
