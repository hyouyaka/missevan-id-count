<template>
  <div class="app-shell">
    <header class="hero">
      <p class="hero-eyebrow">{{ appConfig.brandName }}</p>
      <h1 class="hero-title">{{ appConfig.titleZh }}</h1>
      <p class="hero-subtitle">{{ appConfig.description }}</p>
      <div class="platform-switch" role="tablist" aria-label="平台切换">
        <button
          v-for="platform in visiblePlatforms"
          :key="platform.key"
          :class="['platform-btn', { 'is-active': currentPlatform === platform.key }]"
          type="button"
          @click="switchPlatform(platform.key)"
        >
          {{ platform.label }}
        </button>
      </div>
    </header>

    <div class="app-grid">
      <template v-if="currentPlatform !== 'report'">
      <section class="panel panel-search">
        <SearchPanel
          :platform="currentPlatform"
          :isDesktopApp="appConfig.desktopApp"
          :cooldownHours="appConfig.cooldownHours"
          :cooldownUntil="appConfig.cooldownUntil"
          :desktopAppUrl="appConfig.desktopAppUrl"
          @resetState="resetSearchFlow"
          @updateResults="setSearchResults"
        />
      </section>

      <section ref="resultsPanel" class="panel panel-results">
        <SearchResults
          :platform="currentPlatform"
          :results="currentBrowseState.searchResults"
          @addDramas="addDramas"
          @startRevenueEstimate="startRevenueEstimate"
        />
      </section>

      <section ref="optionsPanel" class="panel panel-options">
        <OptionPanel
          :platform="currentPlatform"
          :dramas="currentBrowseState.dramas"
          @selectionChange="updateSelection"
          @startPlayCountStatistics="startPlayCountStatistics"
          @startIdStatistics="startIdStatisticsConcurrent"
        />
      </section>

      <section ref="outputPanel" class="panel panel-output">
        <OutputPanel
          :progress="currentStatsState.progress"
          :currentAction="currentStatsState.currentAction"
          :elapsedMs="currentStatsState.elapsedMs"
          :playCountResults="currentStatsState.playCountResults"
          :playCountSelectedEpisodeCount="currentStatsState.playCountSelectedEpisodeCount"
          :playCountTotal="currentStatsState.playCountTotal"
          :playCountFailed="currentStatsState.playCountFailed"
          :idResults="currentStatsState.idResults"
          :suspectedOverflowEpisodes="currentStatsState.suspectedOverflowEpisodes"
          :idSelectedEpisodeCount="currentStatsState.idSelectedEpisodeCount"
          :totalDanmaku="currentStatsState.totalDanmaku"
          :totalUsers="currentStatsState.totalUsers"
          :revenueResults="currentStatsState.revenueResults"
          :revenueSummary="currentRevenueSummary"
          :isRunning="currentStatsState.isRunning"
          @cancelStatistics="cancelCurrentStatistics"
        />
      </section>
      </template>

      <section v-else class="panel panel-report panel-report-full">
        <DesktopReportPanel />
      </section>
    </div>
  </div>
</template>

<script>
import { defineAsyncComponent } from "vue";
import OutputPanel from "./components/OutputPanel.vue";
import OptionPanel from "./components/OptionPanel.vue";
import SearchPanel from "./components/SearchPanel.vue";
import SearchResults from "./components/SearchResults.vue";

const DesktopReportPanel = defineAsyncComponent(() => import("./components/DesktopReportPanel.vue"));

function createStatsState() {
  return {
    progress: 0,
    currentAction: "",
    startedAt: 0,
    elapsedMs: 0,
    playCountResults: [],
    playCountSelectedEpisodeCount: 0,
    playCountTotal: 0,
    playCountFailed: false,
    idResults: [],
    suspectedOverflowEpisodes: [],
    idSelectedEpisodeCount: 0,
    totalDanmaku: 0,
    totalUsers: 0,
    revenueResults: [],
    revenueSummary: null,
    isRunning: false,
    activeRunId: 0,
    activeAbortController: null,
    activeElapsedTimer: null,
    activeTaskId: "",
    activeTaskType: "",
  };
}

function createPlatformState() {
  return {
    searchResults: [],
    dramas: [],
    selectedEpisodesSnapshot: [],
    stats: createStatsState(),
  };
}

function getDefaultAppConfig() {
  return {
    missevanEnabled: true,
    desktopApp: false,
    brandName: "M&M Toolkit",
    titleZh: "小猫小狐数据分析",
    description: "支持 Missevan 与 Manbo 的作品导入、分集筛选、弹幕统计和数据汇总。",
    cooldownHours: 4,
    cooldownUntil: 0,
    desktopAppUrl: "",
  };
}

