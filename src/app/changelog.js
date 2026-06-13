import { normalizeVersion } from "../../shared/versionUtils.js";

export const CHANGELOG_SEEN_VERSION_STORAGE_KEY = "missevan-changelog-seen-version";

export const CHANGELOG_ENTRIES = [
  {
    version: "1.6.3",
    changes: [
      "请保存本工具新地址：https://mmtoolkit.app/，旧地址将于7月底失效",
      "新增猫耳/漫播的CV榜单，统计在库的作品中主役播放量前30的CV和相应作品名单，每周刷新",
      "优化浏览器后退/前进体验，可恢复到具体平台、榜单分类和榜单项，不再回到空白页",
      "优化顶部菜单栏结构，添加分级菜单",
    ],
  },
  {
    version: "1.6.2",
    changes: [
      "请保存本工具新地址：https://mmtoolkit.app/，旧地址将于7月底失效",
      "新增“对比”功能，可从搜索、更新、榜单页面加入作品对比，支持普通剧集和猫耳巅峰榜系列趋势对比，可切换绝对值和增量曲线，并可单独显示或隐藏每部剧集曲线",
      "优化趋势曲线，改为在单指标之间切换，并添加增量曲线显示，方便观察数据变化趋势",
      "新增后台任务中心，统一显示统计任务和收藏刷新进度，任务运行时仍可浏览榜单、搜索和收藏；任务完成后会提示查看结果",
      "优化移动端图表、按钮、对比和横坐标显示，修复缺失数据和增量曲线的展示细节",
    ],
  },
  {
    version: "1.6.1",
    changes: [
      "请保存本工具新地址：https://mmtoolkit.app/，旧地址将于7月底失效",
      "合并搜索入口，猫耳和漫播共用“搜索”页面，关键词会同时检索两边结果，并按猫耳/漫播切换查看，查询历史合并显示猫耳/漫播来源",
      "优化趋势弹窗，支持指标勾选显示/隐藏曲线，数据点可查看具体数值；缺失或重复的趋势样本会显示为无数据",
      "优化移动端页面布局，搜索/更新/榜单/收藏合并到顶部菜单栏，节省页面显示空间",
    ],
  },
  {
    version: "1.6.0",
    changes: [
      "请保存本工具新地址 mmtoolkit.app，旧地址将于 2 个月后失效",
      "新增“收藏”页面：可收藏猫耳和漫播剧集，查看最近统计、历史记录和关键指标增量",
      "收藏数据保存在浏览器本地，支持导入导出，方便备份和迁移到其他浏览器",
      "搜索结果、更新页和榜单页支持一键收藏，并在收藏页批量刷新统计数据，数据刷新可在后台运行，刷新运行时无法进行添加或删除收藏的操作",
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
