import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { FavoritesPanel } from "@/app/FavoritesPanel";

const testState = vi.hoisted(() => ({ snapshots: [], activeFavorite: null, savedSnapshots: [] }));

vi.mock("@/app/favoritesStorage", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    listSnapshots: vi.fn(async () => testState.snapshots),
    loadFavoriteSettings: vi.fn(async () => ({ deltaMetric: "viewCount", sortBy: "lastSnapshotAt" })),
    saveFavoriteSettings: vi.fn(async (settings) => settings),
    importFavoritesData: vi.fn(async (payload) => payload),
    getFavoriteByKey: vi.fn(async () => testState.activeFavorite),
    updateFavoriteIfExists: vi.fn(async (_key, updater) => updater(testState.activeFavorite)),
    saveSnapshot: vi.fn(async (snapshot) => {
      testState.savedSnapshots.push(snapshot);
      return snapshot;
    }),
  };
});

const favorite = {
  key: "missevan:93038",
  platform: "missevan",
  dramaId: "93038",
  title: "一屋暗灯",
  cover: "",
  paymentLabel: "付费",
  contentTypeLabel: "广播剧",
  mainCvText: "主要CV：倒霉死勒，袁铭喆",
  createdAt: 1,
  updatedAt: 1,
  lastSnapshotAt: 70,
};

const manboFavorite = {
  key: "manbo:200",
  platform: "manbo",
  dramaId: "200",
  title: "晴日来信",
  cover: "",
  paymentLabel: "会员",
  contentTypeLabel: "有声漫",
  mainCvText: "主要CV：乙",
  createdAt: 2,
  updatedAt: 2,
  lastSnapshotAt: 0,
};

function createSnapshot(capturedAt, overrides = {}) {
  return {
    id: `${favorite.key}:${capturedAt}`,
    favoriteKey: favorite.key,
    platform: favorite.platform,
    dramaId: favorite.dramaId,
    capturedAt,
    status: "success",
    metrics: {
      viewCount: 100 + capturedAt,
      subscriptionCount: 50 + capturedAt,
      rewardCount: 10 + capturedAt,
      rewardTotal: 1000 + capturedAt,
      giftTotal: null,
      paidOrListenCount: null,
      paidIdCount: 20 + capturedAt,
    },
    metricErrors: {},
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  testState.activeFavorite = favorite;
  testState.savedSnapshots = [];
  testState.snapshots = [
    createSnapshot(10),
    createSnapshot(20),
    createSnapshot(30),
    createSnapshot(40),
    createSnapshot(50),
    createSnapshot(60, {
      status: "partial",
      metrics: {
        viewCount: 160,
        subscriptionCount: 110,
        rewardCount: 70,
        rewardTotal: 1060,
        giftTotal: null,
        paidOrListenCount: null,
        paidIdCount: null,
      },
      metricErrors: { paidIdCount: "付费 ID 读取失败" },
      errors: ["付费 ID 读取失败"],
    }),
    createSnapshot(70, {
      status: "failed",
      metrics: {},
      errors: ["作品详情读取失败"],
    }),
  ];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
  vi.clearAllMocks();
});

test("mobile favorite history renders five rows and appends five at a time", async () => {
  const user = userEvent.setup();
  const { container } = render(<FavoritesPanel favorites={[favorite]} isDesktopApp />);

  expect(await screen.findByText(/最近一次刷新失败，部分指标沿用上次有效数据/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "历史记录（7）" }));

  const timeline = container.querySelector(".favorite-history-timeline");
  expect(timeline).not.toBeNull();
  expect(timeline.querySelectorAll("li")).toHaveLength(5);
  expect(timeline.querySelector("li:nth-child(1)")).toHaveClass("odd:bg-background", "even:bg-muted/45");
  expect(timeline.querySelector(".favorite-history-delta")).toHaveClass("text-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))]");
  const desktopTable = container.querySelector(".favorite-history-table");
  expect(desktopTable.querySelector("tbody tr")).toHaveClass("odd:bg-background", "even:bg-muted/45");
  expect(desktopTable.querySelector(".favorite-history-delta")).toHaveClass("text-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))]");

  await user.click(within(timeline).getByRole("button", { name: "再显示 2 条" }));
  expect(timeline.querySelectorAll("li")).toHaveLength(7);
});

