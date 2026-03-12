<template>
  <div class="app-shell">
    <header class="hero">
      <p class="hero-eyebrow">Missevan Toolkit</p>
      <h1 class="hero-title">小猫分析</h1>
      <p class="hero-subtitle">
        搜索剧集、导入分集并批量统计播放量、ID 数和最低收益预估。
      </p>
      <p class="hero-disclaimer">
        免责声明：所有统计结果仅供娱乐，与小猫官方无关，也不代表任何官方数据或结论。
      </p>
    </header>

    <div class="app-grid">
      <section ref="searchPanel" class="panel panel-search">
        <SearchPanel
          @resetState="resetSearchFlow"
          @updateResults="searchResults = $event"
          @requestScrollToResults="scrollToSectionAfterRender('results')"
        />
      </section>

      <section ref="searchResults" class="panel panel-results">
        <SearchResults
          :results="searchResults"
          @addDramas="addDramas"
          @startRevenueEstimate="startRevenueEstimate"
        />
      </section>

      <section ref="optionPanel" class="panel panel-options">
        <OptionPanel
          :dramas="dramas"
          @selectionChange="updateSelection"
          @startPlayCountStatistics="startPlayCountStatistics"
          @startIdStatistics="startIdStatistics"
        />
      </section>

      <section ref="outputPanel" class="panel panel-output">
        <OutputPanel
          :progress="progress"
          :currentAction="currentAction"
          :playCountResults="playCountResults"
          :playCountSelectedEpisodeCount="playCountSelectedEpisodeCount"
          :playCountTotal="playCountTotal"
          :playCountFailed="playCountFailed"
          :idResults="idResults"
          :idSelectedEpisodeCount="idSelectedEpisodeCount"
          :totalDanmaku="totalDanmaku"
          :totalUsers="totalUsers"
          :revenueResults="revenueResults"
          :isRunning="isRunning"
        />
      </section>
    </div>

    <nav class="floating-nav" aria-label="页面快速定位">
      <button
        v-for="item in floatingNavItems"
        :key="item.key"
        :class="['floating-nav-btn', { 'is-active': activeSection === item.key }]"
        type="button"
        @click="scrollToSection(item.key)"
      >
        <span class="floating-nav-short" aria-hidden="true">{{ item.icon }}</span>
        <span class="floating-nav-label">{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>

<script>
import { nextTick } from "vue";
import OutputPanel from "./components/OutputPanel.vue";
import OptionPanel from "./components/OptionPanel.vue";
import SearchPanel from "./components/SearchPanel.vue";
import SearchResults from "./components/SearchResults.vue";

const SECTION_REF_MAP = {
  search: "searchPanel",
  results: "searchResults",
  episodes: "optionPanel",
  output: "outputPanel",
};

export default {
  components: {
    SearchPanel,
    SearchResults,
    OptionPanel,
    OutputPanel,
  },
  data() {
    return {
      searchResults: [],
      dramas: [],
      selectedEpisodesSnapshot: [],
      progress: 0,
      currentAction: "",
      playCountResults: [],
      playCountSelectedEpisodeCount: 0,
      playCountTotal: 0,
      playCountFailed: false,
      idResults: [],
      idSelectedEpisodeCount: 0,
      totalDanmaku: 0,
      totalUsers: 0,
      revenueResults: [],
      activeSection: "search",
      floatingNavItems: [
        { key: "search", icon: "🔍", label: "搜索" },
        { key: "results", icon: "🎭", label: "剧集" },
        { key: "episodes", icon: "🎬", label: "分集" },
        { key: "output", icon: "📊", label: "统计" },
      ],
      sectionObserver: null,
      isRunning: false,
      activeRunId: 0,
      activeAbortController: null,
    };
  },
  mounted() {
    this.setupSectionObserver();
  },
  beforeUnmount() {
    if (this.sectionObserver) {
      this.sectionObserver.disconnect();
      this.sectionObserver = null;
    }

    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  },
  methods: {
    resetOutputs() {
      this.progress = 0;
      this.currentAction = "";
      this.playCountResults = [];
      this.playCountSelectedEpisodeCount = 0;
      this.playCountTotal = 0;
      this.playCountFailed = false;
      this.idResults = [];
      this.idSelectedEpisodeCount = 0;
      this.totalDanmaku = 0;
      this.totalUsers = 0;
      this.revenueResults = [];
    },
    resetStatisticsOutputs() {
      this.progress = 0;
      this.currentAction = "";
      this.playCountResults = [];
      this.playCountSelectedEpisodeCount = 0;
      this.playCountTotal = 0;
      this.playCountFailed = false;
      this.idResults = [];
      this.idSelectedEpisodeCount = 0;
      this.totalDanmaku = 0;
      this.totalUsers = 0;
    },
    resetSearchFlow() {
      this.cancelActiveRun();
      this.searchResults = [];
      this.dramas = [];
      this.selectedEpisodesSnapshot = [];
      this.resetOutputs();
    },
    updateSelection(selectedEpisodes) {
      this.selectedEpisodesSnapshot = selectedEpisodes;

      if (!this.isRunning) {
        this.progress = 0;
        this.currentAction = "";
      }
    },
    getSectionElement(sectionKey) {
      const refName = SECTION_REF_MAP[sectionKey];
      return refName ? this.$refs[refName] : null;
    },
    getScrollOffset() {
      return window.innerWidth <= 640 ? 84 : 96;
    },
    scrollToSection(sectionKey) {
      const target = this.getSectionElement(sectionKey);
      if (!target) {
        return;
      }

      const top =
        window.scrollY + target.getBoundingClientRect().top - this.getScrollOffset();
      window.scrollTo({
        top: Math.max(top, 0),
        behavior: "smooth",
      });
      this.activeSection = sectionKey;
    },
    async scrollToSectionAfterRender(sectionKey) {
      await nextTick();
      this.scrollToSection(sectionKey);
    },
    setupSectionObserver() {
      if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
        return;
      }

      const entriesMap = new Map();
      this.sectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const sectionKey = entry.target.dataset.sectionKey;
            if (sectionKey) {
              entriesMap.set(sectionKey, entry);
            }
          });

          let bestKey = this.activeSection;
          let bestRatio = 0;

          entriesMap.forEach((entry, key) => {
            if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
              bestKey = key;
              bestRatio = entry.intersectionRatio;
            }
          });

          this.activeSection = bestKey;
        },
        {
          root: null,
          rootMargin: "-20% 0px -55% 0px",
          threshold: [0.2, 0.4, 0.6],
        }
      );

      Object.entries(SECTION_REF_MAP).forEach(([sectionKey, refName]) => {
        const element = this.$refs[refName];
        if (element) {
          element.dataset.sectionKey = sectionKey;
          this.sectionObserver.observe(element);
        }
      });
    },
    beginRun() {
      this.cancelActiveRun();
      this.activeRunId += 1;
      this.isRunning = true;
      this.activeAbortController = new AbortController();

      return {
        runId: this.activeRunId,
        signal: this.activeAbortController.signal,
      };
    },
    cancelActiveRun() {
      if (this.activeAbortController) {
        this.activeAbortController.abort();
        this.activeAbortController = null;
      }

      this.isRunning = false;
    },
    finishRun(runId) {
      if (runId !== this.activeRunId) {
        return;
      }

      this.isRunning = false;
      this.activeAbortController = null;
    },
    isRunActive(runId) {
      return this.isRunning && runId === this.activeRunId;
    },
    isAbortError(error) {
      return error?.name === "AbortError";
    },
    async postJson(url, payload, signal, errorMessage) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        throw new Error(`${errorMessage}: ${response.status}`);
      }

      return response.json();
    },
    buildPlayCountResults(selectedEpisodes) {
      const dramaMap = new Map();

      selectedEpisodes.forEach((episode) => {
        if (!dramaMap.has(episode.drama_title)) {
          dramaMap.set(episode.drama_title, {
            title: episode.drama_title,
            selectedEpisodeCount: 0,
            playCountTotal: 0,
            playCountFailed: false,
          });
        }

        const drama = dramaMap.get(episode.drama_title);
        drama.selectedEpisodeCount += 1;

        if (episode.playCountFailed) {
          drama.playCountFailed = true;
        } else {
          drama.playCountTotal += Number(episode.view_count ?? 0);
        }
      });

      return Array.from(dramaMap.values());
    },
    buildIdResults(selectedEpisodes) {
      const dramaMap = new Map();

      selectedEpisodes.forEach((episode) => {
        if (!dramaMap.has(episode.drama_title)) {
          dramaMap.set(episode.drama_title, {
            title: episode.drama_title,
            selectedEpisodeCount: 0,
            danmaku: 0,
            userSet: new Set(),
          });
        }

        dramaMap.get(episode.drama_title).selectedEpisodeCount += 1;
      });

      return dramaMap;
    },
    async fetchEpisodeSummaries(soundIds, signal) {
      return this.postJson(
        "/getsoundsummary",
        { sound_ids: soundIds },
        signal,
        "获取单集播放量失败"
      );
    },
    async fetchRewardSummary(dramaId, signal) {
      return this.postJson(
        "/getrewardsummary",
        { drama_id: dramaId },
        signal,
        "获取打赏榜失败"
      );
    },
    getSearchResultById(dramaId) {
      return this.searchResults.find((item) => Number(item.id) === Number(dramaId));
    },
    getLoadedDramaById(dramaId) {
      return this.dramas.find(
        (item) => Number(item?.drama?.id) === Number(dramaId)
      );
    },
    async fetchDramaById(dramaId, signal) {
      const loaded = this.getLoadedDramaById(dramaId);
      if (loaded) {
        return loaded;
      }

      const searchResult = this.getSearchResultById(dramaId);
      const soundIdMap = {};
      if (Number(searchResult?.sound_id) > 0) {
        soundIdMap[dramaId] = Number(searchResult.sound_id);
      }

      const data = await this.postJson(
        "/getdramas",
        { drama_ids: [dramaId], sound_id_map: soundIdMap },
        signal,
        "加载剧集失败"
      );
      const result = data[0];

      if (!result?.success) {
        const error = new Error(`加载剧集失败: ${dramaId}`);
        error.accessDenied = Boolean(result?.accessDenied);
        throw error;
      }

      return result.info;
    },
    getPaidEpisodes(dramaInfo) {
      const episodes = dramaInfo?.episodes?.episode || [];
      return episodes.filter((episode) => {
        const needPay = Number(episode.need_pay ?? 0) === 1;
        const price = Number(episode.price ?? 0) > 0;
        return needPay || price;
      });
    },
    async addDramas(ids) {
      const { runId, signal } = this.beginRun();

      this.progress = 0;
      this.currentAction = "开始导入分集";
      this.dramas = [];
      this.selectedEpisodesSnapshot = [];
      this.resetStatisticsOutputs();

      if (!ids || ids.length === 0) {
        this.currentAction = "未选择剧集";
        this.finishRun(runId);
        return;
      }

      let hasAccessDenied = false;

      try {
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i];
          this.currentAction = `正在导入剧集 ${id}`;

          try {
            const drama = await this.fetchDramaById(id, signal);

            if (!this.isRunActive(runId)) {
              return;
            }

            drama.expanded = false;
            drama.episodes.episode.forEach((episode) => {
              episode.selected = false;
            });

            this.dramas.push(drama);
            this.currentAction = `已导入剧集 ${id} - ${drama.drama.name}`;
          } catch (error) {
            if (this.isAbortError(error)) {
              return;
            }

            if (error?.accessDenied) {
              hasAccessDenied = true;
            }
            console.error(`导入剧集失败 ${id}`, error);
          }

          if (!this.isRunActive(runId)) {
            return;
          }

          this.progress = Math.floor(((i + 1) / ids.length) * 100);
        }

        this.currentAction = hasAccessDenied ? "猫耳访问受限" : "分集导入完成";

        if (this.dramas.length) {
          this.scrollToSectionAfterRender("episodes");
        }
      } finally {
        this.finishRun(runId);
      }
    },
    async startPlayCountStatistics(soundIds) {
      const { runId, signal } = this.beginRun();
      const selectedEpisodes = this.selectedEpisodesSnapshot.filter((episode) =>
        soundIds.includes(episode.sound_id)
      );

      this.playCountResults = [];
      this.playCountSelectedEpisodeCount = 0;
      this.playCountTotal = 0;
      this.playCountFailed = false;
      this.progress = 0;

      if (!selectedEpisodes.length) {
        this.currentAction = "未选择分集";
        this.finishRun(runId);
        return;
      }

      this.currentAction = "开始统计播放量";
      this.playCountSelectedEpisodeCount = selectedEpisodes.length;
      this.scrollToSection("output");

      const enrichedEpisodes = [];
      let hasAccessDenied = false;

      try {
        for (let i = 0; i < selectedEpisodes.length; i += 1) {
          const episode = selectedEpisodes[i];
          this.currentAction = `正在统计播放量 ${i + 1}/${selectedEpisodes.length}`;

          try {
            const summaries = await this.fetchEpisodeSummaries([episode.sound_id], signal);
            if (!this.isRunActive(runId)) {
              return;
            }

            const summary = summaries[0];

            if (!summary || summary.playCountFailed) {
              enrichedEpisodes.push({
                ...episode,
                view_count: 0,
                playCountFailed: true,
              });
              if (summary?.accessDenied) {
                hasAccessDenied = true;
              }
            } else {
              enrichedEpisodes.push({
                ...episode,
                view_count: Number(summary.view_count ?? 0),
                playCountFailed: false,
              });
            }
          } catch (error) {
            if (this.isAbortError(error)) {
              return;
            }

            hasAccessDenied = true;
            enrichedEpisodes.push({
              ...episode,
              view_count: 0,
              playCountFailed: true,
            });
            console.error(`统计播放量失败 ${episode.sound_id}`, error);
          }

          if (!this.isRunActive(runId)) {
            return;
          }

          this.progress = Math.floor(((i + 1) / selectedEpisodes.length) * 100);
        }

        if (!this.isRunActive(runId)) {
          return;
        }

        this.playCountResults = this.buildPlayCountResults(enrichedEpisodes);
        this.playCountTotal = enrichedEpisodes.reduce((sum, episode) => {
          if (episode.playCountFailed) {
            return sum;
          }

          return sum + Number(episode.view_count ?? 0);
        }, 0);
        this.playCountFailed = enrichedEpisodes.some(
          (episode) => episode.playCountFailed
        );
        this.currentAction = hasAccessDenied ? "猫耳访问受限" : "播放量统计完成";
      } finally {
        this.finishRun(runId);
      }
    },
    async startIdStatistics(soundIds) {
      const { runId, signal } = this.beginRun();
      const selectedEpisodes = this.selectedEpisodesSnapshot.filter((episode) =>
        soundIds.includes(episode.sound_id)
      );

      this.idResults = [];
      this.idSelectedEpisodeCount = 0;
      this.totalDanmaku = 0;
      this.totalUsers = 0;
      this.progress = 0;

      if (!selectedEpisodes.length) {
        this.currentAction = "未选择分集";
        this.finishRun(runId);
        return;
      }

      this.currentAction = "开始统计 ID 数";
      this.idSelectedEpisodeCount = selectedEpisodes.length;
      this.scrollToSection("output");

      const dramaMap = this.buildIdResults(selectedEpisodes);
      const allUsers = new Set();
      let failedCount = 0;
      let accessDenied = false;

      try {
        for (let i = 0; i < selectedEpisodes.length; i += 1) {
          const episode = selectedEpisodes[i];
          this.currentAction = `正在统计 ID 数 ${i + 1}/${selectedEpisodes.length}`;

          try {
            const result = await this.postJson(
              "/getsounddanmaku",
              {
                sound_id: episode.sound_id,
                drama_title: episode.drama_title,
              },
              signal,
              "统计 ID 数失败"
            );

            if (!this.isRunActive(runId)) {
              return;
            }

            if (result.success) {
              const drama = dramaMap.get(result.drama_title);
              if (drama) {
                drama.danmaku += result.danmaku;
                result.users.forEach((uid) => {
                  drama.userSet.add(uid);
                  allUsers.add(uid);
                });
              }
              this.totalDanmaku += result.danmaku;
            } else {
              failedCount += 1;
              if (result.accessDenied) {
                accessDenied = true;
              }
            }
          } catch (error) {
            if (this.isAbortError(error)) {
              return;
            }

            failedCount += 1;
            accessDenied = true;
            console.error(`统计 ID 数失败 ${episode.sound_id}`, error);
          }

          if (!this.isRunActive(runId)) {
            return;
          }

          this.progress = Math.floor(((i + 1) / selectedEpisodes.length) * 100);
        }

        if (!this.isRunActive(runId)) {
          return;
        }

        this.idResults = Array.from(dramaMap.values()).map((drama) => ({
          title: drama.title,
          selectedEpisodeCount: drama.selectedEpisodeCount,
          danmaku: drama.danmaku,
          users: drama.userSet.size,
        }));
        this.totalUsers = allUsers.size;
        this.currentAction = accessDenied
          ? "猫耳访问受限"
          : failedCount > 0
            ? `ID 数统计完成，已跳过 ${failedCount} 个分集`
            : "ID 数统计完成";
      } finally {
        this.finishRun(runId);
      }
    },
    async startRevenueEstimate(dramaIds) {
      const { runId, signal } = this.beginRun();

      this.revenueResults = [];
      this.progress = 0;

      if (!dramaIds || dramaIds.length === 0) {
        this.currentAction = "未选择剧集";
        this.finishRun(runId);
        return;
      }

      this.currentAction = "开始最低收益预估";
      this.scrollToSection("output");

      const dramaContexts = [];
      let totalTasks = 0;

      try {
        for (const rawDramaId of dramaIds) {
          const dramaId = Number(rawDramaId);
          const searchResult = this.getSearchResultById(dramaId);
          const fallbackTitle = searchResult?.name || `Drama ${dramaId}`;
          const fallbackPrice = Number(searchResult?.price ?? 0);

          try {
            const dramaInfo = await this.fetchDramaById(dramaId, signal);
            if (!this.isRunActive(runId)) {
              return;
            }

            const dramaMeta = dramaInfo?.drama || {};
            const paidEpisodes = this.getPaidEpisodes(dramaInfo);

            dramaContexts.push({
              dramaId,
              fallbackTitle,
              fallbackPrice,
              title: dramaMeta.name || fallbackTitle,
              price: Number(dramaMeta.price ?? searchResult?.price ?? 0),
              paidEpisodes,
            });
            totalTasks += paidEpisodes.length + 1;
          } catch (error) {
            if (this.isAbortError(error)) {
              return;
            }

            console.error(`预加载收益数据失败 ${dramaId}`, error);
            dramaContexts.push({
              dramaId,
              fallbackTitle,
              fallbackPrice,
              preloadFailed: true,
              preloadAccessDenied: Boolean(error?.accessDenied),
            });
            totalTasks += 1;
          }
        }

        let completedTasks = 0;
        const results = [];

        for (let i = 0; i < dramaContexts.length; i += 1) {
          const context = dramaContexts[i];
          const {
            dramaId,
            fallbackTitle,
            fallbackPrice,
            title,
            price,
            paidEpisodes,
            preloadFailed,
            preloadAccessDenied,
          } = context;

          if (preloadFailed) {
            completedTasks += 1;
            this.progress = totalTasks
              ? Math.floor((completedTasks / totalTasks) * 100)
              : 100;
            results.push({
              dramaId,
              title: fallbackTitle,
              price: fallbackPrice,
              paidUserCount: 0,
              rewardCoinTotal: 0,
              estimatedRevenueYuan: 0,
              failed: true,
              accessDenied: preloadAccessDenied,
            });
            continue;
          }

          try {
            const allUsers = new Set();
            let accessDenied = false;
            let failed = false;

            for (const episode of paidEpisodes) {
              this.currentAction = `正在预估收益 ${i + 1}/${dramaContexts.length}`;
              const result = await this.postJson(
                "/getsounddanmaku",
                {
                  sound_id: episode.sound_id,
                  drama_title: title,
                },
                signal,
                "预估收益失败"
              );

              if (!this.isRunActive(runId)) {
                return;
              }

              if (result.success) {
                result.users.forEach((uid) => {
                  allUsers.add(uid);
                });
              } else {
                failed = true;
                if (result.accessDenied) {
                  accessDenied = true;
                }
                completedTasks += 1;
                this.progress = totalTasks
                  ? Math.floor((completedTasks / totalTasks) * 100)
                  : 100;
                break;
              }

              completedTasks += 1;
              this.progress = totalTasks
                ? Math.floor((completedTasks / totalTasks) * 100)
                : 100;
            }

            let rewardCoinTotal = 0;
            if (!failed) {
              const rewardSummary = await this.fetchRewardSummary(dramaId, signal);

              if (!this.isRunActive(runId)) {
                return;
              }

              if (rewardSummary.success) {
                rewardCoinTotal = Number(rewardSummary.rewardCoinTotal ?? 0);
              } else {
                failed = true;
                accessDenied = accessDenied || Boolean(rewardSummary.accessDenied);
              }
            }

            completedTasks += 1;
            this.progress = totalTasks
              ? Math.floor((completedTasks / totalTasks) * 100)
              : 100;

            const paidUserCount = allUsers.size;
            const estimatedRevenueYuan =
              (paidUserCount * price + rewardCoinTotal) / 10;

            results.push({
              dramaId,
              title,
              price,
              paidUserCount,
              rewardCoinTotal,
              estimatedRevenueYuan,
              failed,
              accessDenied,
            });
          } catch (error) {
            if (this.isAbortError(error)) {
              return;
            }

            const accessDenied = Boolean(error?.accessDenied);
            console.error(`最低收益预估失败 ${dramaId}`, error);
            completedTasks += 1;
            this.progress = totalTasks
              ? Math.floor((completedTasks / totalTasks) * 100)
              : 100;
            results.push({
              dramaId,
              title: fallbackTitle,
              price: fallbackPrice,
              paidUserCount: 0,
              rewardCoinTotal: 0,
              estimatedRevenueYuan: 0,
              failed: true,
              accessDenied,
            });
          }

          this.progress = Math.floor(((i + 1) / dramaIds.length) * 100);
        }

        if (!this.isRunActive(runId)) {
          return;
        }

        this.revenueResults = results;
        this.currentAction = results.some((item) => item.accessDenied)
          ? "猫耳访问受限"
          : results.some((item) => item.failed)
            ? "最低收益预估完成，部分失败"
            : "最低收益预估完成";
      } finally {
        this.finishRun(runId);
      }
    },
  },
};
</script>

