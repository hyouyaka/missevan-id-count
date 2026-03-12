<template>
  <div class="option-panel">
    <div class="toolbar-shell">
      <div class="toolbar-group">
        <div class="toolbar-label">批量选择</div>
        <div class="toolbar-actions toolbar-actions-select">
          <button class="select-btn" title="全选" @click="selectAll()">全选</button>
          <button class="select-btn" title="清空" @click="clearAll()">清空</button>
          <button class="select-btn" title="付费" @click="selectPaid()">付费</button>
          <button class="select-btn" title="正片" @click="selectMain()">正片</button>
        </div>
      </div>

      <div class="toolbar-group toolbar-group-run">
        <div class="toolbar-label">执行统计</div>
        <div class="toolbar-actions">
          <button class="run-btn" @click="startPlayCount">统计播放量</button>
          <button class="run-btn run-btn-secondary" @click="startIdStats">
            统计 ID 数
          </button>
        </div>
      </div>
    </div>

    <div v-if="dramas.length" class="episode-list">
      <div v-for="drama in dramas" :key="drama.drama.id" class="drama-card">
        <div class="drama-header" @click="toggle(drama)">
          <div class="drama-heading">
            <span class="toggle-icon">{{ drama.expanded ? "−" : "+" }}</span>
            <span class="drama-title">{{ drama.drama.name }}</span>
          </div>
          <div class="drama-actions" @click.stop>
            <button class="select-btn select-btn-small" @click="selectAll(drama)">
              全选
            </button>
            <button class="select-btn select-btn-small" @click="clearAll(drama)">
              清空
            </button>
            <button class="select-btn select-btn-small" @click="selectPaid(drama)">
              付费
            </button>
            <button class="select-btn select-btn-small" @click="selectMain(drama)">
              正片
            </button>
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
                  <span class="episode-id">Sound ID: {{ episode.sound_id }}</span>
                </div>
              </div>
            </label>
            <span v-if="episode.need_pay" class="episode-tag">付费</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-title">还没有导入分集</div>
      <div class="empty-text">先在上方搜索结果中选择剧集，再点击“导入分集”。</div>
    </div>
  </div>
</template>

<script>
const MAIN_EPISODE_INCLUDE_PATTERNS = [
  /^第[0-9零一二三四五六七八九十百千万两]+[集话期章节幕回]/i,
  /(?:^|\s)ep\.?\s*[0-9]+/i,
  /(?:^|\s)e[0-9]{1,3}(?:\D|$)/i,
  /(?:^|\s)sp(?:\D|$)/i,
  /番外/,
  /特别篇/,
  /特别放送/,
  /ova/i,
];

const MAIN_EPISODE_EXCLUDE_PATTERNS = [
  /预告/,
  /花絮/,
  /采访/,
  /主题曲/,
  /片头曲/,
  /片尾曲/,
  /角色曲/,
  /印象曲/,
  /广播剧花絮/,
  /福利/,
  /彩蛋/,
  /宣传/,
  /PV/i,
  /CM/i,
  /DEMO/i,
  /OST/i,
  /OP/i,
  /ED/i,
  /试听/,
  /先导/,
  /预热/,
  /角色预告/,
  /制作花絮/,
  /片段/,
];

export default {
  props: {
    dramas: {
      type: Array,
      default: () => [],
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
            });
          }
        });
      });

      this.$emit("selectionChange", selectedEpisodes);
    },
    setSelected(drama, predicate) {
      const dramas = drama ? [drama] : this.dramas;

      dramas.forEach((item) => {
        let changed = false;
        let hasSelected = false;

        item.episodes.episode.forEach((episode) => {
          const nextSelected = predicate(episode);
          if (episode.selected !== nextSelected) {
            changed = true;
          }

          episode.selected = nextSelected;
          if (episode.selected) {
            hasSelected = true;
          }
        });

        if (changed || hasSelected) {
          item.expanded = true;
        }
      });

      this.emitSelectionChange();
    },
    selectAll(drama = null) {
      this.setSelected(drama, () => true);
    },
    clearAll(drama = null) {
      this.setSelected(drama, () => false);
    },
    selectPaid(drama = null) {
      this.setSelected(drama, (episode) => Number(episode.need_pay ?? 0) === 1);
    },
    selectMain(drama = null) {
      this.setSelected(drama, (episode) => this.isMainEpisode(episode));
    },
    isMainEpisode(episode) {
      const name = String(episode.name || "").trim();

      return (
        MAIN_EPISODE_INCLUDE_PATTERNS.some((pattern) => pattern.test(name)) &&
        !MAIN_EPISODE_EXCLUDE_PATTERNS.some((pattern) => pattern.test(name))
      );
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
  padding: 18px 20px 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(246, 250, 253, 0.88));
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
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(47, 93, 124, 0.1);
  border-radius: 16px;
}

.toolbar-group-run {
  background: rgba(255, 241, 235, 0.8);
  border-color: rgba(207, 92, 54, 0.14);
}

.toolbar-label {
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
  flex: 1 1 100%;
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
  padding: 9px 10px;
  color: var(--select-text);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  background: var(--select-bg);
  border: 1px solid var(--select-border);
}

.select-btn:hover {
  background: #e6eef8;
  transform: translateY(-1px);
}

.select-btn-small {
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

.episode-list {
  max-height: 520px;
  padding: 10px 20px 20px;
  overflow-y: auto;
}

.drama-card {
  padding: 14px 0;
  border-bottom: 1px solid rgba(29, 53, 87, 0.08);
}

.drama-card:last-child {
  border-bottom: none;
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
  margin-top: 14px;
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
  word-break: break-word;
}

.episode-title {
  color: var(--text-strong);
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

  .episode-list {
    padding-left: 16px;
    padding-right: 16px;
  }

  .toolbar-group,
  .drama-header {
    align-items: flex-start;
  }

  .toolbar-actions,
  .drama-actions {
    width: 100%;
  }

  .toolbar-actions-select {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .select-btn {
    font-size: 12px;
  }

  .run-btn {
    flex: 1 1 calc(50% - 4px);
  }
}
</style>