test("mobile history expands one snapshot at a time and exposes failure provenance", async () => {
  const user = userEvent.setup();
  const { container } = render(<FavoritesPanel favorites={[favorite]} isDesktopApp />);

  await user.click(await screen.findByRole("button", { name: "历史记录（7）" }));
  const timeline = container.querySelector(".favorite-history-timeline");
  const failedTrigger = within(timeline).getByRole("button", { name: "查看失败详情" });
  const detailTriggers = within(timeline).getAllByRole("button", { name: "查看全部指标" });

  expect(failedTrigger).toHaveAttribute("aria-expanded", "false");
  await user.click(failedTrigger);
  expect(failedTrigger).toHaveAttribute("aria-expanded", "true");
  expect(within(timeline).getByText("作品详情读取失败")).toBeInTheDocument();
  expect(document.getElementById(failedTrigger.getAttribute("aria-controls"))).not.toHaveClass("bg-muted/45");

  await user.click(detailTriggers[0]);
  expect(failedTrigger).toHaveAttribute("aria-expanded", "false");
  expect(detailTriggers[0]).toHaveAttribute("aria-expanded", "true");
  expect(within(timeline).getByText("付费 ID：付费 ID 读取失败")).toBeInTheDocument();
  expect(within(timeline).getByText(/卡片摘要沿用 .* 的有效值/)).toBeInTheDocument();
});

test("responsive favorite toolbar keeps a fluid search and fluid mobile selects", async () => {
  const user = userEvent.setup();
  render(<FavoritesPanel favorites={[favorite]} isDesktopApp />);

  const mobileToolbar = screen.getByTestId("favorite-mobile-toolbar");
  expect(screen.getByTestId("favorite-mobile-toolbar-primary")).toHaveClass("flex-nowrap");
  expect(screen.getByTestId("favorite-mobile-toolbar-secondary")).toHaveClass("grid", "gap-0");
  expect(within(mobileToolbar).getByRole("searchbox", { name: "搜索收藏" })).toBeInTheDocument();
  expect(screen.getByTestId("favorite-mobile-search-control")).toHaveClass("min-w-11", "flex-1");
  expect(within(mobileToolbar).getByRole("switch", { name: "全选当前筛选结果" })).toBeInTheDocument();
  expect(within(mobileToolbar).getByRole("button", { name: "筛选" })).toBeInTheDocument();
  expect(within(mobileToolbar).getByRole("button", { name: "清除搜索" })).toBeDisabled();
  const refreshButton = within(mobileToolbar).getByRole("button", { name: "刷新所选 0 部" });
  expect(refreshButton).toBeDisabled();
  expect(refreshButton).toHaveTextContent("刷新0");
  expect(refreshButton).toHaveAttribute("title", "刷新所选 0 部");
  const metricTrigger = within(mobileToolbar).getByRole("combobox", { name: "关注指标：播放量" });
  expect(metricTrigger).toHaveAttribute("title", "关注指标：播放量");
  expect(metricTrigger).toHaveClass("w-full");
  expect(metricTrigger).not.toHaveAttribute("style");
  const sortTrigger = within(mobileToolbar).getByRole("combobox", { name: "排序：最近刷新" });
  expect(sortTrigger).toHaveClass("w-full");
  expect(sortTrigger).not.toHaveAttribute("style");

  await user.click(metricTrigger);
  expect(screen.getByRole("listbox").style.minWidth).toContain("var(--radix-select-trigger-width)");
  await user.click(await screen.findByRole("option", { name: "追剧/收藏" }));
  expect(within(mobileToolbar).getByRole("combobox", { name: "关注指标：追剧/收藏" })).toBeInTheDocument();
});

