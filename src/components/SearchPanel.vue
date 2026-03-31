<template>
  <div class="search-panel">
    <div class="search-head">
      <p class="section-tip">
        <template v-if="platform === 'missevan' && !isDesktopApp">
          如果搜索接口暂时受限，请 {{ cooldownText }} 小时后再来。
          <template v-if="desktopAppUrl">
            或<a
              class="section-tip-link"
              :href="desktopAppUrl"
              target="_blank"
              rel="noopener noreferrer"
            >点这里</a>使用桌面版。
          </template>
        </template>
        <template v-else>
          {{ panelTip }}
        </template>
      </p>
    </div>

    <div v-if="platform === 'missevan'" class="search-card">
      <label class="field-label" for="keyword-input">关键词搜索</label>
      <div class="search-block">
        <input
          id="keyword-input"
          v-model="keywordModel"
          type="text"
          class="search-input"
          placeholder="输入作品名、作者名或关键词"
          @keyup.enter="search"
        />
        <button class="primary-btn" type="button" :disabled="isSearchPending" @click="search">
          {{ searchButtonText }}
        </button>
      </div>
    </div>

    <div v-else class="search-card">
      <label class="field-label" for="manbo-keyword-input">搜索已收录的漫播索引库</label>
      <div class="search-block">
        <input
          id="manbo-keyword-input"
          v-model="keywordModel"
          type="text"
          class="search-input"
          placeholder="输入剧名、别名或 Drama ID"
          @keyup.enter="search"
        />
        <button class="primary-btn" type="button" :disabled="isSearchPending" @click="search">
          {{ searchButtonText }}
        </button>
      </div>
    </div>

    <div class="search-card" :class="{ 'search-card-muted': platform === 'manbo' }">
      <label class="field-label" for="manual-input">{{ manualLabel }}</label>
      <div class="search-block">
        <textarea
          id="manual-input"
          v-model="manualInputModel"
          rows="3"
          class="search-input search-textarea"
          :placeholder="manualPlaceholder"
        ></textarea>
        <div class="search-actions">
          <button
            class="primary-btn"
            type="button"
            :disabled="isManualPending"
            @click="queryManualInput"
          >
            {{ pendingManualButtonText }}
          </button>
          <button class="secondary-btn" type="button" @click="clearManualInput">
            清空
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  canParseShareUrl,
  decryptShareUrl,
  extractResolvedId,
} from "../utils/manboCrypto";

