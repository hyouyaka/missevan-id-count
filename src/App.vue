<template>
  <div class="app">
    <h2>猫耳弹幕ID统计工具</h2>

    <!-- 搜索输入 -->
    <div class="panel">
      <SearchPanel @updateResults="searchResults = $event" />
    </div>

    <!-- 搜索结果列表 -->
    <div class="panel">
      <SearchResults :results="searchResults" @addDramas="addDramas" />
    </div>

    <!-- 单集选择 -->
    <div class="panel">
      <OptionPanel :dramas="dramas" @startStatistics="startStatistics" />
    </div>

    <!-- 输出面板 -->
    <div class="panel">
      <OutputPanel
        :progress="progress"
        :currentAction="currentAction"
        :dramaResults="dramaResults"
        :totalDanmaku="totalDanmaku"
        :totalUsers="totalUsers"
      />
    </div>
  </div>
</template>

<script>
import SearchPanel from "./components/SearchPanel.vue";
import SearchResults from "./components/SearchResults.vue";
import OptionPanel from "./components/OptionPanel.vue";
import OutputPanel from "./components/OutputPanel.vue";

export default {
  components: { SearchPanel, SearchResults, OptionPanel, OutputPanel },
  data() {
    return {
      searchResults: [],
      dramas: [],
      progress: 0,
      currentAction: "",
      dramaResults: [],
      totalDanmaku: 0,
      totalUsers: 0,
    };
  },
  methods: {
    async addDramas(ids) {
      if (!ids || ids.length === 0) return;
      this.progress = 0;
      this.currentAction = "开始添加剧集";
      this.dramas = [];
      this.dramaResults = [];
      this.totalDanmaku = 0;
      this.totalUsers = 0;

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        this.currentAction = `正在添加剧集 ${id}`;
        try {
          const resp = await fetch("/getdramas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ drama_ids: [id] })
          });
          const data = await resp.json();
          const r = data[0];
          if (r.success) {
            const drama = r.info;
            drama.expanded = true;
            drama.episodes.episode.forEach(e => (e.selected = false));
            this.dramas.push(drama);
            this.currentAction = `正在添加剧集 ${id} ${drama.drama.name}`;
          }
        } catch (e) {
          console.error(`添加剧集失败 ${id}`, e);
        }
        this.progress = Math.floor(((i + 1) / ids.length) * 100);
      }
      this.currentAction = "剧集添加完成";
    },
    async startStatistics(soundIDs) {
      if (!soundIDs || soundIDs.length === 0) {
        this.currentAction = "未选择单集";
        return;
      }
      this.progress = 0;
      this.dramaResults = [];
      this.totalDanmaku = 0;
      this.totalUsers = 0;

      const sounds = [];
      this.dramas.forEach(d => {
        const title = d.drama.name;
        d.episodes.episode.forEach(e => {
          if (soundIDs.includes(e.sound_id)) {
            sounds.push({ sound_id: e.sound_id, drama_title: title });
          }
        });
      });

      this.currentAction = "开始统计";

      try {
        const resp = await fetch("/getdanmaku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sounds })
        });
        const data = await resp.json();
        this.progress = 100;
        this.dramaResults = data.dramaResults;
        this.totalDanmaku = data.allDanmakuCount;
        this.totalUsers = data.allUserCount;
        this.currentAction = "统计完成";
      } catch (e) {
        console.error("统计失败", e);
        this.currentAction = "统计失败";
      }
    }
  }
};
</script>

<style>
.app {
  max-width: 480px;
  margin: auto;
  padding: 16px;
  font-family: "Helvetica Neue", Arial, sans-serif;
  background: #f5f9ff;
  min-height: 100vh;
}

h2 {
  text-align: center;
  color: #3f51b5;
  margin-bottom: 20px;
}

/* 卡片风格面板 */
.panel {
  background: #ffffff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  margin-bottom: 16px;
}

/* 按钮统一风格 */
button {
  background-color: #4caf50;
  color: #fff;
  border: none;
  padding: 6px 14px;
  margin-right: 6px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background-color 0.2s ease;
}

button:hover {
  background-color: #45a049;
}

/* 搜索输入框 */
input[type="text"] {
  width: calc(100% - 12px);
  padding: 6px;
  margin-right: 6px;
  border-radius: 6px;
  border: 1px solid #ccc;
  outline: none;
}

input[type="text"]:focus {
  border-color: #4caf50;
  box-shadow: 0 0 3px rgba(76, 175, 80, 0.5);
}

/* 列表美化 */
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

li {
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
}

li:last-child {
  border-bottom: none;
}

@media (max-width: 500px) {
  .app {
    padding: 12px;
  }
  button {
    padding: 5px 10px;
    margin-bottom: 6px;
  }
}
</style>