test("mobile search remains visible at a fluid width and clears from its trailing control", async () => {
  const user = userEvent.setup();
  render(<FavoritesPanel favorites={[favorite, manboFavorite]} isDesktopApp />);

  const mobileToolbar = screen.getByTestId("favorite-mobile-toolbar");
  const search = within(mobileToolbar).getByRole("searchbox", { name: "搜索收藏" });
  await user.type(search, "晴日");
  expect(screen.queryByText(favorite.title, { exact: true })).not.toBeInTheDocument();
  const clearSearch = within(mobileToolbar).getByRole("button", { name: "清除搜索" });
  expect(clearSearch).toBeEnabled();
  await user.click(clearSearch);
  expect(search).toHaveValue("");
  expect(clearSearch).toBeDisabled();
  expect(screen.getByText(favorite.title, { exact: true })).toBeInTheDocument();
});

test("mobile refresh control replaces its selected count with running progress", () => {
  render(
    <FavoritesPanel
      favorites={[favorite]}
      isDesktopApp
      refreshState={{ isRunning: true, progress: 42, currentTitle: favorite.title, currentAction: "分集 2/5" }}
    />
  );

  const mobileToolbar = screen.getByTestId("favorite-mobile-toolbar");
  const refreshButton = within(mobileToolbar).getByRole("button", { name: "刷新中 42%：分集 2/5" });
  expect(refreshButton).toBeDisabled();
  expect(refreshButton).toHaveAttribute("title", "刷新中 42%：分集 2/5");
  expect(refreshButton).toHaveTextContent("刷新42%");
});

test("favorite filters reuse semantic badge tones and platform glyphs", async () => {
  const user = userEvent.setup();
  render(<FavoritesPanel favorites={[favorite, manboFavorite]} isDesktopApp />);
  const mobileToolbar = screen.getByTestId("favorite-mobile-toolbar");

  await user.click(within(mobileToolbar).getByRole("button", { name: "筛选" }));
  const panel = document.getElementById("favorite-mobile-filter-panel");
  const missevanButton = within(panel).getByRole("button", { name: "猫耳" });
  expect(missevanButton.querySelector('[data-platform="missevan"]')).not.toBeNull();
  expect(missevanButton.firstElementChild).toHaveClass("bg-[var(--platform-missevan-soft)]");
  await user.click(missevanButton);
  expect(missevanButton.firstElementChild).toHaveAttribute("data-variant", "missevanPlatform");

  const radioDramaButton = within(panel).getByRole("button", { name: "广播剧" });
  await user.click(radioDramaButton);
  expect(radioDramaButton.firstElementChild).toHaveAttribute("data-variant", "radioDrama");

  const paidButton = within(panel).getByRole("button", { name: "付费" });
  await user.click(paidButton);
  expect(paidButton.firstElementChild).toHaveAttribute("data-variant", "paid");
});

