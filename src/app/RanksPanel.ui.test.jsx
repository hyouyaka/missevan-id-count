import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { RanksPanel } from "@/app/RanksPanel";

const testState = vi.hoisted(() => ({ payload: null }));
const shareState = vi.hoisted(() => ({ requests: [], failNext: false, urlApi: null }));

vi.mock("@/app/ranksData", () => ({
  getCachedRanksData: vi.fn(() => ({ data: testState.payload })),
  fetchRanksData: vi.fn(async () => ({ response: { ok: true }, data: testState.payload })),
  resolveRankRefreshAt: vi.fn((_data, _category, rank) => rank?.fetchedAt || testState.payload?.updatedAt || ""),
}));

vi.mock("@/app/rankTrendData", () => ({
  fetchRankTrendData: vi.fn(async () => ({ response: { ok: true, headers: new Headers() }, data: { success: true } })),
  fetchRankTrendAvailabilityData: vi.fn(async () => ({ response: { ok: true }, data: { success: true, ids: ["101"] } })),
  resolveRankTrendAvailabilityIds: vi.fn(() => new Set(["101"])),
}));

vi.mock("@/app/rankTrendActions", async () => {
  const React = await import("react");
  const ActionButton = React.forwardRef((props, ref) => <button ref={ref} type="button" {...props} />);
  return {
    canShowRankTrend: () => false,
    CompareActionButton: ActionButton,
    fetchRankTrendData: vi.fn(),
    formatRankTrendCompactDelta: () => "0",
    formatRankTrendDelta: () => "0",
    logRankTrendOpen: vi.fn(),
    rankTrendTagVariants: {},
    RankTrendDeltaBadge: ({ children }) => <span>{children}</span>,
    RankTrendButton: ActionButton,
  };
});

vi.mock("@/app/LazyRankTrendDialog", () => ({
  LazyRankTrendDialog: ({ item }) => <div role="dialog">{item.trendMetricKey}</div>,
}));

vi.mock("@/app/ranksShare", () => ({
  buildRanksShareTable: vi.fn((request) => ({ title: request.rank.name })),
  createRanksSharePng: vi.fn(async (request) => {
    shareState.requests.push(request);
    if (shareState.failNext) {
      shareState.failNext = false;
      throw new Error("模拟绘图失败");
    }
    return new Blob(["png"], { type: "image/png" });
  }),
}));

function createPayload() {
  return {
    success: true,
    updatedAt: "2026-09-29T17:00:00.000Z",
    platforms: {
      missevan: {
        key: "missevan",
        label: "猫耳",
        categories: [{
          key: "new",
          label: "新品榜",
          ranks: [
            {
              key: "new_daily",
              label: "日榜",
              name: "新品日榜",
              items: [{
                rank: 1,
                id: 101,
                name: "要分享的剧集",
                view_count: 12000,
                subscription_num: 20,
                reward_total: 30,
                danmaku_uid_count: 4,
                main_cv_text: "主要CV：CV甲",
                main_cvs: ["CV甲"],
                type: "drama",
              }],
            },
            { key: "new_weekly", label: "周榜", name: "新品周榜", items: [] },
          ],
        }],
      },
    },
  };
}

function setCvRanks(platform, ranks) {
  const categories = {
    cv: ["total", "总榜"],
    "cv-paid": ["paid", "付费榜"],
    "cv-series-count": ["labor", "勤劳榜"],
  };
  testState.payload.platforms.cv = {
    key: "cv",
    label: "CV",
    categories: ranks.map((rank) => {
      const [key, label] = categories[rank.key];
      return { key, label, ranks: [{ ...rank, key: platform, sourcePlatform: platform, rankKind: key }] };
    }),
  };
}

function getUsageLogEntries(action) {
  return vi.mocked(globalThis.fetch).mock.calls
    .filter(([url]) => String(url).includes("/usage-log"))
    .map(([, options]) => JSON.parse(options.body))
    .filter((entry) => entry.action === action);
}

