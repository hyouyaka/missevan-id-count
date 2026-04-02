<template>
  <ToolView
    v-if="resolvedView === 'tool'"
    :initialAppConfig="appConfig"
  />
  <LandingView
    v-else-if="resolvedView === 'landing'"
    :appConfig="appConfig"
  />
  <div v-else class="boot-shell">
    <div class="boot-card">
      <div class="boot-title">正在加载入口</div>
      <div class="boot-text">正在读取当前环境并选择合适的页面。</div>
    </div>
  </div>
</template>

<script>
import LandingView from "./App.vue";
import ToolView from "./views/ToolView.vue";

function normalizeVersion(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : "0.0.0";
}

function getDefaultAppConfig() {
  return {
    missevanEnabled: true,
    desktopApp: false,
    hostedDeployment: false,
    brandName: "M&M Toolkit",
    titleZh: "小猫小狐数据分析",
    description: "支持 Missevan 与 Manbo 的作品导入、分集筛选、弹幕统计和数据汇总。",
    cooldownHours: 4,
    cooldownUntil: 0,
    desktopAppUrl: "",
    frontendVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0",
    backendVersion: "0.0.0",
    versionMismatch: false,
  };
}

export default {
  components: { LandingView, ToolView },
  data() {
    return {
      resolvedView: "",
      appConfig: getDefaultAppConfig(),
    };
  },
  async mounted() {
    await this.bootstrap();
  },
  methods: {
    buildVersionedUrl(url) {
      const separator = url.includes("?") ? "&" : "?";
      const frontendVersion = encodeURIComponent(
        normalizeVersion(this.appConfig.frontendVersion)
      );
      return `${url}${separator}frontendVersion=${frontendVersion}`;
    },
    getBackendVersionFromResponse(response, data = null) {
      const headerVersion = normalizeVersion(
        response?.headers?.get?.("X-Backend-Version") ?? ""
      );
      if (headerVersion !== "0.0.0") {
        return headerVersion;
      }
      return normalizeVersion(data?.backendVersion ?? "0.0.0");
    },
    mergeAppConfig(config = {}) {
      const defaults = getDefaultAppConfig();
      const frontendVersion = normalizeVersion(
        config.frontendVersion ?? this.appConfig.frontendVersion ?? defaults.frontendVersion
      );
      const backendVersion = normalizeVersion(
        config.backendVersion ?? this.appConfig.backendVersion ?? defaults.backendVersion
      );
      this.appConfig = {
        missevanEnabled: config.missevanEnabled !== false,
        desktopApp: config.desktopApp === true,
        hostedDeployment: config.hostedDeployment === true,
        brandName: config.brandName || defaults.brandName,
        titleZh: config.titleZh || defaults.titleZh,
        description: config.description || defaults.description,
        cooldownHours: Number(config.cooldownHours ?? defaults.cooldownHours) || defaults.cooldownHours,
        cooldownUntil: Number(config.cooldownUntil ?? 0) || 0,
        desktopAppUrl: String(config.desktopAppUrl || "").trim(),
        frontendVersion,
        backendVersion,
        versionMismatch: config.versionMismatch == null
          ? frontendVersion !== backendVersion
          : Boolean(config.versionMismatch),
      };
    },
    getCurrentPath() {
      if (typeof window === "undefined") {
        return "/";
      }
      return String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    },
    isToolPath() {
      return this.getCurrentPath() === "/tool";
    },
    isProbablyDesktopShell() {
      if (typeof navigator === "undefined") {
        return false;
      }
      return /Electron/i.test(String(navigator.userAgent || ""));
    },
    resolveViewFromConfig() {
      if (this.isToolPath()) {
        return "tool";
      }
      if (this.appConfig.desktopApp) {
        return "tool";
      }
      return "landing";
    },
    async bootstrap() {
      try {
        const response = await fetch(this.buildVersionedUrl("/app-config"), {
          cache: "no-store",
        });
        if (response.ok) {
          const config = await response.json();
          this.mergeAppConfig({
            ...config,
            backendVersion: this.getBackendVersionFromResponse(response, config),
          });
        }
      } catch (_) {
        this.mergeAppConfig();
      } finally {
        this.resolvedView = this.isToolPath() || this.isProbablyDesktopShell()
          ? "tool"
          : this.resolveViewFromConfig();
      }
    },
  },
};
</script>

<style>
.boot-shell {
  display: grid;
  min-height: 100vh;
  padding: 24px;
  place-items: center;
  background:
    radial-gradient(circle at top left, rgba(28, 126, 214, 0.1), transparent 32%),
    radial-gradient(circle at bottom right, rgba(207, 92, 54, 0.12), transparent 28%),
    linear-gradient(180deg, #f4efe5 0%, #eef5fb 38%, #fbfcfe 100%);
}

.boot-card {
  width: min(460px, 100%);
  padding: 24px 26px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(29, 53, 87, 0.1);
  border-radius: 24px;
  box-shadow: 0 18px 45px rgba(31, 43, 58, 0.08);
}

.boot-title {
  font-size: 22px;
  font-weight: 800;
}

.boot-text {
  margin-top: 8px;
  color: #5d7186;
  line-height: 1.6;
}
</style>