test("mobile filters combine with search, prune hidden selections, and select all current results", async () => {
  const user = userEvent.setup();
  render(<FavoritesPanel favorites={[favorite, manboFavorite]} isDesktopApp />);

  await user.click(await screen.findByRole("checkbox", { name: `选择${favorite.title}` }));
  const mobileToolbar = screen.getByTestId("favorite-mobile-toolbar");
  await user.click(within(mobileToolbar).getByRole("button", { name: "筛选" }));
  await user.click(within(mobileToolbar).getByRole("button", { name: "漫播" }));

  expect(screen.queryByText(favorite.title, { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText(manboFavorite.title, { exact: true })).toBeInTheDocument();
  expect(within(mobileToolbar).getByRole("button", { name: "刷新所选 0 部" })).toBeDisabled();

  await user.click(within(mobileToolbar).getByRole("switch", { name: "全选当前筛选结果" }));
  const selectedRefreshButton = within(mobileToolbar).getByRole("button", { name: "刷新所选 1 部" });
  expect(selectedRefreshButton).toBeEnabled();
  expect(selectedRefreshButton).toHaveTextContent("1");

  await user.click(within(mobileToolbar).getByRole("button", { name: /筛选，已启用 1 项/ }));
  const search = within(mobileToolbar).getByRole("searchbox", { name: "搜索收藏" });
  await user.clear(search);
  await user.type(search, "不存在的作品");
  expect(await screen.findByText("没有符合条件的收藏")).toBeInTheDocument();
});

test("mobile filter and more panels are mutually exclusive and use shared history action labels", async () => {
  const user = userEvent.setup();
  render(<FavoritesPanel favorites={[favorite]} isDesktopApp />);
  const mobileToolbar = screen.getByTestId("favorite-mobile-toolbar");

  const filterTrigger = within(mobileToolbar).getByRole("button", { name: "筛选" });
  const moreTrigger = within(mobileToolbar).getByRole("button", { name: "更多收藏操作" });
  expect(within(filterTrigger).queryByText("筛选")).not.toBeInTheDocument();
  expect(within(moreTrigger).queryByText("更多")).not.toBeInTheDocument();
  await user.click(filterTrigger);
  expect(filterTrigger).toHaveAttribute("aria-expanded", "true");
  const filterPanel = document.getElementById("favorite-mobile-filter-panel");
  expect(filterPanel).toHaveClass("right-0", "top-11", "z-20", "w-[16.875rem]");

  await user.click(filterTrigger);
  expect(filterTrigger).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("favorite-mobile-filter-panel")).toBeNull();

  await user.click(filterTrigger);
  await user.click(screen.getByText("本地收藏说明"));
  expect(filterTrigger).toHaveAttribute("aria-expanded", "false");

  await user.click(filterTrigger);
  await user.keyboard("{Escape}");
  expect(filterTrigger).toHaveFocus();

  await user.click(moreTrigger);
  expect(filterTrigger).toHaveAttribute("aria-expanded", "false");
  expect(moreTrigger).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById("favorite-mobile-filter-panel")).toBeNull();
  const morePanel = document.getElementById("favorite-mobile-more-panel");
  expect(morePanel).toHaveClass("right-0", "w-40", "z-20");
  expect(morePanel.firstElementChild).toHaveClass("grid", "gap-1");
  expect(morePanel.firstElementChild).not.toHaveClass("grid-cols-3");
  expect(within(morePanel).getByRole("button", { name: "导入历史" })).toBeInTheDocument();
  expect(within(morePanel).getByRole("button", { name: "导出历史" })).toBeInTheDocument();
  expect(within(morePanel).getByRole("button", { name: "下载数据" })).toBeDisabled();
});

test("imported favorite settings apply immediately without a page reload", async () => {
  const { container } = render(<FavoritesPanel favorites={[favorite]} isDesktopApp />);
  const mobileToolbar = await screen.findByTestId("favorite-mobile-toolbar");
  expect(within(mobileToolbar).getByRole("combobox", { name: "关注指标：播放量" })).toBeInTheDocument();

  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: {
      files: [{
        text: async () => JSON.stringify({
          settings: { deltaMetric: "paidIdCount", sortBy: "paidIdCount" },
        }),
      }],
    },
  });

  expect(await within(mobileToolbar).findByRole("combobox", { name: "关注指标：付费 ID 数" })).toBeInTheDocument();
  expect(within(mobileToolbar).getByRole("combobox", { name: "排序：最高付费 ID" })).toBeInTheDocument();
});

