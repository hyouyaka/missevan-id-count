<template>
  <div class="output-panel">
    <div class="output-status-card">
      <div class="status-header">
        <div>
          <div class="status-kicker">运行状态</div>
          <div class="status-text">{{ currentAction || "等待执行操作" }}</div>
        </div>
        <div class="status-side">
          <div v-if="isRunning" class="status-badge">运行中</div>
          <div class="status-progress">{{ progress }}%</div>
        </div>
      </div>

      <div class="status-note">
        手机浏览器切到后台后，系统可能暂停页面执行。长任务建议保持页面在前台。
      </div>

      <div class="output-progress">
        <div class="output-progress-bar" :style="{ width: `${progress}%` }"></div>
      </div>
    </div>

    <div v-if="playCountResults.length" class="output-section">
      <div class="output-section-title">播放量统计</div>

      <div class="output-list">
        <div
          v-for="drama in playCountResults"
          :key="`play-${drama.title}`"
          class="output-card"
        >
          <div class="output-card-title">
            {{ drama.title }} · 已选 {{ drama.selectedEpisodeCount }} 集
          </div>

          <div class="output-stats output-stats-single">
            <div class="output-stat-item">
              <div class="output-stat-label">总播放量</div>
              <div class="output-stat-value">
                {{ formatPlayCountDisplay(drama.playCountTotal, drama.playCountFailed) }}
              </div>
            </div>
          </div>
        </div>

        <div class="output-summary-card">
          <div class="output-card-title">
            汇总 · 已选 {{ playCountSelectedEpisodeCount }} 集
          </div>

          <div class="output-stats output-stats-single">
            <div class="output-stat-item">
              <div class="output-stat-label">总播放量</div>
              <div class="output-stat-value">
                {{ formatPlayCountDisplay(playCountTotal, playCountFailed) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="idResults.length" class="output-section">
      <div class="output-section-title">ID 与弹幕统计</div>

      <div class="output-list">
        <div
          v-for="drama in idResults"
          :key="`id-${drama.title}`"
          class="output-card"
        >
          <div class="output-card-title">
            {{ drama.title }} · 已选 {{ drama.selectedEpisodeCount }} 集
          </div>

          <div class="output-stats">
            <div class="output-stat-item">
              <div class="output-stat-label">总弹幕数</div>
              <div class="output-stat-value">{{ drama.danmaku }}</div>
            </div>

            <div class="output-stat-item">
              <div class="output-stat-label">去重 ID 数</div>
              <div class="output-stat-value">{{ drama.users }}</div>
            </div>
          </div>
        </div>

        <div class="output-summary-card">
          <div class="output-card-title">
            汇总 · 已选 {{ idSelectedEpisodeCount }} 集
          </div>

          <div class="output-stats">
            <div class="output-stat-item">
              <div class="output-stat-label">总弹幕数</div>
              <div class="output-stat-value">{{ totalDanmaku }}</div>
            </div>

            <div class="output-stat-item">
              <div class="output-stat-label">去重 ID 数</div>
              <div class="output-stat-value">{{ totalUsers }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="revenueResults.length" class="output-section">
      <div class="output-section-title">最低收益预估</div>

      <div class="output-list">
        <div
          v-for="drama in revenueResults"
          :key="`revenue-${drama.dramaId}`"
          class="output-card"
        >
          <div class="output-card-title">
            {{ drama.title }} · 单价 {{ formatDiamond(drama.price) }}
          </div>

          <div class="output-stats">
            <div class="output-stat-item">
              <div class="output-stat-label">付费用户 ID 数</div>
              <div class="output-stat-value">
                {{ drama.failed ? "访问失败" : drama.paidUserCount }}
              </div>
            </div>

            <div class="output-stat-item">
              <div class="output-stat-label">打赏榜总额</div>
              <div class="output-stat-value">
                {{ drama.failed ? "访问失败" : formatDiamond(drama.rewardCoinTotal) }}
              </div>
            </div>
          </div>

          <div class="output-revenue-line">
            <div class="output-stat-label">最低收益</div>
            <div class="output-stat-value">
              {{ drama.failed ? "最低收益预估失败" : formatRevenue(drama.estimatedRevenueYuan) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    progress: {
      type: Number,
      default: 0,
    },
    currentAction: {
      type: String,
      default: "",
    },
    playCountResults: {
      type: Array,
      default: () => [],
    },
    playCountSelectedEpisodeCount: {
      type: Number,
      default: 0,
    },
    playCountTotal: {
      type: Number,
      default: 0,
    },
    playCountFailed: {
      type: Boolean,
      default: false,
    },
    idResults: {
      type: Array,
      default: () => [],
    },
    idSelectedEpisodeCount: {
      type: Number,
      default: 0,
    },
    totalDanmaku: {
      type: Number,
      default: 0,
    },
    totalUsers: {
      type: Number,
      default: 0,
    },
    revenueResults: {
      type: Array,
      default: () => [],
    },
    isRunning: {
      type: Boolean,
      default: false,
    },
  },
  methods: {
    formatPlayCountWan(value) {
      const count = Number(value);

      if (!Number.isFinite(count) || count <= 0) {
        return "0.0万";
      }

      return `${(count / 10000).toFixed(1)}万`;
    },
    formatPlayCountDisplay(value, failed) {
      return failed ? "部分分集播放量统计失败" : this.formatPlayCountWan(value);
    },
    formatDiamond(value) {
      return `${Number(value ?? 0)} 钻石`;
    },
    formatRevenue(value) {
      const amount = Number(value ?? 0);

      if (!Number.isFinite(amount) || amount <= 0) {
        return "0 元";
      }

      if (amount >= 100000000) {
        return `${(amount / 100000000).toFixed(2)} 亿元`;
      }

      if (amount >= 10000) {
        return `${(amount / 10000).toFixed(1)} 万元`;
      }

      return `${Math.round(amount)} 元`;
    },
  },
};
</script>

<style scoped>
.output-panel {
  display: grid;
  gap: 18px;
  padding: 20px;
}

.output-status-card,
.output-card,
.output-summary-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(29, 53, 87, 0.08);
  border-radius: 16px;
}

.output-status-card {
  background:
    linear-gradient(135deg, rgba(255, 241, 235, 0.9), rgba(255, 255, 255, 0.86));
  border-color: rgba(207, 92, 54, 0.12);
}

.status-header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.status-kicker {
  margin-bottom: 6px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.status-text {
  font-size: 17px;
  font-weight: 700;
}

.status-side {
  display: flex;
  gap: 8px;
  align-items: center;
}

.status-badge {
  padding: 4px 10px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  background: linear-gradient(135deg, #2f5d7c, #244962);
  border-radius: 999px;
}

.status-progress {
  color: var(--accent-strong);
  font-size: 20px;
  font-weight: 800;
}

.status-note {
  margin-bottom: 12px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.output-progress {
  height: 12px;
  overflow: hidden;
  background: rgba(207, 92, 54, 0.12);
  border-radius: 999px;
}

.output-progress-bar {
  height: 100%;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border-radius: inherit;
  transition: width 0.3s ease;
}

.output-section {
  display: grid;
  gap: 12px;
}

.output-section-title {
  color: var(--text-strong);
  font-size: 17px;
  font-weight: 800;
}

.output-list {
  display: grid;
  gap: 12px;
}

.output-summary-card {
  background: rgba(238, 244, 251, 0.8);
  border-color: rgba(47, 93, 124, 0.12);
}

.output-card-title {
  margin-bottom: 10px;
  font-weight: 700;
  line-height: 1.5;
}

.output-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}

.output-stats-single {
  grid-template-columns: 1fr;
}

.output-stat-label {
  margin-bottom: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.output-stat-value {
  color: var(--text-strong);
  font-size: 16px;
  font-weight: 800;
  line-height: 1.45;
}

.output-revenue-line {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(29, 53, 87, 0.1);
}

@media (max-width: 640px) {
  .output-panel {
    padding: 16px;
  }

  .status-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .status-side {
    flex-wrap: wrap;
  }

  .output-stats {
    grid-template-columns: 1fr;
  }
}
</style>