beforeEach(() => {
  testState.payload = createPayload();
  shareState.requests = [];
  shareState.failNext = false;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (callback) => setTimeout(callback, 0));
  const NativeURL = globalThis.URL;
  const TestURL = class extends NativeURL {};
  TestURL.createObjectURL = vi.fn(() => `blob:ranks-${shareState.requests.length}`);
  TestURL.revokeObjectURL = vi.fn();
  shareState.urlApi = TestURL;
  vi.stubGlobal("URL", TestURL);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mockRanksLayout(initialWidth) {
  const listeners = new Set();
  let width = initialWidth;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.callback = callback; }
    observe(element) {
      if (!element.hasAttribute("data-ranks-layout")) return;
      listeners.add(this.callback);
      this.callback([{ contentRect: { width } }]);
    }
    disconnect() { listeners.delete(this.callback); }
  });
  return (nextWidth) => act(() => {
    width = nextWidth;
    listeners.forEach((listener) => listener([{ contentRect: { width } }]));
  });
}

test("single-rank views log daily and weekly separately and deduplicate repeat visits", async () => {
  const setWidth = mockRanksLayout(651);
  const user = userEvent.setup();
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "new", rank: "new_daily" }} />);
  await waitFor(() => expect(getUsageLogEntries("ranks").map((entry) => entry.keyword)).toEqual(["新品日榜"]));
  await user.click(screen.getByRole("tab", { name: "周", exact: true }));
  await waitFor(() => expect(getUsageLogEntries("ranks").map((entry) => entry.keyword)).toEqual(["新品日榜", "新品周榜"]));
  await user.click(screen.getByRole("tab", { name: "日", exact: true }));
  expect(getUsageLogEntries("ranks")).toHaveLength(2);
  setWidth(652);
  await waitFor(() => expect(getUsageLogEntries("ranks").map((entry) => entry.keyword)).toEqual(["新品日榜", "新品周榜", "新品榜"]));
  setWidth(651);
  expect(getUsageLogEntries("ranks")).toHaveLength(3);
});

test.each([false, true])("CV view logs match the visible scope (wide=%s)", async (wide) => {
  mockRanksLayout(wide ? 984 : 651);
  const user = userEvent.setup();
  setCvRanks("missevan", [
    { key: "cv", label: "总榜", name: "CV总榜", items: [] },
    { key: "cv-paid", label: "付费榜", name: "CV付费榜", items: [] },
    { key: "cv-series-count", label: "勤劳榜", name: "CV勤劳榜", items: [] },
  ]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "cv", rank: "cv" }} />);
  await waitFor(() => expect(getUsageLogEntries("ranks").map((entry) => entry.keyword)).toEqual(["CV总榜"]));
  await user.click(screen.getAllByRole("tab", { name: "勤劳", exact: true })[0]);
  await waitFor(() => expect(getUsageLogEntries("ranks").map((entry) => entry.keyword)).toEqual(["CV总榜", "CV勤劳榜"]));
});

test("CV shows all sub-ranks side by side only in wide layouts", async () => {
  const setWidth = mockRanksLayout(984);
  const user = userEvent.setup();
  const makeRanks = (kind, title, scopes) => scopes.map(([key, label]) => ({
    key, label, name: title + "（" + label + "）", rankKind: kind, items: [],
  }));
  testState.payload.platforms.cv = {
    key: "cv", label: "CV", categories: [
      { key: "total", label: "总榜", ranks: makeRanks("total", "CV总榜", [["combined", "合计"], ["missevan", "猫耳"], ["manbo", "漫播"]]) },
      { key: "partner", label: "搭档榜", ranks: makeRanks("partner", "CV搭档榜", [["workCount", "次数"], ["viewCount", "播放"]]) },
    ],
  };
  render(<RanksPanel routeState={{ view: "ranks", platform: "cv", category: "total", rank: "manbo" }} />);
  expect(screen.getAllByRole("heading", { name: /CV总榜/ })).toHaveLength(3);
  expect(screen.queryByRole("tablist", { name: "CV 分榜" })).not.toBeInTheDocument();
  expect(getUsageLogEntries("ranks").map((entry) => entry.keyword)).toEqual(["CV总榜"]);
  setWidth(983);
  const mobileScopes = screen.getByRole("tablist", { name: "CV 分榜" });
  expect(mobileScopes).toHaveTextContent("合计猫耳漫播");
  expect(mobileScopes.querySelector('[role="tab"]')).toHaveAccessibleName("合计");
  expect(mobileScopes.querySelector('[data-platform="combined"] [data-platform="missevan"]')).toBeInTheDocument();
  expect(mobileScopes.querySelector('[data-platform="combined"] [data-platform="manbo"]')).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { name: /CV总榜/ })).toHaveLength(1);
  expect(screen.getByRole("heading", { name: /CV总榜（漫播）/ })).toBeInTheDocument();
  expect(getUsageLogEntries("ranks").map((entry) => entry.keyword)).toEqual(["CV总榜", "CV总榜（漫播）"]);
  setWidth(652);
  await user.click(screen.getAllByRole("tab", { name: "搭档", exact: true })[0]);
  expect(screen.getAllByRole("heading", { name: /CV搭档榜/ })).toHaveLength(2);
  expect(screen.getByRole("heading", { name: /CV搭档榜（次数）/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /CV搭档榜（播放）/ })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "播放", exact: true })).not.toBeInTheDocument();
  setWidth(651);
  expect(screen.getAllByRole("heading", { name: /CV搭档榜/ })).toHaveLength(1);
  expect(screen.getByRole("tab", { name: "播放", exact: true })).toBeInTheDocument();
});