<style>
:root {
  color-scheme: light;
  --page-bg: linear-gradient(180deg, #f6f1e8 0%, #eef4fb 35%, #f7fafc 100%);
  --panel-bg: rgba(255, 255, 255, 0.88);
  --panel-border: rgba(29, 53, 87, 0.09);
  --panel-shadow: 0 18px 45px rgba(31, 43, 58, 0.08);
  --text-strong: #1f2a37;
  --text-muted: #607080;
  --accent: #cf5c36;
  --accent-strong: #b54c28;
  --accent-soft: #fff1eb;
  --select-bg: #eef4fb;
  --select-border: #c8d8ea;
  --select-text: #2f5d7c;
  --warning: #ad7a00;
  --radius-lg: 22px;
  --radius-md: 14px;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  color: var(--text-strong);
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--page-bg);
}

button,
input,
textarea {
  font: inherit;
}

.app-shell {
  max-width: 1180px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 20px 110px;
}

.hero {
  margin-bottom: 24px;
  padding: 26px 28px;
  background:
    radial-gradient(circle at top right, rgba(207, 92, 54, 0.14), transparent 38%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(252, 246, 241, 0.88));
  border: 1px solid rgba(207, 92, 54, 0.12);
  border-radius: 28px;
  box-shadow: var(--panel-shadow);
}