export default {
  components: { SearchPanel, SearchResults, OptionPanel, OutputPanel, DesktopReportPanel },
  data() {
    return {
      currentPlatform: "missevan",
      appConfig: getDefaultAppConfig(),
      platforms: [
        { key: "missevan", label: "Missevan" },
        { key: "manbo", label: "Manbo" },
        { key: "report", label: "Excel 报表" },
      ],
      platformStates: {
        missevan: createPlatformState(),
        manbo: createPlatformState(),
      },
    };
  },
  computed: {
    currentBrowseState() {
      if (this.currentPlatform === "report") {
        return null;
      }
      return this.platformStates[this.currentPlatform];
    },
    currentStatsState() {
      if (!this.currentBrowseState) {
        return null;
      }
      return this.currentBrowseState.stats;
    },
    currentRevenueSummary() {
      if (!this.currentStatsState) {
        return null;
      }
      return this.currentStatsState.revenueSummary
        || this.buildRevenueSummary(this.currentStatsState.revenueResults);
    },
    visiblePlatforms() {
      return this.platforms.filter((platform) => {
        if (platform.key === "report") {
          return this.appConfig.desktopApp;
        }
        return platform.key !== "missevan" || this.appConfig.missevanEnabled;
      });
    },
  },
  mounted() {
    this.loadAppConfig();
    if (typeof window !== "undefined") {
      this._pageExitHandler = () => {
        this.notifyAllActiveStatsTaskCancels();
      };
      window.addEventListener("pagehide", this._pageExitHandler);
      window.addEventListener("beforeunload", this._pageExitHandler);
    }
  },
  beforeUnmount() {
    Object.values(this.platformStates).forEach((state) => {
      if (state.stats?.activeAbortController) {
        state.stats.activeAbortController.abort();
      }
      if (state.stats?.activeElapsedTimer) {
        clearInterval(state.stats.activeElapsedTimer);
        state.stats.activeElapsedTimer = null;
      }
    });
    if (typeof window !== "undefined" && this._pageExitHandler) {
      window.removeEventListener("pagehide", this._pageExitHandler);
      window.removeEventListener("beforeunload", this._pageExitHandler);
    }
  },
  methods: {
    scrollToPanel(refName) {
      if (typeof window === "undefined") return;
      this.$nextTick(() => {
        const panel = this.$refs[refName];
        if (panel && typeof panel.scrollIntoView === "function") {
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    },
    updateDocumentTitle() {
      if (typeof document !== "undefined") {
        document.title = this.appConfig.brandName;
      }
    },
    applyAppConfig(config = {}) {
      const defaults = getDefaultAppConfig();
      this.appConfig = {
        missevanEnabled: config.missevanEnabled !== false,
        desktopApp: config.desktopApp === true,
        brandName: config.brandName || defaults.brandName,
        titleZh: config.titleZh || defaults.titleZh,
        description: config.description || defaults.description,
        cooldownHours: Number(config.cooldownHours ?? defaults.cooldownHours) || defaults.cooldownHours,
        cooldownUntil: Number(config.cooldownUntil ?? 0) || 0,
        desktopAppUrl: String(config.desktopAppUrl || "").trim(),
      };
      if (!this.appConfig.missevanEnabled && this.currentPlatform === "missevan") {
        this.currentPlatform = "manbo";
      }
      if (!this.appConfig.desktopApp && this.currentPlatform === "report") {
        this.currentPlatform = this.appConfig.missevanEnabled ? "missevan" : "manbo";
      }
      this.updateDocumentTitle();
    },
    async loadAppConfig() {
      try {
        const response = await fetch("/app-config");
        if (!response.ok) {
          this.applyAppConfig();
          return;
        }
        this.applyAppConfig(await response.json());
      } catch (_) {
        this.applyAppConfig();
      }
    },
    async refreshCooldownState() {
      if (!this.appConfig.desktopApp) {
        await this.loadAppConfig();
      }
    },
    getCooldownMessage() {
      const remainingMs = Math.max(0, Number(this.appConfig.cooldownUntil ?? 0) - Date.now());
      const remainingHours = remainingMs > 0
        ? Math.ceil((remainingMs / (60 * 60 * 1000)) * 10) / 10
        : Number(this.appConfig.cooldownHours ?? 4);
      return `请 ${remainingHours} 小时后再来。`;
    },
    async showMissevanAccessHint() {
      if (this.currentPlatform !== "missevan") return;
      if (!this.appConfig.desktopApp) {
        await this.refreshCooldownState();
      }
      const message = this.appConfig.desktopApp
        ? "如果看到访问受限，请先使用任意浏览器打开猫耳主页完成验证后再重试。"
        : this.getCooldownMessage();
      this.currentStatsState.currentAction = this.appConfig.desktopApp
        ? "访问受限，请先打开猫耳主页验证"
        : message;
      window.alert(message);
    },
    notifyTaskCancel(taskId) {
      if (!taskId) return;
      const url = `/stat-tasks/${taskId}/cancel`;
      try {
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          navigator.sendBeacon(url, new Blob(["{}"], { type: "application/json" }));
          return;
        }
      } catch (_) {}
      fetch(url, { method: "POST", keepalive: true }).catch(() => {});
    },
    switchPlatform(platform) {
      if (platform !== this.currentPlatform) {
        this.currentPlatform = platform;
      }
    },
    notifyAllActiveStatsTaskCancels() {
      Object.values(this.platformStates).forEach((state) => {
        if (state?.stats?.activeTaskId) {
          this.notifyTaskCancel(state.stats.activeTaskId);
        }
      });
    },
    setSearchResults(results) {
      this.currentBrowseState.searchResults = results;
      if (Array.isArray(results) && results.length > 0) {
        this.scrollToPanel("resultsPanel");
      }
    },
    resetOutputs(state = this.currentStatsState) {
      state.progress = 0;
      state.currentAction = "";
      state.startedAt = 0;
      state.elapsedMs = 0;
      state.playCountResults = [];
      state.playCountSelectedEpisodeCount = 0;
      state.playCountTotal = 0;
      state.playCountFailed = false;
      state.idResults = [];
      state.suspectedOverflowEpisodes = [];
      state.idSelectedEpisodeCount = 0;
      state.totalDanmaku = 0;
      state.totalUsers = 0;
      state.revenueResults = [];
      state.revenueSummary = null;
    },
    resetStatisticsOutputs(state = this.currentStatsState) {
      this.resetOutputs(state);
      state.revenueResults = [];
    },
    resetSearchFlow() {
      const state = this.currentBrowseState;
      state.searchResults = [];
      state.dramas = [];
      state.selectedEpisodesSnapshot = [];
    },
    updateSelection(selectedEpisodes) {
      const state = this.currentBrowseState;
      state.selectedEpisodesSnapshot = selectedEpisodes;
    },
    beginRun(state = this.currentStatsState) {
      state.activeRunId += 1;
      state.isRunning = true;
      state.startedAt = Date.now();
      state.elapsedMs = 0;
      state.activeAbortController = new AbortController();
      this.startElapsedClock(state);
      return { runId: state.activeRunId, signal: state.activeAbortController.signal };
    },
    startElapsedClock(state = this.currentStatsState) {
      this.clearElapsedClock(state);
      state.activeElapsedTimer = setInterval(() => {
        if (state.isRunning && state.startedAt) {
          state.elapsedMs = Date.now() - state.startedAt;
        }
      }, 1000);
    },
    clearElapsedClock(state = this.currentStatsState) {
      if (state.activeElapsedTimer) {
        clearInterval(state.activeElapsedTimer);
        state.activeElapsedTimer = null;
      }
    },
    cancelPollingRun(state = this.currentStatsState) {
      const taskId = state.activeTaskId;
      if (state.activeAbortController) {
        state.activeAbortController.abort();
        state.activeAbortController = null;
      }
      if (state.startedAt > 0) {
        state.elapsedMs = Date.now() - state.startedAt;
      }
      this.clearElapsedClock(state);
      state.activeTaskId = "";
      state.activeTaskType = "";
      state.isRunning = false;
      return taskId;
    },
    async cancelActiveRun(state = this.currentStatsState) {
      const taskId = this.cancelPollingRun(state);
      if (taskId) {
        this.notifyTaskCancel(taskId);
      }
    },
    finishRun(state, runId) {
      if (runId !== state.activeRunId) return;
      state.isRunning = false;
      state.activeAbortController = null;
      if (state.startedAt > 0) {
        state.elapsedMs = Date.now() - state.startedAt;
      }
      this.clearElapsedClock(state);
      state.activeTaskId = "";
      state.activeTaskType = "";
    },
    isRunActive(state, runId) {
      return state.isRunning && runId === state.activeRunId;
    },
    isAbortError(error) {
      return error?.name === "AbortError";
    },
    async runWithConcurrency(items, limit, worker) {
      const queue = Array.isArray(items) ? items : [];
      const concurrency = Math.max(1, Number(limit) || 1);
      let nextIndex = 0;
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          while (nextIndex < queue.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            await worker(queue[currentIndex], currentIndex);
          }
        })
      );
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
    async getJson(url, signal, errorMessage) {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`${errorMessage}: ${response.status}`);
      }
      return response.json();
    },
    buildTaskSnapshotUrl(taskId) {
      const normalizedTaskId = String(taskId ?? "").trim();
      const cacheBust = `_ts=${Date.now()}`;
      return `/stat-tasks/${normalizedTaskId}?${cacheBust}`;
    },
    async waitForTaskPoll(signal, delayMs = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    },
    applyTaskSnapshot(state, snapshot) {
      state.progress = Number(snapshot?.progress ?? 0);
      state.currentAction = snapshot?.currentAction || "统计中";
      state.totalDanmaku = Number(snapshot?.totalDanmaku ?? state.totalDanmaku ?? 0);
      state.totalUsers = Number(snapshot?.totalUsers ?? state.totalUsers ?? 0);

      const result = snapshot?.result || {};
      if (Array.isArray(result.playCountResults)) {
        state.playCountResults = result.playCountResults;
        state.playCountSelectedEpisodeCount = Number(
          result.playCountSelectedEpisodeCount ?? state.playCountSelectedEpisodeCount ?? 0
        );
        state.playCountTotal = Number(result.playCountTotal ?? 0);
        state.playCountFailed = Boolean(result.playCountFailed);
      }
      if (Array.isArray(result.idResults)) {
        state.idResults = result.idResults;
        state.suspectedOverflowEpisodes = Array.isArray(result.suspectedOverflowEpisodes)
          ? result.suspectedOverflowEpisodes
          : [];
        state.idSelectedEpisodeCount = Number(
          result.idSelectedEpisodeCount ?? state.idSelectedEpisodeCount ?? 0
        );
        state.totalDanmaku = Number(result.totalDanmaku ?? state.totalDanmaku ?? 0);
        state.totalUsers = Number(result.totalUsers ?? state.totalUsers ?? 0);
      }
      if (Array.isArray(result.revenueResults)) {
        state.revenueResults = result.revenueResults;
        state.revenueSummary = result.revenueSummary || null;
      }
    },
    async startStatsTask(taskType, payload, state, runId, signal) {
      const task = await this.postJson(
        "/stat-tasks",
        {
          platform: this.currentPlatform,
          taskType,
          ...payload,
        },
        signal,
        "Failed to create stats task"
      );
      if (!this.isRunActive(state, runId)) return;
      const taskId = String(task.taskId ?? "").trim();
      state.activeTaskId = taskId;
      state.activeTaskType = task.taskType || taskType;
      this.applyTaskSnapshot(state, task);
      if (!taskId) {
        throw new Error("Stats task missing taskId");
      }

      const initialSnapshot = await this.getJson(
        this.buildTaskSnapshotUrl(taskId),
        signal,
        "Failed to fetch stats task"
      );
      if (!this.isRunActive(state, runId)) return;
      this.applyTaskSnapshot(state, initialSnapshot);
      if (initialSnapshot.status === "completed" || initialSnapshot.status === "cancelled") {
        return;
      }
      if (initialSnapshot.status === "failed") {
        throw new Error(initialSnapshot.error || "Stats task failed");
      }

      while (this.isRunActive(state, runId) && state.activeTaskId === taskId) {
        await this.waitForTaskPoll(signal);
        const snapshot = await this.getJson(
          this.buildTaskSnapshotUrl(taskId),
          signal,
          "Failed to fetch stats task"
        );
        if (!this.isRunActive(state, runId)) return;
        this.applyTaskSnapshot(state, snapshot);
        if (snapshot.status === "completed") {
          return;
        }
        if (snapshot.status === "failed") {
          throw new Error(snapshot.error || "Stats task failed");
        }
        if (snapshot.status === "cancelled") {
          return;
        }
      }
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
    getSummaryEndpoint() {
      return this.currentPlatform === "manbo" ? "/manbo/getsetsummary" : "/getsoundsummary";
    },
    getDanmakuEndpoint() {
      return this.currentPlatform === "manbo" ? "/manbo/getsetdanmaku" : "/getsounddanmaku";
    },
    getDramasEndpoint() {
      return this.currentPlatform === "manbo" ? "/manbo/getdramas" : "/getdramas";
    },
    async fetchEpisodeSummaries(soundIds, signal) {
      const key = this.currentPlatform === "manbo" ? "set_ids" : "sound_ids";
      return this.postJson(this.getSummaryEndpoint(), { [key]: soundIds }, signal, "Failed to fetch play counts");
    },
    getSearchResultById(dramaId) {
      return this.currentBrowseState.searchResults.find((item) => String(item.id) === String(dramaId));
    },
    getLoadedDramaById(dramaId) {
      return this.currentBrowseState.dramas.find((item) => String(item?.drama?.id) === String(dramaId));
    },
    normalizeOptionalNumber(value) {
      if (value == null || value === "") {
        return null;
      }
      const normalized = Number(value);
      return Number.isFinite(normalized) ? normalized : null;
    },
    async fetchDramaById(dramaId, signal) {
      const loaded = this.getLoadedDramaById(dramaId);
      if (loaded) {
        return loaded;
      }
      const searchResult = this.getSearchResultById(dramaId);
      const payload = { drama_ids: [dramaId] };
      if (this.currentPlatform === "missevan") {
        const soundIdMap = {};
        if (Number(searchResult?.sound_id) > 0) {
          soundIdMap[dramaId] = Number(searchResult.sound_id);
        }
        payload.sound_id_map = soundIdMap;
      }
      const data = await this.postJson(this.getDramasEndpoint(), payload, signal, "Failed to load drama");
      const result = data[0];
      if (!result?.success) {
        const error = new Error(`Failed to load drama: ${dramaId}`);
        error.accessDenied = Boolean(result?.accessDenied);
        throw error;
      }
      return result.info;
    },
    addEpisodeSelectionFlags(drama) {
      drama.expanded = false;
      drama.episodes.episode.forEach((episode) => {
        episode.selected = false;
      });
    },
    async addDramas(ids) {
      const state = this.currentBrowseState;
      state.dramas = [];
      state.selectedEpisodesSnapshot = [];
      if (!ids || ids.length === 0) {
        return;
      }
      let hasAccessDenied = false;
      try {
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i];
          try {
            const drama = await this.fetchDramaById(id);
            this.addEpisodeSelectionFlags(drama);
            state.dramas.push(drama);
          } catch (error) {
            if (error?.accessDenied) {
              hasAccessDenied = true;
            }
            console.error(`Failed to import drama ${id}`, error);
          }
        }
        if (hasAccessDenied) {
          await this.showMissevanAccessHint();
        }
        if (state.dramas.length > 0) {
          this.scrollToPanel("optionsPanel");
        }
      } catch (error) {
        console.error("Failed to import dramas", error);
      }
    },
    async startPlayCountStatistics(soundIds) {
      const state = this.currentStatsState;
      const selectedEpisodes = this.currentBrowseState.selectedEpisodesSnapshot
        .filter((episode) => soundIds.includes(episode.sound_id));
      await this.cancelActiveRun(state);
      this.resetStatisticsOutputs(state);
      const { runId, signal } = this.beginRun(state);
      if (!selectedEpisodes.length) {
        state.currentAction = "未选择分集";
        this.finishRun(state, runId);
        return;
      }
      state.currentAction = "开始统计播放量";
      state.playCountSelectedEpisodeCount = selectedEpisodes.length;
      this.scrollToPanel("outputPanel");
      try {
        await this.startStatsTask(
          "play_count",
          { episodes: selectedEpisodes },
          state,
          runId,
          signal
        );
        this.scrollToPanel("outputPanel");
      } catch (error) {
        if (!this.isAbortError(error)) {
          state.currentAction = "统计失败";
        }
      } finally {
        this.finishRun(state, runId);
      }
    },
    async startIdStatisticsConcurrent(soundIds) {
      const state = this.currentStatsState;
      const selectedEpisodes = this.currentBrowseState.selectedEpisodesSnapshot
        .filter((episode) => soundIds.includes(episode.sound_id));
      await this.cancelActiveRun(state);
      this.resetStatisticsOutputs(state);
      const { runId, signal } = this.beginRun(state);
      if (!selectedEpisodes.length) {
        state.currentAction = "未选择分集";
        this.finishRun(state, runId);
        return;
      }
      state.currentAction = "开始统计弹幕与去重 ID";
      state.idSelectedEpisodeCount = selectedEpisodes.length;
      this.scrollToPanel("outputPanel");
      try {
        await this.startStatsTask(
          "id",
          { episodes: selectedEpisodes },
          state,
          runId,
          signal
        );
        this.scrollToPanel("outputPanel");
      } catch (error) {
        if (!this.isAbortError(error)) {
          state.currentAction = "统计失败";
        }
      } finally {
        this.finishRun(state, runId);
      }
    },
    getManboRevenueType(dramaInfo) {
      const drama = dramaInfo?.drama || {};
      const episodes = Array.isArray(dramaInfo?.episodes?.episode) ? dramaInfo.episodes.episode : [];
      const allEpisodesFree = episodes.every((episode) => {
        return Number(episode?.pay_type ?? 0) === 0 && Number(episode?.price ?? 0) === 0;
      });
      const hasVipFreeEpisode = episodes.some((episode) => Number(episode?.vip_free ?? 0) === 1);
      if (
        Number(drama.pay_type ?? 0) === 0 &&
        Number(drama.price ?? 0) === 0 &&
        allEpisodesFree &&
        hasVipFreeEpisode
      ) {
        return "member";
      }
      if (
        Number(drama.pay_type ?? 0) === 1 &&
        Number(drama.price ?? 0) > 0 &&
        Number(drama.member_price ?? 0) > 0
      ) {
        return "season";
      }
      if (
        Number(drama.pay_type ?? 0) === 0 &&
        Number(drama.price ?? 0) === 0 &&
        episodes.some((episode) => Number(episode?.price ?? 0) > 0)
      ) {
        return "episode";
      }
      return "unknown";
    },
    getManboRevenueEpisodes(dramaInfo, revenueType) {
      const episodes = Array.isArray(dramaInfo?.episodes?.episode) ? dramaInfo.episodes.episode : [];
      if (revenueType === "member") {
        return episodes.filter((episode) => Number(episode?.vip_free ?? 0) === 1);
      }
      if (revenueType === "season") {
        return episodes.filter((episode) => Number(episode?.pay_type ?? 0) === 1);
      }
      if (revenueType === "episode") {
        return episodes.filter((episode) => Number(episode?.price ?? 0) > 0);
      }
      return [];
    },
    getManboRevenueSubtitle(title, dramaInfo, revenueType, episodes) {
      const drama = dramaInfo?.drama || {};
      if (revenueType === "member") {
        return title + " / 会员剧（仅计算投喂）";
      }
      if (revenueType === "season") {
        return title + " / 全季" + Number(drama.price ?? 0) + "（折后" + Number(drama.member_price ?? 0) + "）红豆";
      }
      if (revenueType === "episode") {
        const prices = [...new Set(
          episodes.map((episode) => Number(episode?.price ?? 0)).filter((price) => price > 0)
        )];
        return prices.length === 1
          ? title + " / 每集" + prices[0] + "红豆"
          : title + " / 分集付费红豆";
      }
      return title + " / 暂不支持收益预估";
    },
    async collectRevenueEpisodeUsers(episodes, dramaTitle, signal, onProgress = null) {
      const results = [];
      let failed = false;
      let accessDenied = false;

      for (let i = 0; i < episodes.length; i += 1) {
        const episode = episodes[i];
        if (typeof onProgress === "function") {
          onProgress({
            completedCount: i,
            totalCount: episodes.length,
            episode,
            dramaTitle,
          });
        }
        const danmakuResult = await this.postJson(
          this.getDanmakuEndpoint(),
          {
            sound_id: episode.sound_id,
            drama_title: dramaTitle,
            episode_title: episode.name || "",
            duration: Number(episode.duration ?? 0),
          },
          signal,
          "Failed to fetch revenue danmaku"
        );
        if (!danmakuResult.success) {
          failed = true;
          accessDenied = accessDenied || Boolean(danmakuResult.accessDenied);
          break;
        }
        results.push({
          episode,
          users: Array.isArray(danmakuResult.users) ? danmakuResult.users : [],
        });
        if (typeof onProgress === "function") {
          onProgress({
            completedCount: i + 1,
            totalCount: episodes.length,
            episode,
            dramaTitle,
          });
        }
      }

      return { results, failed, accessDenied };
    },
    buildUniqueUserCount(collections) {
      const userSet = new Set();
      collections.forEach((item) => {
        const users = Array.isArray(item?.users) ? item.users : item;
        (Array.isArray(users) ? users : []).forEach((uid) => userSet.add(uid));
      });
      return userSet.size;
    },
    buildUniqueUserIds(collections) {
      const userSet = new Set();
      collections.forEach((item) => {
        const users = Array.isArray(item?.users) ? item.users : item;
        (Array.isArray(users) ? users : []).forEach((uid) => userSet.add(uid));
      });
      return Array.from(userSet);
    },
    hasRevenueRange(result) {
      if (
        !result
        || result.summaryRevenueMode === "single"
        || result.summaryRevenueMode === "member_reward"
      ) {
        return false;
      }
      return Number.isFinite(Number(result?.minRevenueYuan))
        && Number.isFinite(Number(result?.maxRevenueYuan));
    },
    getSummaryRevenueMode(result, platform) {
      if (!result) {
        return "single";
      }
      if (result.summaryRevenueMode) {
        return result.summaryRevenueMode;
      }
      if (platform === "missevan" && result.vipOnlyReward) {
        return "member_reward";
      }
      if (
        platform === "manbo"
        && (
          result.revenueType === "member"
          || (
            Number(result?.diamondValue ?? 0) > 0
            && Number(result?.titlePrice ?? 0) <= 0
            && !this.hasRevenueRange({ ...result, summaryRevenueMode: "single" })
          )
        )
      ) {
        return "member_reward";
      }
      if (this.hasRevenueRange(result)) {
        return "range";
      }
      return "single";
    },
    getSummaryRevenueTotals(results, platform) {
      let estimatedRevenueYuan = 0;
      let minRevenueYuan = null;
      let maxRevenueYuan = null;
      let hasRevenueRange = false;
      let hasMemberReward = false;

      results.forEach((item) => {
        const mode = this.getSummaryRevenueMode(item, platform);
        if (mode === "member_reward") {
          hasMemberReward = true;
          const amount = platform === "manbo"
            ? Number(item?.diamondValue ?? 0) / 100
            : Number(item?.rewardCoinTotal ?? 0) / 10;
          estimatedRevenueYuan += amount;
          if (hasRevenueRange) {
            minRevenueYuan = Number(minRevenueYuan ?? 0) + amount;
            maxRevenueYuan = Number(maxRevenueYuan ?? 0) + amount;
          }
          return;
        }

        if (mode === "range" && this.hasRevenueRange(item)) {
          if (!hasRevenueRange) {
            minRevenueYuan = estimatedRevenueYuan;
            maxRevenueYuan = estimatedRevenueYuan;
            hasRevenueRange = true;
          }
          minRevenueYuan += Number(item?.minRevenueYuan ?? 0);
          maxRevenueYuan += Number(item?.maxRevenueYuan ?? 0);
          estimatedRevenueYuan += Number(item?.estimatedRevenueYuan ?? 0);
          return;
        }

        const amount = Number(item?.estimatedRevenueYuan ?? 0);
        estimatedRevenueYuan += amount;
        if (hasRevenueRange) {
          minRevenueYuan = Number(minRevenueYuan ?? 0) + amount;
          maxRevenueYuan = Number(maxRevenueYuan ?? 0) + amount;
        }
      });

      if (estimatedRevenueYuan <= 0 && hasMemberReward) {
        const rewardTotal = results.reduce((sum, item) => {
          const mode = this.getSummaryRevenueMode(item, platform);
          if (mode !== "member_reward") {
            return sum;
          }
          return sum + (
            platform === "manbo"
              ? Number(item?.diamondValue ?? 0) / 100
              : Number(item?.rewardCoinTotal ?? 0) / 10
          );
        }, 0);
        estimatedRevenueYuan = rewardTotal;
        if (hasRevenueRange) {
          minRevenueYuan = Number(minRevenueYuan ?? 0) + rewardTotal;
          maxRevenueYuan = Number(maxRevenueYuan ?? 0) + rewardTotal;
        }
      }

      return {
        estimatedRevenueYuan,
        minRevenueYuan,
        maxRevenueYuan,
      };
    },
    getRevenueCurrencyUnit(platform) {
      return platform === "manbo" ? "红豆" : "钻石";
    },
    buildRevenueSummaryTitle(summary) {
      const baseTitle = `汇总 / 已选 ${summary.selectedDramaCount} 部`;
      if (!summary || summary.failed || !summary.hasSummaryPrice) {
        return baseTitle;
      }
      const titleMemberPriceTotal = this.normalizeOptionalNumber(summary.titleMemberPriceTotal);
      if (titleMemberPriceTotal != null) {
        return `${baseTitle}，总价 ${summary.titlePriceTotal}（会员 ${titleMemberPriceTotal}）${summary.currencyUnit}`;
      }
      return `${baseTitle}，总价 ${summary.titlePriceTotal} ${summary.currencyUnit}`;
    },
    buildRevenueSummary(results) {
      if (!Array.isArray(results) || results.length === 0) {
        return null;
      }

      const platform = results[0]?.platform || this.currentPlatform;
      const failed = results.some((item) => item?.failed);
      const paidUserIds = this.buildUniqueUserIds(
        results.map((item) => item?.paidUserIds || [])
      );
      const rewardTotal = results.reduce((sum, item) => {
        const rewardValue = platform === "manbo"
          ? Number(item?.diamondValue ?? 0)
          : Number(item?.rewardCoinTotal ?? 0);
        return sum + rewardValue;
      }, 0);
      const totalViewCount = results.reduce((sum, item) => {
        return sum + Number(item?.viewCount ?? 0);
      }, 0);
      const rewardNumValues = platform === "missevan"
        ? results
          .map((item) => this.normalizeOptionalNumber(item?.rewardNum))
          .filter((value) => value != null)
        : [];
      const rewardNumTotal = platform === "missevan"
        ? (rewardNumValues.length
          ? rewardNumValues.reduce((sum, value) => sum + value, 0)
          : null)
        : null;
      const revenueTotals = this.getSummaryRevenueTotals(results, platform);
      const priceItems = results.filter((item) => item?.includeInSummaryPrice);
      const hasSummaryPrice = !failed && priceItems.length > 0;
      const titlePriceTotal = hasSummaryPrice
        ? priceItems.reduce((sum, item) => sum + Number(item?.titlePrice ?? 0), 0)
        : null;
      const memberPriceItems = priceItems.filter((item) => {
        return Number.isFinite(Number(item?.titleMemberPrice))
          && Number(item?.titleMemberPrice) > 0;
      });
      const titleMemberPriceTotal = hasSummaryPrice && memberPriceItems.length > 0
        ? memberPriceItems.reduce((sum, item) => sum + Number(item?.titleMemberPrice ?? 0), 0)
        : null;

      const summary = {
        platform,
        currencyUnit: this.getRevenueCurrencyUnit(platform),
        selectedDramaCount: results.length,
        totalPaidUserCount: paidUserIds.length,
        paidUserIds,
        totalViewCount,
        rewardTotal,
        rewardNum: rewardNumTotal,
        hasSummaryPrice,
        titlePriceTotal,
        titleMemberPriceTotal,
        estimatedRevenueYuan: revenueTotals.estimatedRevenueYuan,
        minRevenueYuan: revenueTotals.minRevenueYuan,
        maxRevenueYuan: revenueTotals.maxRevenueYuan,
        failed,
        summaryTitle: "",
      };
      summary.summaryTitle = this.buildRevenueSummaryTitle(summary);
      return summary;
    },
    async fetchRewardSummary(dramaId, signal) {
      return this.postJson(
        "/getrewardsummary",
        { drama_id: dramaId },
        signal,
        "Failed to fetch reward summary"
      );
    },
    async buildManboRevenueResults(dramaIds, state, signal) {
      const results = [];

      for (let i = 0; i < dramaIds.length; i += 1) {
        const dramaId = String(dramaIds[i]);
        const searchResult = this.getSearchResultById(dramaId);
        const dramaInfo = await this.fetchDramaById(dramaId, signal);
        const title = dramaInfo?.drama?.name || searchResult?.name || `Drama ${dramaId}`;
        const viewCount = Number(dramaInfo?.drama?.view_count ?? searchResult?.view_count ?? 0);
        const diamondValue = Number(dramaInfo?.drama?.diamond_value ?? searchResult?.diamond_value ?? 0);
        const revenueType = this.getManboRevenueType(dramaInfo);
        const revenueEpisodes = this.getManboRevenueEpisodes(dramaInfo, revenueType);
        const subtitle = this.getManboRevenueSubtitle(title, dramaInfo, revenueType, revenueEpisodes);

        if (revenueType === "unknown" || revenueEpisodes.length === 0) {
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: null,
            titleMemberPrice: null,
            includeInSummaryPrice: false,
            currencyUnit: this.getRevenueCurrencyUnit("manbo"),
            summaryRevenueMode: "single",
            paidUserIds: [],
            paidUserCount: 0,
            estimatedRevenueYuan: 0,
            failed: true,
            accessDenied: false,
          });
          state.progress = Math.floor(((i + 1) / dramaIds.length) * 100);
          continue;
        }

        const episodeUsers = await this.collectRevenueEpisodeUsers(
          revenueEpisodes,
          title,
          signal,
          ({ completedCount, totalCount }) => {
            state.currentAction = `正在统计收益 ${completedCount}/${totalCount}集`;
            const episodeProgress = totalCount > 0 ? completedCount / totalCount : 1;
            state.progress = Math.floor(((i + episodeProgress) / dramaIds.length) * 100);
          }
        );
        if (episodeUsers.failed) {
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: null,
            titleMemberPrice: null,
            includeInSummaryPrice: false,
            currencyUnit: this.getRevenueCurrencyUnit("manbo"),
            summaryRevenueMode: "single",
            paidUserIds: [],
            paidUserCount: 0,
            estimatedRevenueYuan: 0,
            failed: true,
            accessDenied: episodeUsers.accessDenied,
          });
          state.progress = Math.floor(((i + 1) / dramaIds.length) * 100);
          continue;
        }

        const paidUserIds = this.buildUniqueUserIds(episodeUsers.results);
        const paidUserCount = paidUserIds.length;
        if (revenueType === "member") {
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: null,
            titleMemberPrice: null,
            includeInSummaryPrice: false,
            currencyUnit: this.getRevenueCurrencyUnit("manbo"),
            summaryRevenueMode: "member_reward",
            paidUserIds,
            paidUserCount,
            estimatedRevenueYuan: diamondValue / 100,
            failed: false,
            accessDenied: false,
          });
        } else if (revenueType === "season") {
          const drama = dramaInfo?.drama || {};
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: Number(drama.price ?? 0),
            titleMemberPrice: Number(drama.member_price ?? 0) > 0
              ? Number(drama.member_price ?? 0)
              : null,
            includeInSummaryPrice: true,
            currencyUnit: this.getRevenueCurrencyUnit("manbo"),
            summaryRevenueMode: "range",
            paidUserIds,
            paidUserCount,
            minRevenueYuan: (paidUserCount * Number(drama.member_price ?? 0) + diamondValue) / 100,
            maxRevenueYuan: (paidUserCount * Number(drama.price ?? 0) + diamondValue) / 100,
            estimatedRevenueYuan: (paidUserCount * Number(drama.member_price ?? 0) + diamondValue) / 100,
            failed: false,
            accessDenied: false,
          });
        } else {
          const paidEpisodeCount = episodeUsers.results.length;
          const episodePrices = [
            ...new Set(
              episodeUsers.results
                .map((item) => Number(item?.episode?.price ?? 0))
                .filter((price) => price > 0)
            ),
          ];
          const episodeRevenue = episodeUsers.results.reduce((sum, item) => {
            return sum + item.users.length * Number(item?.episode?.price ?? 0);
          }, 0);
          const minRevenueYuan = (episodeRevenue + diamondValue) / 100;
          const hasUniformEpisodePrice = episodePrices.length === 1;
          const maxRevenueYuan = hasUniformEpisodePrice
            ? (paidUserCount * episodePrices[0] * paidEpisodeCount + diamondValue) / 100
            : null;
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: hasUniformEpisodePrice
              ? Number(episodePrices[0] ?? 0) * paidEpisodeCount
              : null,
            titleMemberPrice: null,
            includeInSummaryPrice: hasUniformEpisodePrice,
            currencyUnit: this.getRevenueCurrencyUnit("manbo"),
            summaryRevenueMode: hasUniformEpisodePrice ? "range" : "single",
            paidUserIds,
            paidUserCount,
            estimatedRevenueYuan: minRevenueYuan,
            minRevenueYuan,
            maxRevenueYuan,
            failed: false,
            accessDenied: false,
          });
        }

        state.progress = Math.floor(((i + 1) / dramaIds.length) * 100);
      }

      return results;
    },
    async startRevenueEstimate(dramaIds) {
      const state = this.currentStatsState;
      await this.cancelActiveRun(state);
      this.resetStatisticsOutputs(state);
      const { runId, signal } = this.beginRun(state);
      if (!dramaIds || dramaIds.length === 0) {
        state.currentAction = "未选择作品";
        this.finishRun(state, runId);
        return;
      }
      state.currentAction = "开始最低收益预估";
      this.scrollToPanel("outputPanel");
      try {
        await this.startStatsTask(
          "revenue",
          { dramaIds },
          state,
          runId,
          signal
        );
        this.scrollToPanel("outputPanel");
      } catch (error) {
        if (!this.isAbortError(error)) {
          state.currentAction = "统计失败";
        }
      } finally {
        this.finishRun(state, runId);
      }
    },
    async cancelCurrentStatistics() {
      const state = this.currentStatsState;
      if (!state?.isRunning && !state?.activeTaskId) {
        return;
      }
      await this.cancelActiveRun(state);
      state.currentAction = "统计已取消";
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
  --radius-md: 14px;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--text-strong);
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--page-bg);
}
.app-shell {
  max-width: 1180px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 24px 18px 64px;
}
.hero {
  margin-bottom: 18px;
  padding: 22px 24px;
  background:
    radial-gradient(circle at top right, rgba(207, 92, 54, 0.14), transparent 38%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(252, 246, 241, 0.88));
  border: 1px solid rgba(207, 92, 54, 0.12);
  border-radius: 26px;
  box-shadow: var(--panel-shadow);
}
.hero-eyebrow {
  margin: 0 0 6px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.hero-title {
  margin: 0;
  font-size: clamp(22px, 3vw, 30px);
  line-height: 1.15;
}
.hero-subtitle {
  max-width: 760px;
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.65;
}
.platform-switch {
  display: inline-flex;
  gap: 8px;
  margin-top: 14px;
  padding: 5px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(29, 53, 87, 0.08);
  border-radius: 999px;
}
.platform-btn {
  min-height: 40px;
  padding: 10px 16px;
  color: var(--select-text);
  font-weight: 700;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 999px;
}
.platform-btn.is-active {
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
}
.app-grid { display: grid; gap: 16px; }
.panel {
  overflow: hidden;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 20px;
  box-shadow: var(--panel-shadow);
}
.panel-report-full {
  padding: 18px;
}
@media (max-width: 640px) {
  .app-shell { padding: 14px 10px 48px; }
  .hero { padding: 18px 16px; border-radius: 20px; }
  .hero-title { font-size: 24px; }
  .hero-subtitle { font-size: 13px; line-height: 1.55; }
  .platform-switch {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .platform-btn { width: 100%; }
  .panel-report-full {
    padding: 14px;
  }
}
</style>