test.each(["missevan", "manbo"])("labor rank %s keeps series counts primary and exposes playback trends", async (platform) => {
  const works = [{ platform, dramaId: "101", title: "勤劳作品", viewCount: 100 }];
  testState.payload.platforms[platform] ||= { key: platform, label: platform === "manbo" ? "漫播" : "猫耳", categories: [] };
  setCvRanks(platform, [
    { key: "cv-series-count", label: "勤劳榜", name: "CV勤劳榜", fetchedAt: "2026-11-13T12:00:00Z", items: [
      { cvName: "勤劳CV", cvKey: "person:00000000-0000-0000-0000-000000000001", rank: 1, seriesCount: 48, totalViewCount: 123456789, works, playbackDelta: { available: true, delta: 100 } },
      { cvName: "无播放CV", rank: 2, seriesCount: 47, totalViewCount: null, works: [] },
    ] },
  ]);
  const onOpenCv = vi.fn();
  render(<RanksPanel routeState={{ view: "ranks", platform, category: "cv", rank: "cv-series-count" }} onOpenCv={onOpenCv} />);
  const count = screen.getAllByLabelText("系列数: 48")[0];
  expect(count).toHaveClass("font-semibold");
  const playback = screen.getAllByLabelText("总播放量: 1.23亿")[0];
  expect(playback.querySelector("span")).toHaveClass("font-medium");
  expect(screen.getAllByLabelText("总播放量: 暂无数据").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/周增：/)).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "查看无播放CV趋势" })).toBeNull();
  expect(screen.getByRole("button", { name: "查看勤劳CV趋势" })).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: "勤劳CV", exact: true })[0]);
  expect(onOpenCv).toHaveBeenCalledWith("勤劳CV", expect.objectContaining({ platform, rankKey: "cv-series-count" }));
  await user.click(screen.getAllByRole("button", { name: "展开勤劳CV作品列表" })[0]);
  expect(screen.getByRole("button", { name: "勤劳作品", exact: true })).toBeInTheDocument();
});

test.each(["missevan", "manbo", "combined"])("combined labor dialog defaults to the row's %s playback scope", async (playbackPlatform) => {
  setCvRanks("combined", [{ key: "cv-series-count", label: "汇总", name: "勤劳总榜", items: [
    { cvName: "汇总勤劳CV", cvKey: "person:00000000-0000-0000-0000-000000000001", rank: 1, seriesCount: 7, totalViewCount: 120, playbackPlatform, works: [] },
  ] }]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "cv", category: "labor", rank: "combined" }} />);
  await userEvent.click(screen.getByRole("button", { name: "查看汇总勤劳CV趋势" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(`${playbackPlatform}_total_view_count`);
});

test("labor ranks render all 32 CVs including every tied 30th place", () => {
  const items = Array.from({ length: 32 }, (_, index) => ({
    cvName: `并列显示CV${index + 1}`, rank: index < 29 ? index + 1 : 30,
    seriesCount: index < 29 ? 40 - index : 10, totalViewCount: null, works: [],
  }));
  setCvRanks("missevan", [
    { key: "cv-series-count", label: "勤劳榜", name: "CV勤劳榜", fetchedAt: "", items },
  ]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "cv", rank: "cv-series-count" }} />);
  const rendered = screen.getAllByRole("button", { name: /^并列显示CV\d+$/ });
  expect(rendered).toHaveLength(32);
  expect(screen.getByText("32 位 CV")).toBeInTheDocument();
  expect(screen.getAllByText("第30名")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "并列显示CV32", exact: true })).toBeInTheDocument();
});