export default {
  name: "SearchPanel",
  props: {
    platform: {
      type: String,
      default: "missevan",
    },
    formState: {
      type: Object,
      default: () => ({
        keyword: "",
        manualInput: "",
      }),
    },
    isDesktopApp: {
      type: Boolean,
      default: false,
    },
    cooldownHours: {
      type: Number,
      default: 4,
    },
    cooldownUntil: {
      type: Number,
      default: 0,
    },
    desktopAppUrl: {
      type: String,
      default: "",
    },
    frontendVersion: {
      type: String,
      default: "0.0.0",
    },
    handleVersionResponse: {
      type: Function,
      default: null,
    },
  },
  data() {
    return {
      isSearchPending: false,
      isManualPending: false,
    };
  },
  computed: {
    keywordModel: {
      get() {
        return String(this.formState?.keyword ?? "");
      },
      set(value) {
        this.emitFormState({ keyword: value });
      },
    },
    manualInputModel: {
      get() {
        return String(this.formState?.manualInput ?? "");
      },
      set(value) {
        this.emitFormState({ manualInput: value });
      },
    },
    panelTip() {
      if (this.platform === "manbo") {
        return "可先搜索已收录的漫播索引库，命中后会自动拉取剧集信息并展示；没有结果时，再用作品 ID、分集 ID、网页链接或分享链接导入。";
      }

      return this.getMissevanAccessLimitedText();
    },
    cooldownText() {
      return this.getRemainingCooldownHours();
    },
    manualLabel() {
      return this.platform === "manbo"
        ? "作品 ID / 分集 ID / 网页链接 / 分享链接"
        : "手动导入作品 ID";
    },
    manualPlaceholder() {
      return this.platform === "manbo"
        ? "可混合输入多个作品 ID、分集 ID、网页链接或分享链接，支持空格、逗号或换行分隔"
        : "输入一个或多个作品 ID，支持英文逗号、中文逗号、空格或换行分隔";
    },
    manualButtonText() {
      return this.platform === "manbo" ? "解析并导入" : "导入作品";
    },
    searchButtonText() {
      return this.isSearchPending ? "搜索中" : "搜索";
    },
    pendingManualButtonText() {
      if (!this.isManualPending) {
        return this.manualButtonText;
      }

      return this.platform === "manbo" ? "解析中" : "导入中";
    },
  },
  methods: {
    emitFormState(patch = {}) {
      this.$emit("updateFormState", patch);
    },
    normalizeVersion(value) {
      const normalized = String(value ?? "").trim();
      return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : "0.0.0";
    },
    getBackendVersionFromResponse(response, data = null) {
      const headerVersion = this.normalizeVersion(
        response?.headers?.get?.("X-Backend-Version") ?? ""
      );
      if (headerVersion !== "0.0.0") {
        return headerVersion;
      }
      return this.normalizeVersion(data?.backendVersion ?? "0.0.0");
    },
    buildVersionedUrl(url) {
      const separator = url.includes("?") ? "&" : "?";
      const frontendVersion = encodeURIComponent(this.normalizeVersion(this.frontendVersion));
      return `${url}${separator}frontendVersion=${frontendVersion}`;
    },
    async parseVersionedJson(response) {
      const data = await response.json();
      if (typeof this.handleVersionResponse === "function") {
        this.handleVersionResponse({
          frontendVersion: this.normalizeVersion(this.frontendVersion),
          backendVersion: this.getBackendVersionFromResponse(response, data),
        });
      }
      return data;
    },
    clearManualInput() {
      this.emitFormState({
        keyword: "",
        manualInput: "",
      });
    },
    async fetchAppConfig() {
      try {
        const response = await fetch(this.buildVersionedUrl("/app-config"), {
          cache: "no-store",
        });
        if (!response.ok) {
          return null;
        }
        return this.parseVersionedJson(response);
      } catch (_) {
        return null;
      }
    },
    getRemainingCooldownHours(config = null) {
      const source = config || {
        cooldownHours: this.cooldownHours,
        cooldownUntil: this.cooldownUntil,
      };
      const until = Number(source?.cooldownUntil ?? 0);
      if (until > Date.now()) {
        return Math.ceil(((until - Date.now()) / (60 * 60 * 1000)) * 10) / 10;
      }

      return Number(source?.cooldownHours ?? this.cooldownHours ?? 4);
    },
    getMissevanAccessLimitedText(config = null) {
      if (this.isDesktopApp) {
        return "如果看到访问受限，请先用任意浏览器打开猫耳主页完成验证后再重试。";
      }

      return `如果搜索接口暂时受限，请 ${this.getRemainingCooldownHours(config)} 小时后再来。`;
    },
    parseIds(rawValue) {
      return Array.from(
        new Set(
          String(rawValue ?? "")
            .split(/[\s,，]+/)
            .map((item) => item.trim())
            .filter((item) => /^\d+$/.test(item))
            .map((item) => Number(item))
        )
      );
    },
    parseRawItems(rawValue) {
      return Array.from(
        new Set(
          String(rawValue ?? "")
            .split(/[\s,，]+/)
            .map((item) => item.trim())
            .filter(Boolean)
        )
      );
    },
    async search() {
      if (this.isSearchPending) {
        return;
      }

      if (this.platform === "manbo") {
        const keyword = this.keywordModel.trim();
        if (!keyword) {
          return;
        }

        this.$emit("resetState");
        this.isSearchPending = true;

        try {
          const response = await fetch(
            this.buildVersionedUrl(`/manbo/search?keyword=${encodeURIComponent(keyword)}`)
          );
          const data = await this.parseVersionedJson(response);

          this.$emit("updateResults", Array.isArray(data.results) ? data.results : []);
          if (!data.success) {
            if (Number(data?.meta?.matchedCount ?? 0) > 0) {
              alert("本地索引有记录，但拉取漫播详情失败，请稍后重试或手动导入。");
            } else {
              alert("漫播索引库没有搜索结果，可以继续用 ID 或链接导入，成功后会自动收录。");
            }
          }
        } catch (error) {
          console.error(error);
          alert("漫播索引搜索失败，请稍后重试");
        } finally {
          this.isSearchPending = false;
        }
        return;
      }

      const keyword = this.keywordModel.trim();
      if (!keyword) {
        return;
      }

      this.$emit("resetState");
      this.isSearchPending = true;

      try {
        const response = await fetch(
          this.buildVersionedUrl(`/search?keyword=${encodeURIComponent(keyword)}`)
        );
        const data = await this.parseVersionedJson(response);

        if (data.success) {
          this.$emit("updateResults", data.results);
          return;
        }

        if (data.accessDenied) {
          const config = await this.fetchAppConfig();
          alert(this.getMissevanAccessLimitedText(config));
          return;
        }

        alert(data.message || "搜索失败或没有结果");
      } catch (error) {
        console.error(error);
        alert("搜索失败，请稍后重试");
      } finally {
        this.isSearchPending = false;
      }
    },
    async queryManualInput() {
      if (this.isManualPending) {
        return;
      }

      if (this.platform === "manbo") {
        const rawItems = this.parseRawItems(this.manualInputModel);
        if (!rawItems.length) {
          alert("请至少输入一个有效的 Manbo ID 或链接");
          return;
        }

        this.$emit("resetState");
        this.isManualPending = true;

        try {
          await this.queryManbo(rawItems);
        } finally {
          this.isManualPending = false;
        }
        return;
      }

      const ids = this.parseIds(this.manualInputModel);
      if (!ids.length) {
        alert("请至少输入一个有效的作品 ID");
        return;
      }

      this.$emit("resetState");
      this.isManualPending = true;

      try {
        const response = await fetch(this.buildVersionedUrl("/getdramacards"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drama_ids: ids }),
        });
        const data = await this.parseVersionedJson(response);

        if (!data.success) {
          if (data.accessDenied) {
            const config = await this.fetchAppConfig();
            alert(this.getMissevanAccessLimitedText(config));
            return;
          }

          alert("导入作品失败，请检查输入的作品 ID");
          return;
        }

        this.$emit("updateResults", data.results);

        if (data.failedIds?.length) {
          alert(`以下作品 ID 导入失败: ${data.failedIds.join(", ")}`);
        }
      } catch (error) {
        console.error(error);
        alert("导入作品失败，请稍后重试");
      } finally {
        this.isManualPending = false;
      }
    },
    async queryManbo(rawItems) {
      try {
        const items = await Promise.all(
          rawItems.map(async (raw) => {
            if (!canParseShareUrl(raw)) {
              return { raw };
            }

            const payload = await decryptShareUrl(raw);
            const resolved = extractResolvedId(payload, raw);

            if (resolved?.dramaId) {
              return {
                raw: String(resolved.dramaId),
                resolvedShareData: resolved.payload || payload,
              };
            }

            if (resolved?.setId) {
              return {
                raw: String(resolved.setId),
                resolvedShareData: resolved.payload || payload,
              };
            }

            return {
              raw,
              resolvedShareData: resolved?.payload || payload,
            };
          })
        );

        const response = await fetch(this.buildVersionedUrl("/manbo/getdramacards"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const data = await this.parseVersionedJson(response);

        if (!data.success) {
          alert("Manbo 导入失败，请检查输入内容");
          return;
        }

        this.$emit("updateResults", data.results);

        if (data.failedItems?.length) {
          alert(`以下内容解析失败: ${data.failedItems.join(" | ")}`);
        }
      } catch (error) {
        console.error(error);
        alert("分享链接解析失败，或 Manbo 导入失败，请改用作品或分集链接再试");
      }
    },
  },
};
</script>

