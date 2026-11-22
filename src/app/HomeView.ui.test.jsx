import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/app/ongoingData", () => ({
  getCachedOngoingData: () => null,
  fetchOngoingData: vi.fn(async ({ platform }) => ({
    response: { ok: true, headers: { get: () => null } },
    data: {
      success: true,
      updatedAt: "2026-08-22T00:00:00Z",
      items: platform === "missevan" ? [{
        id: "11",
        name: "首页更新剧",
        cover: "",
        main_cv_text: "CV甲",
        updated_at: "2026-08-21",
        metrics: { view_count: { value: 12000 } },
        windows: { "7d": { metrics: { view_count: { available: true, delta: 300 } } } },
      }] : [],
    },
  })),
}));

vi.mock("@/app/ranksData", () => ({
  getCachedRanksData: () => null,
  resolveRankRefreshAt: () => "2026-08-22T00:00:00Z",
  fetchRanksData: vi.fn(async () => ({
    response: { ok: true, headers: { get: () => null } },
    data: {
      success: true,
      platforms: {
        missevan: {
          categories: [
            { key: "new", ranks: [{ key: "new_daily", items: [{ id: "22", name: "首页榜单剧", rank: 2, main_cv_text: "CV乙", view_count: 8800 }] }] },
            { key: "peak", ranks: [{ key: "peak", items: [{ name: "首页巅峰系列", type: "peak", rank: 1, drama_ids: ["33"], view_count: 9900, daily_view_delta: { available: true, delta: 100 } }] }] },
          ],
        },
        cv: {
          categories: [
            { key: "total", ranks: [{ key: "combined", available: true, items: [{ cvName: "首页CV", rank: 3, totalViewCount: 7700, topSeries: [{ title: "首页系列" }], topWorks: [{ title: "旧剧集" }], works: [] }] }] },
            { key: "paid", ranks: [{ key: "combined", available: true, items: [] }] },
            { key: "labor", ranks: [{ key: "combined", available: true, items: [] }] },
            { key: "partner", ranks: [{ key: "workCount", available: true, items: [{ rank: 1, cvs: [{ cvName: "甲" }, { cvName: "乙" }], seriesCount: 7 }] }] },
          ],
        },
      },
    },
  })),
}));

vi.mock("@/app/rankTrendData", () => ({
  fetchRankTrendAvailabilityData: vi.fn(async ({ ids }) => ({ response: { ok: true }, data: { success: true, ids } })),
  fetchRankTrendData: vi.fn(async () => ({ response: { ok: true, headers: { get: () => null } }, data: { success: true } })),
  logRankTrendOpen: vi.fn(),
}));

import { HomeView } from "@/app/HomeView";
import { fetchOngoingData } from "@/app/ongoingData";
import { logRankTrendOpen } from "@/app/rankTrendData";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHome(overrides = {}) {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const props = {
    frontendVersion: "1.7.9",
    handleVersionResponse: vi.fn(),
    onNavigateRoute: vi.fn(),
    onOpenSearchResult: vi.fn().mockResolvedValue(true),
    onOpenCv: vi.fn(),
    favoriteKeys: new Set(),
    favoriteActionsDisabled: false,
    statisticsActionsDisabled: false,
    onToggleFavorite: vi.fn(),
    onAddCompareItem: vi.fn(),
    onStartDramaPaidIdStatistics: vi.fn().mockResolvedValue(undefined),
    onStartRevenueEstimate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<HomeView {...props} />);
  return props;
}

test.each([
  [0, 0, true, "0（0）"],
  [9999, 300, true, "9999（+300）"],
  [10000, 10000, true, "1.00万（+1.00万）"],
  [12345678, -12345, true, "1234.57万（-1.23万）"],
  [100000000, 100000000, true, "1.00亿（+1.00亿）"],
  [234567890, -123456789, true, "2.35亿（-1.23亿）"],
  ["123456789", "123456789", true, "1.23亿（+1.23亿）"],
  [123456789, null, false, "1.23亿（暂无）"],
  [123456789, 123456789, false, "1.23亿（暂无）"],
  [null, 300, true, "暂不可用（暂不可用）"],
])("home ongoing cards format playback %s and delta %s using shared display rules", async (value, delta, available, expected) => {
  for (const platform of ["missevan", "manbo"]) {
    vi.mocked(fetchOngoingData).mockResolvedValueOnce({
      response: { ok: true, headers: { get: () => null } },
      data: {
        success: true,
        items: [{
          id: platform === "missevan" ? "11" : "12",
          name: `${platform}格式回归`,
          metrics: { view_count: { value } },
          windows: { "7d": { metrics: { view_count: { available, delta } } } },
        }],
      },
    });
  }
  renderHome();
  for (const platform of ["missevan", "manbo"]) {
    const title = await screen.findByRole("button", { name: `${platform}格式回归` });
    const card = title.closest("article");
    expect(card.querySelector(".tabular-nums").textContent).toBe(expected);
  }
});

