import { normalizeVersion } from "../../shared/versionUtils.js";

export const CHANGELOG_SEEN_VERSION_STORAGE_KEY = "missevan-changelog-seen-version";

export const CHANGELOG_ENTRIES = [
  {
    version: "1.6.0",
    changes: [
      "请保存本工具新地址 mmtoolkit.app，旧地址将于 2 个月后失效",
      "新增“收藏”页面：可收藏猫耳和漫播剧集，查看最近统计、历史记录和关键指标增量",
      "收藏数据保存在浏览器本地，支持导入导出，方便备份和迁移到其他浏览器",
      "搜索结果、更新页和榜单页支持一键收藏，并在收藏页批量刷新统计数据",
      "修复一些逻辑错误",
    ],
  },
  {
    version: "1.5.5",
    changes: [
      "优化搜索：支持全拼和首字母搜索，疑似搜错平台会提示跳转",
      "优化趋势页面",
    ],
  },
  {
    version: "1.5.4",
    changes: [
      "合并搜索和导入输入，新版输入框支持各类关键词，分享链接，剧集和分集ID搜索和导入",
      "优化搜索逻辑",
    ],
  },
  {
    version: "1.5.3",
    changes: [
      "优化猫耳单集付费剧集的收益预估",
      "优化搜索结果排序",
      "清理旧版本残留bug",
    ],
  },
  {
    version: "1.5.2",
    changes: ["增加巅峰榜标题跳转。"],
  },
  {
    version: "1.5.1",
    changes: ["增加更新日志"],
  },
  {
    version: "1.5.0",
    changes: [
      "增加“更新”界面，列出猫耳和漫播近一周内更新的剧集",
      "增加“趋势”功能，展示剧集在过去3/7/30日内的播放量，追剧人数，购买/收听人数，付费ID数的趋势，数据不足时自动展示所有可用日期数据。该功能仅对“更新”和“榜单”中出现的剧集有效",
    ],
  },
];

function resolveStorage(storage) {
  if (storage) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function getShouldAutoOpenChangelog(currentVersion, storage = null) {
  const normalizedVersion = normalizeVersion(currentVersion);
  if (normalizedVersion === "0.0.0") {
    return false;
  }

  try {
    const resolvedStorage = resolveStorage(storage);
    if (!resolvedStorage) {
      return false;
    }
    return normalizeVersion(resolvedStorage.getItem(CHANGELOG_SEEN_VERSION_STORAGE_KEY)) !== normalizedVersion;
  } catch (_) {
    return false;
  }
}

export function markChangelogVersionSeen(currentVersion, storage = null) {
  const normalizedVersion = normalizeVersion(currentVersion);
  if (normalizedVersion === "0.0.0") {
    return;
  }

  try {
    const resolvedStorage = resolveStorage(storage);
    resolvedStorage?.setItem?.(CHANGELOG_SEEN_VERSION_STORAGE_KEY, normalizedVersion);
  } catch (_) {
  }
}