test("labor ranks keep empty legacy data visible", () => {
  setCvRanks("missevan", [
    { key: "cv-series-count", label: "勤劳榜", name: "CV勤劳榜", fetchedAt: "", items: [] },
  ]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "cv", rank: "cv-series-count" }} />);
  expect(screen.getAllByText("该榜单暂无数据").length).toBeGreaterThan(0);
});

test("CV ranks preview series cards closed and retain closed groups when the outer list reopens", async () => {
  const user = userEvent.setup();
  const works = [
    { platform: "missevan", dramaId: "101", title: "第一季", viewCount: 5000, mainCvs: ["CV甲"], seriesId: "group", seriesTitle: "合并系列" },
    { platform: "missevan", dramaId: "102", title: "第二季", viewCount: 4000, mainCvs: ["CV甲"], seriesId: "group", seriesTitle: "合并系列" },
    { platform: "missevan", dramaId: "103", title: "单部作品", viewCount: 3000, mainCvs: ["CV甲"] },
  ];
  setCvRanks("missevan", [{
    key: "cv", label: "总榜", name: "CV总榜",
    items: [{ cvName: "CV甲", rank: 1, seriesCount: 2, workCount: 3, totalViewCount: 12000, works }],
  }]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "cv", rank: "cv" }} />);
  const openButtons = await screen.findAllByRole("button", { name: "展开CV甲作品列表" });
  expect(openButtons[0]).toHaveTextContent("《合并系列》 《单部作品》");
  expect(screen.getAllByLabelText("系列数: 2").length).toBeGreaterThan(0);
  await user.click(openButtons[0]);
  const group = screen.getByRole("button", { name: "展开系列合并系列" });
  expect(group).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "第一季", exact: true })).not.toBeInTheDocument();
  await user.click(group);
  expect(screen.getByRole("button", { name: "第一季", exact: true })).toBeVisible();
  expect(screen.queryByRole("button", { name: "收起系列单部作品" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "收起系列合并系列" }));
  expect(screen.queryByRole("button", { name: "第一季", exact: true })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "收起CV甲作品列表" }));
  await user.click(screen.getAllByRole("button", { name: "展开CV甲作品列表" })[0]);
  expect(screen.getByRole("button", { name: "展开系列合并系列" })).toHaveAttribute("aria-expanded", "false");
});

test("CV rank series switching keeps the next expand button mounted until click completes", async () => {
  const user = userEvent.setup();
  const works = [1, 2, 3, 4].map((id) => ({ platform: "missevan", dramaId: String(id), title: `作品${id}`, viewCount: 1000 - id, seriesId: id < 3 ? "a" : "b", seriesTitle: id < 3 ? "系列甲" : "系列乙" }));
  setCvRanks("missevan", [{ key: "cv", name: "CV总榜", items: [{ cvName: "CV甲", rank: 1, works }] }]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "cv", rank: "cv" }} />);
  await user.click((await screen.findAllByRole("button", { name: "展开CV甲作品列表" }))[0]);
  await user.click(screen.getByRole("button", { name: "展开系列系列甲" }));
  const next = screen.getByRole("button", { name: "展开系列系列乙" });
  fireEvent.pointerDown(next, { pointerType: "touch", button: 0 });
  expect(screen.getByRole("button", { name: "收起系列系列甲" })).toHaveAttribute("aria-expanded", "true");
  fireEvent.pointerUp(next, { pointerType: "touch", button: 0 });
  fireEvent.click(next, { detail: 1 });
  expect(screen.getByRole("button", { name: "展开系列系列甲" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: "收起系列系列乙" })).toHaveAttribute("aria-expanded", "true");
});