.hero-eyebrow {
  margin: 0 0 8px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.hero-title {
  margin: 0;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.1;
}

.hero-subtitle {
  max-width: 720px;
  margin: 12px 0 0;
  color: var(--text-muted);
  line-height: 1.7;
}

.hero-disclaimer {
  margin: 12px 0 0;
  padding: 12px 14px;
  color: #8a4b35;
  font-size: 13px;
  line-height: 1.7;
  background: rgba(255, 241, 235, 0.82);
  border: 1px solid rgba(207, 92, 54, 0.12);
  border-radius: 14px;
}

.app-grid {
  display: grid;
  gap: 18px;
}

.panel {
  overflow: hidden;
  background: var(--panel-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--panel-border);
  border-radius: 22px;
  box-shadow: var(--panel-shadow);
}

.floating-nav {
  position: fixed;
  right: 14px;
  bottom: calc(18px + env(safe-area-inset-bottom, 0px));
  z-index: 40;
  display: grid;
  gap: 10px;
}

.floating-nav-btn {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  min-width: 88px;
  padding: 10px 12px;
  color: var(--text-strong);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(29, 53, 87, 0.08);
  border-radius: 999px;
  box-shadow: 0 14px 28px rgba(31, 43, 58, 0.14);
  backdrop-filter: blur(10px);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.floating-nav-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 30px rgba(31, 43, 58, 0.16);
}

.floating-nav-btn.is-active {
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border-color: transparent;
}

.floating-nav-short {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
}

.floating-nav-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

@media (min-width: 900px) {
  .floating-nav {
    right: 20px;
  }

  .floating-nav-btn {
    min-width: 76px;
    padding: 9px 11px;
    opacity: 0.88;
  }

  .floating-nav-label {
    font-size: 11px;
  }
}

@media (max-width: 640px) {
  .app-shell {
    padding: 18px 12px 120px;
  }

  .hero {
    padding: 22px 18px;
    border-radius: 22px;
  }

  .floating-nav {
    right: 12px;
    gap: 8px;
  }

  .floating-nav-btn {
    min-width: 92px;
    padding: 10px 12px;
  }
}
</style>