<style scoped>
.search-panel {
  display: grid;
  gap: 12px;
  padding: 18px;
}

.search-head {
  display: grid;
  gap: 6px;
}

.section-tip {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.section-tip-link {
  color: var(--accent);
  font-weight: 700;
  text-decoration: none;
}

.section-tip-link:hover {
  text-decoration: underline;
}

.search-card {
  padding: 14px;
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

.search-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.search-input {
  width: 100%;
  min-height: 44px;
  padding: 12px 14px;
  color: var(--text-strong);
  line-height: 1.5;
  background: #fff;
  border: 1px solid rgba(96, 112, 128, 0.22);
  border-radius: 12px;
  outline: none;
}

.search-textarea {
  flex: 1 1 auto;
  min-height: 88px;
  resize: vertical;
}

.primary-btn {
  min-width: 112px;
  min-height: 44px;
  padding: 12px 16px;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border: none;
  border-radius: 12px;
}

.primary-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.secondary-btn {
  min-width: 112px;
  min-height: 44px;
  padding: 12px 16px;
  color: var(--select-text);
  font-weight: 700;
  cursor: pointer;
  background: var(--select-bg);
  border: 1px solid var(--select-border);
  border-radius: 12px;
}

@media (max-width: 640px) {
  .search-panel {
    padding: 14px;
  }

  .search-block {
    flex-direction: column;
  }

  .primary-btn {
    width: 100%;
  }

  .secondary-btn {
    width: 100%;
  }
}
</style>