test("ordinary rank titles preview metrics before entering search while peak series keep direct navigation", async () => {
  const user = userEvent.setup();
  const open = vi.fn(async () => true);
  const view = render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "new", rank: "new_daily" }} onOpenSearchResult={open} />);
  await user.click((await screen.findAllByRole("button", { name: "要分享的剧集" }))[0]);
  expect(screen.getByRole("dialog", { name: "要分享的剧集" })).toBeVisible();
  expect(open).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "进入统计" }));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 101, suppressUsageLog: true, usageAction: undefined }));
  expect(getUsageLogEntries("drama_preview_enter_statistics")).toEqual([expect.objectContaining({ dramaId: "101", source: "ranks" })]);
  view.unmount();
  open.mockClear();
  testState.payload.platforms.missevan.categories[0].ranks[0].items[0] = { rank: 1, name: "系列巅峰", type: "peak", drama_ids: [101, 102] };
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "new", rank: "new_daily" }} onOpenSearchResult={open} />);
  await user.click((await screen.findAllByRole("button", { name: "系列巅峰" }))[0]);
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ ids: [101, 102], suppressUsageLog: false, usageAction: "ranks_open_search_result" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test.each([false, true])("CV rank series dismisses only after its nested preview is closed (popover=%s)", async (popover) => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: popover, addEventListener() {}, removeEventListener() {} })));
  const user = userEvent.setup();
  const works = [1, 2].map((id) => ({ dramaId: String(id), title: `系列作品${id}`, viewCount: 100, seriesId: "nested", seriesTitle: "嵌套系列" }));
  setCvRanks("missevan", [{ key: "cv", name: "CV总榜", items: [{ cvName: "CV甲", rank: 1, works }] }]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "cv", rank: "cv" }} onOpenSearchResult={vi.fn(async () => true)} />);
  await user.click((await screen.findAllByRole("button", { name: "展开CV甲作品列表" }))[0]);
  await user.click(screen.getByRole("button", { name: "展开系列嵌套系列" }));
  await user.click(screen.getByRole("button", { name: "系列作品1" }));
  expect(screen.getByRole("dialog", { name: "系列作品1" })).toBeVisible();
  await user.click(popover ? document.body : document.querySelector('[data-slot="sheet-overlay"][data-state="open"]'));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "系列作品1" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "收起系列嵌套系列" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "系列作品1" })).toBeVisible();
  await user.click(document.body);
  expect(screen.getByRole("button", { name: "展开系列嵌套系列" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "展开系列嵌套系列" }));
  await user.click(screen.getByRole("button", { name: "收起系列嵌套系列" }));
  expect(screen.getByRole("button", { name: "展开系列嵌套系列" })).toHaveAttribute("aria-expanded", "false");
});

test("CV rank work titles preview without changing the series disclosure or CV profile navigation", async () => {
  const user = userEvent.setup();
  const open = vi.fn(async () => true);
  const onOpenCv = vi.fn();
  setCvRanks("missevan", [{ key: "cv", name: "CV总榜", items: [{ cvName: "CV甲", rank: 1, works: [{ dramaId: "101", title: "单部作品", viewCount: 100 }] }] }]);
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "cv", rank: "cv" }} onOpenSearchResult={open} onOpenCv={onOpenCv} />);
  await user.click((await screen.findAllByRole("button", { name: "展开CV甲作品列表" }))[0]);
  await user.click(screen.getByRole("button", { name: "单部作品" }));
  expect(screen.getByRole("dialog", { name: "单部作品" })).toBeVisible();
  expect(open).not.toHaveBeenCalled();
  expect(onOpenCv).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "进入统计" }));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "101", usageAction: "ranks_open_search_result", usageSource: "ranks_cv" }));
  expect(open.mock.calls[0][0].suppressUsageLog).not.toBe(true);
});

