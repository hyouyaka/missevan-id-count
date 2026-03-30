<template>
  <div class="output-panel">
    <div class="output-status-card">
      <div class="status-header">
        <div>
          <div class="status-kicker">运行状态</div>
          <div class="status-text">{{ currentAction || "等待执行操作" }}</div>
          <div class="status-elapsed">处理用时：{{ formatElapsed(elapsedMs) }}</div>
        </div>
        <div class="status-side">
          <div v-if="isRunning" class="status-badge">进行中</div>
          <button
            v-if="isRunning"
            type="button"
            class="status-cancel-btn"
            @click="$emit('cancelStatistics')"
          >
            取消
          </button>
          <div class="status-progress">{{ progress }}%</div>
        </div>
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
            {{ drama.title }} / 已选 {{ drama.selectedEpisodeCount }} 集
          </div>
          <div class="output-stat-label">总播放量</div>
          <div class="output-stat-value">
            {{ formatPlayCountDisplay(drama.playCountTotal, drama.playCountFailed) }}
          </div>
        </div>

        <div class="output-summary-card">
          <div class="output-card-title">汇总 / 已选 {{ playCountSelectedEpisodeCount }} 集</div>
          <div class="output-stat-label">总播放量</div>
          <div class="output-stat-value">
            {{ formatPlayCountDisplay(playCountTotal, playCountFailed) }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="idResults.length" class="output-section">
      <div class="output-section-title">弹幕与去重 ID 统计</div>
      <div class="output-list">
        <div
          v-for="drama in idResults"
          :key="`id-${drama.title}`"
          class="output-card"
        >
          <div class="output-card-title">
            {{ drama.title }} / 已选 {{ drama.selectedEpisodeCount }} 集
          </div>
          <div class="output-stats">
            <div>
              <div class="output-stat-label">总弹幕数</div>
              <div class="output-stat-value">{{ drama.danmaku }}</div>
            </div>
            <div>
              <div class="output-stat-label">去重 ID 数</div>
              <div class="output-stat-value">{{ drama.users }}</div>
            </div>
          </div>
        </div>

        <div class="output-summary-card">
          <div class="output-card-title">汇总 / 已选 {{ idSelectedEpisodeCount }} 集</div>
          <div class="output-stats">
            <div>
              <div class="output-stat-label">总弹幕数</div>
              <div class="output-stat-value">{{ totalDanmaku }}</div>
            </div>
            <div>
              <div class="output-stat-label">去重 ID 数</div>
              <div class="output-stat-value">{{ totalUsers }}</div>
            </div>
          </div>
          <div
            v-if="Array.isArray(suspectedOverflowEpisodes) && suspectedOverflowEpisodes.length"
            class="output-overflow-list"
          >
            <div class="output-stat-label">疑似弹幕溢出分集</div>
            <div
              v-for="title in suspectedOverflowEpisodes"
              :key="`overflow-id-${title}`"
              class="output-overflow-item"
            >
              {{ title }}
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
            {{ drama.subtitle || `${drama.title} / 单价 ${formatDiamond(drama.price)}` }}
          </div>
          <div class="output-stats">
            <div>
              <div class="output-stat-label">付费用户 ID 数</div>
              <div class="output-stat-value">
                {{ drama.failed ? "访问失败" : drama.paidUserCount }}
              </div>
            </div>
            <div>
              <div class="output-stat-label">
                {{ getRewardLabel(drama) }}
              </div>
              <div class="output-stat-value">
                {{
                  drama.failed
                    ? "访问失败"
                    : formatRewardValue(
                        drama.platform,
                        drama.platform === "manbo" ? drama.diamondValue : drama.rewardCoinTotal
                      )
                }}
              </div>
            </div>
            <div v-if="hasRewardNum(drama)">
              <div class="output-stat-label">打赏人数</div>
              <div class="output-stat-value">{{ formatPlainCountValue(drama.rewardNum) }}</div>
            </div>
          </div>
          <div class="output-revenue-line">
            <div class="output-stat-label">{{ getRevenueLabel(drama) }}</div>
            <div class="output-stat-value">
              {{
                drama.failed
                  ? "预估失败"
                  : shouldShowRevenueRange(drama)
                    ? formatRevenueRange(drama.minRevenueYuan, drama.maxRevenueYuan)
                    : formatRevenue(drama.estimatedRevenueYuan)
              }}
            </div>
          </div>
        </div>

        <div v-if="revenueSummary" class="output-summary-card">
          <div class="output-card-title">
            {{ revenueSummary.summaryTitle || `汇总 / 已选 ${revenueSummary.selectedDramaCount} 部` }}
          </div>
          <div class="output-stats">
            <div>
              <div class="output-stat-label">总和去重 ID</div>
              <div class="output-stat-value">
                {{ revenueSummary.failed ? "访问失败" : revenueSummary.totalPaidUserCount }}
              </div>
            </div>
            <div>
              <div class="output-stat-label">总播放量</div>
              <div class="output-stat-value">
                {{ revenueSummary.failed ? "访问失败" : formatPlayCountWanFixed(revenueSummary.totalViewCount) }}
              </div>
            </div>
            <div>
              <div class="output-stat-label">
                {{ getRewardLabel(revenueSummary, true) }}
              </div>
              <div class="output-stat-value">
                {{
                  revenueSummary.failed
                    ? "访问失败"
                    : formatRewardValue(revenueSummary.platform, revenueSummary.rewardTotal)
                }}
              </div>
            </div>
            <div v-if="hasRewardNum(revenueSummary)">
              <div class="output-stat-label">打赏人次</div>
              <div class="output-stat-value">{{ formatPlainCountValue(revenueSummary.rewardNum) }}</div>
            </div>
          </div>
          <div class="output-revenue-line">
            <div class="output-stat-label">收益预估</div>
            <div class="output-stat-value">
              {{
                revenueSummary.failed
                  ? "预估失败"
                  : shouldShowRevenueRange(revenueSummary)
                    ? formatRevenueRange(revenueSummary.minRevenueYuan, revenueSummary.maxRevenueYuan)
                    : formatRevenue(revenueSummary.estimatedRevenueYuan)
              }}
            </div>
          </div>
          <div
            v-if="Array.isArray(revenueSummary.suspectedOverflowEpisodes) && revenueSummary.suspectedOverflowEpisodes.length"
            class="output-overflow-list"
          >
            <div class="output-stat-label">疑似弹幕溢出分集</div>
            <div
              v-for="title in revenueSummary.suspectedOverflowEpisodes"
              :key="`overflow-revenue-${title}`"
              class="output-overflow-item"
            >
              {{ title }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  emits: ["cancelStatistics"],
  props: {
    progress: Number,
    currentAction: String,
    elapsedMs: Number,
    playCountResults: Array,
    playCountSelectedEpisodeCount: Number,
    playCountTotal: Number,
    playCountFailed: Boolean,
    idResults: Array,
    suspectedOverflowEpisodes: {
      type: Array,
      default: () => [],
    },
    idSelectedEpisodeCount: Number,
    totalDanmaku: Number,
    totalUsers: Number,
    revenueResults: Array,
    revenueSummary: Object,
    isRunning: Boolean,
  },
  methods: {
    getRewardLabel(drama, isSummary = false) {
      if (drama?.platform === "manbo") {
        return "投喂总数";
      }
      return isSummary ? "打赏榜总和" : "打赏榜累计";
    },
    formatRewardValue(platform, value) {
      const amount = Number(value ?? 0);
      return platform === "manbo" ? `${amount} 红豆` : `${amount} 钻石`;
    },
    hasRewardNum(drama) {
      return drama?.platform === "missevan"
        && drama?.rewardNum != null
        && Number.isFinite(Number(drama?.rewardNum));
    },
    formatPlainCountValue(value) {
      const count = Number(value ?? 0);
      if (!Number.isFinite(count)) {
        return "0";
      }
      return `${Math.trunc(count)}`;
    },
    shouldShowRevenueRange(drama) {
      if (!drama || drama.failed) {
        return false;
      }
      if (drama.minRevenueYuan == null || drama.maxRevenueYuan == null) {
        return false;
      }
      return Number.isFinite(Number(drama.minRevenueYuan))
        && Number.isFinite(Number(drama.maxRevenueYuan));
    },
    getRevenueLabel(drama) {
      return drama?.vipOnlyReward ? "预估收益（仅计算打赏）" : "预估收益";
    },
    formatPlayCountDisplay(value, failed) {
      if (failed) {
        return "部分分集统计失败";
      }
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
    formatPlayCountWanFixed(value) {
      const count = Number(value ?? 0);
      if (!Number.isFinite(count) || count <= 0) {
        return "0.0万";
      }
      return `${(count / 10000).toFixed(1)}万`;
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
      if (Number.isInteger(amount)) {
        return `${amount} 元`;
      }
      return `${amount.toFixed(2).replace(/\.?0+$/, "")} 元`;
    },
    formatRevenueRange(minValue, maxValue) {
      return `${this.formatRevenue(minValue)} - ${this.formatRevenue(maxValue)}`;
    },
    formatElapsed(value) {
      const totalSeconds = Math.max(0, Math.floor(Number(value ?? 0) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
      }

      return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    },
  },
};
</script>

<style scoped>
.output-panel {
  display: grid;
  gap: 16px;
  padding: 18px;
}

.output-status-card,
.output-card,
.output-summary-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(29, 53, 87, 0.08);
  border-radius: 18px;
}

.status-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.status-kicker {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.status-text {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
}

.status-elapsed {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 13px;
}

.status-side {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  text-align: right;
}

.status-badge {
  display: inline-flex;
  padding: 6px 10px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  background: linear-gradient(135deg, #2f5d7c, #244962);
  border-radius: 999px;
}

.status-cancel-btn {
  min-height: 34px;
  padding: 6px 14px;
  color: #8a2d18;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  background: rgba(255, 241, 235, 0.9);
  border: 1px solid rgba(207, 92, 54, 0.2);
  border-radius: 999px;
}

.status-cancel-btn:hover {
  background: rgba(255, 233, 224, 0.96);
}

.status-progress {
  font-size: 20px;
  font-weight: 800;
}

.output-progress {
  height: 10px;
  margin-top: 16px;
  overflow: hidden;
  background: rgba(29, 53, 87, 0.08);
  border-radius: 999px;
}

.output-progress-bar {
  height: 100%;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border-radius: inherit;
  transition: width 0.2s ease;
}

.output-section {
  display: grid;
  gap: 12px;
}

.output-section-title {
  font-size: 16px;
  font-weight: 800;
}

.output-list {
  display: grid;
  gap: 12px;
}

.output-card-title {
  font-size: 15px;
  font-weight: 800;
  line-height: 1.5;
}

.output-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.output-stat-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.output-stat-value {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.3;
}

.output-revenue-line {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(29, 53, 87, 0.08);
}

.output-overflow-list {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(29, 53, 87, 0.08);
}

.output-overflow-item {
  font-size: 14px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .output-panel {
    padding: 14px;
  }

  .status-header,
  .output-stats {
    grid-template-columns: 1fr;
  }

  .status-header {
    display: grid;
  }

  .status-side {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    text-align: left;
  }

  .status-badge {
    justify-self: start;
  }

  .status-cancel-btn {
    justify-self: end;
  }

  .status-progress {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
</style>