test("favorite refresh maps live task snapshots to single-item progress and actions", async () => {
  vi.useFakeTimers();
  const taskSnapshots = [
    { taskId: "task-1", status: "running", progress: 35, currentAction: "正在统计收益：一屋暗灯 / 分集 1/3" },
    { taskId: "task-1", status: "running", progress: 70, currentAction: "正在统计收益：一屋暗灯 / 分集 2/3" },
    {
      taskId: "task-1",
      status: "completed",
      progress: 100,
      currentAction: "收益预估完成",
      result: {
        revenueResults: [{ dramaId: favorite.dramaId, rewardNum: 12, rewardCoinTotal: 340, seasonPaidUserCount: 56 }],
      },
    },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) {
      return new Response(JSON.stringify([{
        success: true,
        info: {
          drama: {
            id: favorite.dramaId,
            name: favorite.title,
            view_count: 100,
            subscription_num: 50,
            diamond_value: 0,
          },
          episodes: { episode: [] },
        },
      }]));
    }
    if (path.includes("/stat-tasks") && options.method === "POST") {
      return new Response(JSON.stringify({
        taskId: "task-1",
        status: "queued",
        queuePosition: 2,
        progress: 0,
      }));
    }
    if (path.includes("/stat-tasks/task-1")) {
      return new Response(JSON.stringify(taskSnapshots.shift()));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));

  const onRefreshStateChange = vi.fn();
  const onBackgroundTaskChange = vi.fn();
  render(
    <FavoritesPanel
      favorites={[favorite]}
      isDesktopApp
      onRefreshStateChange={onRefreshStateChange}
      onBackgroundTaskChange={onBackgroundTaskChange}
    />
  );

  fireEvent.click(screen.getByRole("checkbox", { name: `选择${favorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));
  await act(async () => {
    await vi.runAllTimersAsync();
  });

  const progressValues = onRefreshStateChange.mock.calls.map(([state]) => state.progress);
  expect(progressValues).toContain(43);
  expect(progressValues).toContain(71);
  expect(progressValues).toContain(95);
  expect(progressValues.at(-1)).toBe(100);
  expect(onBackgroundTaskChange.mock.calls.some(([state]) => (
    state.action === `${favorite.title} · 任务排队中，前方 2 个任务`
  ))).toBe(true);
  expect(onBackgroundTaskChange.mock.calls.some(([state]) => (
    state.action === "正在统计收益：一屋暗灯 / 分集 2/3" && state.progress === 71
  ))).toBe(true);
  expect(screen.getByRole("checkbox", { name: `选择${favorite.title}` })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "刷新所选 0 部" })).toBeDisabled();
});

test("favorite refresh clears selection after a partial metric failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) {
      return new Response(JSON.stringify([{
        success: true,
        info: {
          drama: { id: favorite.dramaId, name: favorite.title, view_count: 100, subscription_num: 50, diamond_value: 0 },
          episodes: { episode: [] },
        },
      }]));
    }
    if (path.includes("/stat-tasks") && options.method === "POST") {
      return new Response(JSON.stringify({ taskId: "task-partial", status: "failed", progress: 40, error: "收益统计失败" }));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));

  const onBackgroundTaskChange = vi.fn();
  render(<FavoritesPanel favorites={[favorite]} isDesktopApp onBackgroundTaskChange={onBackgroundTaskChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${favorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    isRunning: false,
    status: "completed",
    title: "收藏刷新完成，部分指标未获取",
    action: "1 部作品部分指标未获取。",
  })));
  expect(testState.savedSnapshots.at(-1)?.status).toBe("partial");
  expect(screen.getByRole("checkbox", { name: `选择${favorite.title}` })).not.toBeChecked();
});

test("favorite refresh preserves real zeroes and marks missing Missevan fields as unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) {
      return new Response(JSON.stringify([{
        success: true,
        info: {
          drama: { id: favorite.dramaId, name: favorite.title, view_count: 0 },
          episodes: { episode: [] },
        },
      }]));
    }
    if (path.includes("/stat-tasks") && options.method === "POST") {
      return new Response(JSON.stringify({
        taskId: "task-missing-fields",
        status: "completed",
        progress: 100,
        result: {
          revenueResults: [{ dramaId: favorite.dramaId, rewardNum: 0, seasonPaidUserCount: 0 }],
        },
      }));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));

  const onBackgroundTaskChange = vi.fn();
  render(<FavoritesPanel favorites={[favorite]} isDesktopApp onBackgroundTaskChange={onBackgroundTaskChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${favorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    isRunning: false,
    status: "completed",
  })));
  const saved = testState.savedSnapshots.at(-1);
  expect(saved.status).toBe("partial");
  expect(saved.metrics).toMatchObject({
    viewCount: 0,
    subscriptionCount: null,
    rewardCount: 0,
    rewardTotal: null,
    paidIdCount: 0,
  });
  expect(saved.metricErrors).toMatchObject({
    subscriptionCount: "追剧/收藏人数未获取",
    rewardTotal: "打赏榜总和未获取",
  });
});

test("favorite refresh keeps missing Manbo detail metrics nullable", async () => {
  testState.activeFavorite = manboFavorite;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
    success: true,
    info: {
      drama: {
        id: manboFavorite.dramaId,
        name: manboFavorite.title,
        view_count: 0,
        subscription_num: 0,
      },
      episodes: { episode: [] },
    },
  }]))));

  const onBackgroundTaskChange = vi.fn();
  render(<FavoritesPanel favorites={[manboFavorite]} isDesktopApp onBackgroundTaskChange={onBackgroundTaskChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${manboFavorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    isRunning: false,
    status: "completed",
  })));
  const saved = testState.savedSnapshots.at(-1);
  expect(saved.status).toBe("partial");
  expect(saved.metrics).toMatchObject({
    viewCount: 0,
    subscriptionCount: 0,
    giftTotal: null,
    paidOrListenCount: null,
    paidIdCount: 0,
  });
  expect(saved.metricErrors).toMatchObject({
    giftTotal: "总投喂未获取",
    paidOrListenCount: "付费/收听人数未获取",
  });
});

test("favorite refresh rejects completed Missevan revenue results marked as failed", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) {
      return new Response(JSON.stringify([{
        success: true,
        info: {
          drama: { id: favorite.dramaId, name: favorite.title, view_count: 10, subscription_num: 5 },
          episodes: { episode: [] },
        },
      }]));
    }
    if (path.includes("/stat-tasks") && options.method === "POST") {
      return new Response(JSON.stringify({
        taskId: "task-revenue-partial",
        status: "completed",
        progress: 100,
        failedCount: 1,
        currentAction: "收益预估完成，部分失败",
        result: {
          revenueResults: [{
            dramaId: favorite.dramaId,
            failed: true,
            rewardNum: null,
            rewardCoinTotal: 0,
            seasonPaidUserCount: 0,
          }],
        },
      }));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));

  const onBackgroundTaskChange = vi.fn();
  render(<FavoritesPanel favorites={[favorite]} isDesktopApp onBackgroundTaskChange={onBackgroundTaskChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${favorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "收藏刷新完成，部分指标未获取",
  })));
  expect(testState.savedSnapshots.at(-1)?.metrics).toMatchObject({
    rewardCount: null,
    rewardTotal: null,
    paidIdCount: null,
  });
  expect(testState.savedSnapshots.at(-1)?.metricErrors).toMatchObject({
    rewardCount: "收益预估完成，部分失败",
    rewardTotal: "收益预估完成，部分失败",
    paidIdCount: "收益预估完成，部分失败",
  });
});

test("favorite refresh rejects partial Manbo ID totals instead of saving a synthetic zero", async () => {
  testState.activeFavorite = manboFavorite;
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) {
      return new Response(JSON.stringify([{
        success: true,
        info: {
          drama: {
            id: manboFavorite.dramaId,
            name: manboFavorite.title,
            view_count: 10,
            subscription_num: 5,
            diamond_value: 0,
            pay_count: 0,
          },
          episodes: { episode: [{ sound_id: "set-1", name: "第一集", pay_type: 1, duration: 100 }] },
        },
      }]));
    }
    if (path.includes("/stat-tasks") && options.method === "POST") {
      return new Response(JSON.stringify({
        taskId: "task-id-partial",
        status: "completed",
        progress: 100,
        failedCount: 1,
        currentAction: "统计完成，跳过 1 个分集",
        result: { idResults: [{ users: 0 }] },
      }));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));

  const onBackgroundTaskChange = vi.fn();
  render(<FavoritesPanel favorites={[manboFavorite]} isDesktopApp onBackgroundTaskChange={onBackgroundTaskChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${manboFavorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "收藏刷新完成，部分指标未获取",
  })));
  expect(testState.savedSnapshots.at(-1)?.metrics.paidIdCount).toBeNull();
  expect(testState.savedSnapshots.at(-1)?.metricErrors).toMatchObject({
    paidIdCount: "统计完成，跳过 1 个分集",
  });
});

test("favorite refresh clears selection after an ordinary work failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
    success: false,
    message: "作品详情读取失败",
  }]))));

  const onBackgroundTaskChange = vi.fn();
  render(<FavoritesPanel favorites={[favorite]} isDesktopApp onBackgroundTaskChange={onBackgroundTaskChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${favorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    isRunning: false,
    status: "failed",
  })));
  expect(testState.savedSnapshots.at(-1)?.status).toBe("failed");
  expect(screen.getByRole("checkbox", { name: `选择${favorite.title}` })).not.toBeChecked();
});

test("favorite refresh preserves selection when access denial stops the queue", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    accessDenied: true,
    message: "猫耳访问受限",
  }))));

  const onBackgroundTaskChange = vi.fn();
  render(<FavoritesPanel favorites={[favorite]} isDesktopApp onBackgroundTaskChange={onBackgroundTaskChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${favorite.title}` }));
  fireEvent.click(screen.getByRole("button", { name: "刷新所选 1 部" }));

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    isRunning: false,
    status: "failed",
  })));
  expect(screen.getByRole("checkbox", { name: `选择${favorite.title}` })).toBeChecked();
  expect(screen.getByRole("button", { name: "刷新所选 1 部" })).toBeEnabled();
});