test("rank title share buttons are per-rank on desktop, active-rank only on mobile, and disabled for empty ranks", async () => {
  const setWidth = mockRanksLayout(652);
  const user = userEvent.setup();
  shareState.failNext = true;
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "new", rank: "new_daily" }} />);

  const dailyButton = await screen.findByRole("button", { name: "分享新品日榜为 PNG" });
  const weeklyButton = screen.getByRole("button", { name: "分享新品周榜为 PNG" });
  expect(weeklyButton).toBeDisabled();
  setWidth(651);
  expect(screen.queryByRole("button", { name: "分享新品周榜为 PNG" })).not.toBeInTheDocument();
  await user.click(dailyButton);
  await screen.findByText("模拟绘图失败");
  await user.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("img", { name: "新品日榜" });
  await waitFor(() => expect(getUsageLogEntries("share_image_generate")).toHaveLength(2));
  expect(getUsageLogEntries("share_image_generate")).toEqual([
    {
      platform: "missevan",
      action: "share_image_generate",
      source: "ranks",
      itemCount: 1,
      isRetry: false,
      categoryKey: "new",
      rankKey: "new_daily",
      success: true,
    },
    {
      platform: "missevan",
      action: "share_image_generate",
      source: "ranks",
      itemCount: 1,
      isRetry: true,
      categoryKey: "new",
      rankKey: "new_daily",
      success: true,
    },
  ]);

  expect(shareState.requests).toHaveLength(2);
  expect(shareState.requests[0].platform).toBe("missevan");
  expect(shareState.requests[0].categoryKey).toBe("new");
  expect(shareState.requests[0].rank.items.map(({ name }) => name)).toEqual(["要分享的剧集"]);
  await user.click(screen.getByRole("button", { name: "关闭图片预览" }));
  await waitFor(() => expect(shareState.urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:ranks-2"));
});

test("rank share generation continues when usage logging fails", async () => {
  const user = userEvent.setup();
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const entry = JSON.parse(options.body);
    if (entry.action === "share_image_generate") throw new Error("日志不可用");
    return { ok: true, json: async () => ({ success: true }) };
  }));
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "new", rank: "new_daily" }} />);

  const [shareButton] = await screen.findAllByRole("button", { name: "分享新品日榜为 PNG" });
  await user.click(shareButton);
  await screen.findByRole("img", { name: "新品日榜" });
  expect(shareState.requests).toHaveLength(1);
  await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("Failed to log rank user action", expect.any(Error)));
  errorSpy.mockRestore();
});


test("partner details keep platform identity when two releases share a drama ID", async () => {
  const user = userEvent.setup();
  const open = vi.fn(async () => true);
  const works = [
    { platform: "missevan", dramaId: "101", title: "同剧猫耳版", viewCount: 100 },
    { platform: "manbo", dramaId: "101", title: "同剧漫播版", viewCount: 200 },
  ];
  testState.payload.platforms.cv = {
    key: "cv", label: "CV", categories: [{ key: "partner", label: "搭档榜", ranks: [{
      key: "workCount", name: "CV搭档榜（次数）", rankKind: "partner", items: [{
        rank: 1, cvs: [{ cvName: "甲" }, { cvName: "乙" }], totalViewCount: 300, seriesCount: 4,
        series: [{ id: "merged", title: "双平台系列", works, playCount: 300 }],
      }],
    }] }],
  };
  render(<RanksPanel routeState={{ view: "ranks", platform: "cv", category: "partner", rank: "workCount" }} onOpenSearchResult={open} />);
  expect(screen.getByRole("heading", { name: "甲 & 乙" })).toBeVisible();
  expect(screen.getByLabelText("合作系列数: 4")).toHaveTextContent(/^4$/);
  await user.click(screen.getByRole("button", { name: "展开甲 & 乙作品列表" }));
  await user.click(screen.getByRole("button", { name: "展开系列双平台系列" }));
  expect(screen.getAllByText("101", { exact: true })).toHaveLength(2);
  for (const [platform, label] of [["missevan", "猫耳"], ["manbo", "漫播"]]) {
    expect(screen.getByRole("img", { name: label + " ID" })).toBeInTheDocument();
    expect(screen.queryByText(label + " 101")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同剧" + label + "版" }));
    expect(screen.getByRole("dialog", { name: "同剧" + label + "版" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "进入统计" }));
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ platform, id: "101" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }
});