test("home drama menus keep rank action order and start statistics only after a successful jump", async () => {
  const user = userEvent.setup();
  const usageFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  const props = renderHome();

  const trigger = await screen.findByRole("button", { name: "首页更新剧更多操作" });
  await user.click(trigger);
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "趋势",
    "对比",
    "收藏",
    "付费ID",
    "收益",
    "猫耳收听",
  ]);
  expect(within(menu).getByRole("menuitem", { name: /在猫耳打开/ })).toHaveTextContent("猫耳收听");

  await user.click(within(menu).getByRole("menuitem", { name: "付费ID" }));
  await waitFor(() => expect(props.onStartDramaPaidIdStatistics).toHaveBeenCalledWith("11", { platform: "missevan", source: "11payID" }));
  expect(props.onOpenSearchResult).toHaveBeenCalledWith(expect.objectContaining({ id: "11", suppressUsageLog: true, usageAction: undefined }));
  expect(usageFetch).toHaveBeenCalledWith(expect.stringContaining("/usage-log"), expect.objectContaining({
    body: expect.stringContaining('"source":"homeview"'),
  }));

  props.onOpenSearchResult.mockResolvedValueOnce(false);
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "收益" }));
  await waitFor(() => expect(props.onOpenSearchResult).toHaveBeenCalledTimes(2));
  expect(props.onStartRevenueEstimate).not.toHaveBeenCalled();
});

test("home peak and CV menus expose only actions supported by their rank type", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  renderHome();

  const peakTrigger = await screen.findByRole("button", { name: "首页巅峰系列更多操作" });
  await user.click(peakTrigger);
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["趋势", "对比"]);
  await user.keyboard("{Escape}");

  const rankTabs = screen.getByRole("tablist", { name: "选择榜单平台" });
  await user.click(within(rankTabs).getByRole("tab", { name: "CV", exact: true }));
  expect(screen.getByText("TOP3：《首页系列》")).toBeInTheDocument();
  expect(screen.queryByText(/旧剧集/)).not.toBeInTheDocument();
  expect(screen.getByText("甲 & 乙")).toBeInTheDocument();
  for (const title of ["播放总榜", "付费总榜", "勤劳总榜", "搭档次数榜"]) {
    expect(screen.getByRole("heading", { name: title, exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看完整" + title })).toBeInTheDocument();
  }
  expect(screen.getByText("7", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText("7 部", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "首页CV更多操作" })).not.toBeInTheDocument();
});

test("home work titles open previews while peak series and CV titles keep their original destinations", async () => {
  const user = userEvent.setup();
  const usageFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, headers: { get: () => null }, json: async () => ({ success: true, metrics: { view_count: 123456, subscription_num: 456, reward_num: 7 } }) });
  const props = renderHome();
  for (const [name, id] of [["首页更新剧", "11"], ["首页榜单剧", "22"]]) {
    props.onOpenSearchResult.mockClear();
    await user.click(await screen.findByRole("button", { name, exact: true }));
    expect(await screen.findByRole("dialog", { name })).toBeVisible();
    expect(await screen.findByText("123456")).toBeVisible();
    expect(props.onOpenSearchResult).not.toHaveBeenCalled();
    expect(usageFetch.mock.calls.some(([url, options]) => String(url).includes("/usage-log") && JSON.parse(options.body).source === "homeview")).toBe(true);
    await user.click(screen.getByRole("button", { name: "进入统计" }));
    expect(props.onOpenSearchResult).toHaveBeenCalledTimes(1);
    expect(props.onOpenSearchResult).toHaveBeenCalledWith(expect.objectContaining({ id, suppressUsageLog: true, usageAction: undefined, usageSource: "homeview" }));
    const previewLogs = usageFetch.mock.calls.filter(([url]) => String(url).includes("/usage-log"))
      .map(([, options]) => JSON.parse(options.body)).filter((entry) => entry.dramaName === name);
    expect(previewLogs.map((entry) => entry.action)).toEqual(["drama_preview_open", "drama_preview_enter_statistics"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }
  await user.click(screen.getByRole("button", { name: "首页巅峰系列", exact: true }));
  expect(props.onOpenSearchResult).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ["33"], suppressUsageLog: false, usageAction: "ranks_open_search_result" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(within(screen.getByRole("tablist", { name: "选择榜单平台" })).getByRole("tab", { name: "CV", exact: true }));
  await user.click(screen.getByRole("button", { name: "首页CV", exact: true }));
  expect(props.onOpenCv).toHaveBeenCalledWith("首页CV", expect.objectContaining({ source: "ranks" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("home shows query history above weekly updates and refreshes from the shared entry", async () => {
  const user = userEvent.setup();
  const onReplayHistoryEntry = vi.fn();
  renderHome({
    historyEntries: [{
      id: "home-history",
      platform: "missevan",
      createdAtLabel: "2026-09-14 10:30",
      taskType: "id",
      items: [{ id: "11", title: "首页更新剧", segments: [] }],
      replay: { version: 1, operation: "paid_id", dramaIds: ["11"] },
    }],
    onReplayHistoryEntry,
    onDeleteHistoryEntry: vi.fn(),
    onClearHistory: vi.fn(),
  });

  const historyTitle = screen.getByText("查询历史");
  const weeklyTitle = await screen.findByRole("heading", { name: "一周内更新" });
  expect(historyTitle.compareDocumentPosition(weeklyTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "展开" }));
  const historyRegion = document.getElementById(screen.getByRole("button", { name: "收起" }).getAttribute("aria-controls"));
  expect(historyRegion).toHaveClass("max-h-[30vh]", "overflow-y-auto", "overscroll-contain");

  await user.click(screen.getByRole("button", { name: "刷新 付费ID" }));
  expect(onReplayHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({ id: "home-history" }));
});