test("favorite refresh prevents duplicate queues and settles unexpected synchronization failures", async () => {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) {
      return new Response(JSON.stringify([{
        success: true,
        info: {
          drama: {
            id: favorite.dramaId,
            name: favorite.title,
            view_count: 100,
            subscription_num: 50,
          },
          episodes: { episode: [] },
        },
      }]));
    }
    if (path.includes("/stat-tasks") && options.method === "POST") {
      return new Response(JSON.stringify({
        taskId: "task-sync-failure",
        status: "completed",
        progress: 100,
        result: {
          revenueResults: [{
            dramaId: favorite.dramaId,
            rewardNum: 1,
            rewardCoinTotal: 2,
            seasonPaidUserCount: 3,
          }],
        },
      }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const onBackgroundTaskChange = vi.fn();
  const onFavoritesChange = vi.fn(async () => {
    throw new Error("收藏列表同步失败");
  });
  render(
    <FavoritesPanel
      favorites={[favorite]}
      isDesktopApp
      onBackgroundTaskChange={onBackgroundTaskChange}
      onFavoritesChange={onFavoritesChange}
    />
  );
  fireEvent.click(screen.getByRole("checkbox", { name: `选择${favorite.title}` }));
  const refreshButton = screen.getByRole("button", { name: "刷新所选 1 部" });
  fireEvent.click(refreshButton);
  fireEvent.click(refreshButton);

  await waitFor(() => expect(onBackgroundTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({
    isRunning: false,
    status: "failed",
    title: "收藏刷新异常中止",
    progress: 99,
  })));
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/getdramas"))).toHaveLength(1);
  expect(screen.getByRole("checkbox", { name: `选择${favorite.title}` })).toBeChecked();
});
