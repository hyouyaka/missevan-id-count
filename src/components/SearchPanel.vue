<template>
  <div class="search-panel">
    <div class="search-head">
      <div>
        <p class="section-kicker">检索剧集</p>
        <h2 class="section-title">先搜索，再批量导入</h2>
      </div>
      <p class="section-tip">
        如果猫耳搜索接口暂时受限，可以直接在下方输入剧集ID进行导入。
      </p>
    </div>

    <div class="search-card">
      <label class="field-label" for="keyword-input">关键词搜索</label>
      <div class="search-block">
        <input
          id="keyword-input"
          v-model="keyword"
          type="text"
          class="search-input"
          placeholder="输入作品名、作者名或关键词"
          @keyup.enter="search"
        />
        <button class="primary-btn" @click="search">搜索</button>
      </div>
    </div>

    <div class="search-card search-card-muted">
      <label class="field-label" for="manual-id-input">手动导入剧集ID</label>
      <div class="search-block">
        <textarea
          id="manual-id-input"
          v-model="manualIds"
          rows="2"
          class="search-input search-textarea"
          placeholder="输入一个或多个剧集ID，支持英文逗号、中文逗号、空格或换行分隔"
        ></textarea>
        <button class="primary-btn" @click="queryByIds">导入剧集</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "SearchPanel",
  data() {
    return {
      keyword: "",
      manualIds: "",
    };
  },
  methods: {
    parseIds(rawValue) {
      return Array.from(
        new Set(
          rawValue
            .split(/[\s,，]+/)
            .map((item) => item.trim())
            .filter((item) => /^\d+$/.test(item))
            .map((item) => Number(item))
        )
      );
    },
    buildAccessDeniedMessage() {
      return "猫耳搜索或播放量接口当前访问受限，请稍后重试，或直接手动输入剧集ID。";
    },
    async search() {
      if (!this.keyword.trim()) {
        return;
      }

      this.$emit("resetState");

      try {
        const response = await fetch(
          `/search?keyword=${encodeURIComponent(this.keyword)}`
        );
        const data = await response.json();

        if (data.success) {
          this.$emit("updateResults", data.results);
          this.$emit("requestScrollToResults");
        } else if (data.accessDenied) {
          alert(this.buildAccessDeniedMessage());
        } else {
          alert("搜索失败或没有结果，请尝试直接输入剧集ID。");
        }
      } catch (error) {
        console.error(error);
        alert(this.buildAccessDeniedMessage());
      }
    },
    async queryByIds() {
      const ids = this.parseIds(this.manualIds);

      if (!ids.length) {
        alert("请至少输入一个有效的剧集ID。");
        return;
      }

      this.$emit("resetState");

      try {
        const response = await fetch("/getdramacards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drama_ids: ids }),
        });
        const data = await response.json();

        if (!data.success) {
          alert(
            data.accessDenied
              ? this.buildAccessDeniedMessage()
              : "导入剧集失败，请检查输入的剧集ID。"
          );
          return;
        }

        this.$emit("updateResults", data.results);
        this.$emit("requestScrollToResults");

        if (data.failedIds?.length) {
          alert(`以下剧集ID导入失败: ${data.failedIds.join(", ")}`);
        }
      } catch (error) {
        console.error(error);
        alert("导入剧集失败，请稍后重试。");
      }
    },
  },
};
</script>

<style scoped>
.search-panel {
  display: grid;
  gap: 14px;
  padding: 20px;
}

.search-head {
  display: grid;
  gap: 8px;
}

.section-kicker {
  margin: 0 0 6px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.section-title {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.section-tip {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.7;
}

.search-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(207, 92, 54, 0.1);
  border-radius: var(--radius-md);
}

.search-card-muted {
  background: rgba(238, 244, 251, 0.68);
  border-color: rgba(47, 93, 124, 0.12);
}

.field-label {
  display: block;
  margin-bottom: 10px;
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 700;
}

.search-block {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.search-input {
  width: 100%;
  padding: 12px 14px;
  color: var(--text-strong);
  line-height: 1.5;
  background: #fff;
  border: 1px solid rgba(96, 112, 128, 0.22);
  border-radius: 12px;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.search-input:focus {
  border-color: rgba(207, 92, 54, 0.52);
  box-shadow: 0 0 0 4px rgba(207, 92, 54, 0.12);
  transform: translateY(-1px);
}

.search-textarea {
  flex: 1 1 auto;
  min-height: 64px;
  resize: vertical;
}

.primary-btn {
  min-width: 108px;
  padding: 12px 16px;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border: none;
  border-radius: 12px;
  box-shadow: 0 10px 22px rgba(207, 92, 54, 0.22);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    filter 0.2s ease;
}

.primary-btn:hover {
  filter: brightness(1.02);
  box-shadow: 0 14px 24px rgba(207, 92, 54, 0.28);
  transform: translateY(-1px);
}

@media (max-width: 640px) {
  .search-panel {
    padding: 16px;
  }

  .search-block {
    flex-direction: column;
  }

  .primary-btn {
    width: 100%;
  }
}
</style>
