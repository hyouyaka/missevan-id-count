import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { OngoingPanel } from "@/app/OngoingPanel";

const testState = vi.hoisted(() => ({
  cacheByPlatform: {},
  fetchByPlatform: {},
}));
const shareTestState = vi.hoisted(() => ({
  requests: [],
  failNext: false,
  urlApi: null,
}));

vi.mock("@/app/ongoingData", () => ({
  getCachedOngoingData: vi.fn(({ platform }) => testState.cacheByPlatform[platform] || null),
  fetchOngoingData: vi.fn(async ({ platform }) => testState.fetchByPlatform[platform]),
}));

vi.mock("@/app/rankTrendData", () => ({
  fetchRankTrendAvailabilityData: vi.fn(async () => ({ response: { ok: true }, data: { success: true, ids: [] } })),
  resolveRankTrendAvailabilityIds: vi.fn(() => new Set()),
}));

vi.mock("@/app/rankTrendActions", () => ({
  fetchRankTrendData: vi.fn(),
  logRankTrendOpen: vi.fn(),
}));

vi.mock("@/app/ongoingShare", () => ({
  buildOngoingShareTable: ({ platform, metric }) => ({
    metricName: metric === "secondary" ? (platform === "manbo" ? "付费/收听人数" : "追剧人数") : "播放量",
    title: (platform === "manbo" ? "漫播" : "猫耳") + "一周内更新剧集（按当前指标7日增量排序）",
  }),
  createOngoingSharePng: vi.fn(async (request) => {
    shareTestState.requests.push(request);
    if (shareTestState.failNext) {
      shareTestState.failNext = false;
      throw new Error("模拟绘图失败");
    }
    return new Blob(["png"], { type: "image/png" });
  }),
}));

vi.mock("@/app/LazyRankTrendDialog", () => ({
  LazyRankTrendDialog: () => null,
}));

function createItem(id, name, mainCvs, delta, metricDeltas = {}) {
  const metric = (key, label, value) => ({ key, label, value, visible: true });
  const windowMetric = (key, label) => ({
    key,
    label,
    delta: metricDeltas[key] ?? delta,
    available: true,
  });
  const metrics = {
    view_count: metric("view_count", "播放量", 100 + delta),
    subscription_num: metric("subscription_num", "追剧人数", 20 + delta),
    danmaku_uid_count: metric("danmaku_uid_count", "付费ID数", 10 + delta),
    pay_count: metric("pay_count", "付费/收听人数", 5 + delta),
  };
  const windowMetrics = {
    view_count: windowMetric("view_count", "播放量"),
    subscription_num: windowMetric("subscription_num", "追剧人数"),
    danmaku_uid_count: windowMetric("danmaku_uid_count", "付费ID数"),
    pay_count: windowMetric("pay_count", "付费/收听人数"),
  };
  return {
    id,
    name,
    main_cvs: mainCvs,
    main_cv_text: mainCvs.join("，"),
    content_type_label: "广播剧",
    payment_label: "免费",
    updated_at: "2026-09-10T12:00:00.000Z",
    metrics,
    windows: {
      "3d": { metrics: windowMetrics },
      "7d": { metrics: windowMetrics },
      "30d": { metrics: windowMetrics },
    },
  };
}

function createPayload(platform, items) {
  return {
    success: true,
    platform,
    updatedAt: "2026-09-12T12:00:00.000Z",
    windows: {
      "3d": { key: "3d" },
      "7d": { key: "7d" },
      "30d": { key: "30d" },
    },
    items,
  };
}

function createUnavailableItem(id = "90878") {
  const metrics = {
    view_count: { key: "view_count", label: "播放量", value: null, visible: true },
    subscription_num: { key: "subscription_num", label: "追剧人数", value: null, visible: true },
    danmaku_uid_count: { key: "danmaku_uid_count", label: "付费ID数", value: null, visible: true },
    pay_count: { key: "pay_count", label: "付费/收听人数", value: null, visible: true },
  };
  const windowMetrics = Object.fromEntries(
    Object.entries(metrics).map(([key, metric]) => [key, {
      key,
      label: metric.label,
      fromValue: null,
      toValue: null,
      delta: null,
      available: false,
    }])
  );
  return {
    id,
    name: "当前日缺失剧",
    cover: "https://example.com/missing.jpg",
    main_cvs: [],
    main_cv_text: "",
    content_type_label: "广播剧",
    payment_label: "免费",
    metrics,
    windows: {
      "3d": { metrics: windowMetrics },
      "7d": { metrics: windowMetrics },
      "30d": { metrics: windowMetrics },
    },
  };
}

function createFetchResult(data) {
  return { response: { ok: true }, data };
}

function getDesktopFilterTrigger() {
  return screen.getAllByRole("button", { name: /CV筛选/ }).at(-1);
}

async function openDesktopFilter(user) {
  await user.click(getDesktopFilterTrigger());
  return screen.findByRole("dialog", { name: "CV筛选选项" });
}

async function waitForDrama(name) {
  await waitFor(() => expect(screen.getAllByText(name).length).toBeGreaterThan(0));
}

function getCardNameOrder(names) {
  return Array.from(document.querySelectorAll('[data-slot="card"]'))
    .map((card) => names.find((name) => card.textContent.includes(name)))
    .filter(Boolean);
}

function getUsageLogEntries(action) {
  return vi.mocked(globalThis.fetch).mock.calls
    .filter(([url]) => String(url).includes("/usage-log"))
    .map(([, options]) => JSON.parse(options.body))
    .filter((entry) => entry.action === action);
}

const catItems = [
  createItem("1", "猫甲", ["甲", "共同"], 30),
  createItem("2", "猫乙", ["乙"], 20),
  createItem("3", "猫丙", ["甲"], 10),
];
const manboItems = [
  createItem("11", "漫甲", ["漫乙"], 30),
  createItem("12", "漫乙", ["漫甲"], 20),
];

beforeEach(() => {
  testState.cacheByPlatform = {};
  testState.fetchByPlatform = {
    missevan: createFetchResult(createPayload("missevan", catItems)),
    manbo: createFetchResult(createPayload("manbo", manboItems)),
  };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ success: true }) })));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matches: true,
  })));
  shareTestState.requests = [];
  shareTestState.failNext = false;
  const NativeURL = globalThis.URL;
  const TestURL = class extends NativeURL {};
  TestURL.createObjectURL = vi.fn(() => `blob:ongoing-${shareTestState.requests.length}`);
  TestURL.revokeObjectURL = vi.fn();
  shareTestState.urlApi = TestURL;
  vi.stubGlobal("URL", TestURL);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("ongoing CV selection survives remount and failed refreshes, then removes unavailable names after success", async () => {
  const user = userEvent.setup();
  const firstRender = render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", window: "3d" }} />);

  await waitForDrama("猫甲");
  const firstFilter = await openDesktopFilter(user);
  await user.click(within(firstFilter).getByRole("button", { name: "筛选甲，2部作品" }));
  expect(screen.getAllByText("猫甲").length).toBeGreaterThan(0);
  expect(screen.getAllByText("猫丙").length).toBeGreaterThan(0);
  expect(screen.queryAllByText("猫乙")).toHaveLength(0);
  firstRender.unmount();

  testState.cacheByPlatform.missevan = createFetchResult(createPayload("missevan", catItems));
  testState.fetchByPlatform.missevan = { response: { ok: false }, data: { success: false } };
  const failedRefreshRender = render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", window: "3d" }} />);
  await waitForDrama("猫甲");
  expect(getDesktopFilterTrigger()).toHaveTextContent("CV筛选 · 1");
  failedRefreshRender.unmount();

  testState.cacheByPlatform.missevan = null;
  testState.fetchByPlatform.missevan = createFetchResult(createPayload("missevan", [
    createItem("2", "猫乙", ["乙"], 20),
  ]));
  render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", window: "3d" }} />);
  await waitForDrama("猫乙");
  await waitFor(() => expect(getDesktopFilterTrigger()).toHaveTextContent("CV筛选"));
  expect(getDesktopFilterTrigger()).not.toHaveTextContent("· 1");
});

test("ongoing cards show 暂不可用 for missing current metrics", async () => {
  testState.fetchByPlatform.missevan = createFetchResult(
    createPayload("missevan", [createUnavailableItem()])
  );
  render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", window: "3d" }} />);

  await waitForDrama("当前日缺失剧");
  expect(screen.getAllByText("暂不可用")).toHaveLength(6);
});

test("ongoing capsules sort by 7-day metrics and preserve their selection across platforms", async () => {
  const user = userEvent.setup();
  const catSortItems = [
    createItem("21", "猫播放领先", [], 1, {
      view_count: 80,
      subscription_num: 2,
      danmaku_uid_count: 40,
    }),
    createItem("22", "猫追剧领先", [], 1, {
      view_count: 10,
      subscription_num: 90,
      danmaku_uid_count: 5,
    }),
  ];
  const manboSortItems = [
    createItem("31", "漫付费收听领先", [], 1, {
      view_count: 15,
      pay_count: 70,
      danmaku_uid_count: 3,
    }),
    createItem("32", "漫播放领先", [], 1, {
      view_count: 60,
      pay_count: 8,
      danmaku_uid_count: 30,
    }),
  ];
  testState.fetchByPlatform.missevan = createFetchResult(createPayload("missevan", catSortItems));
  testState.fetchByPlatform.manbo = createFetchResult(createPayload("manbo", manboSortItems));
  const onRouteStateChange = vi.fn();
  render(
    <OngoingPanel
      routeState={{ view: "ongoing", platform: "missevan", window: "3d", metric: "playback" }}
      onRouteStateChange={onRouteStateChange}
    />
  );

  await waitForDrama("猫播放领先");
  expect(screen.getByText(/按7日增量排列，更新于：/)).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "3日" })).not.toBeInTheDocument();
  expect(getCardNameOrder(["猫播放领先", "猫追剧领先"])).toEqual(["猫播放领先", "猫追剧领先"]);

  await user.click(screen.getAllByRole("tab", { name: "追剧" }).at(-1));
  await waitFor(() => expect(getCardNameOrder(["猫播放领先", "猫追剧领先"])).toEqual(["猫追剧领先", "猫播放领先"]));
  expect(onRouteStateChange).toHaveBeenLastCalledWith({
    view: "ongoing",
    platform: "missevan",
    metric: "secondary",
  });

  await user.click(screen.getAllByRole("tab", { name: "付费ID" }).at(-1));
  await waitFor(() => expect(getCardNameOrder(["猫播放领先", "猫追剧领先"])).toEqual(["猫播放领先", "猫追剧领先"]));
  await user.click(screen.getAllByRole("tab", { name: /漫播/ }).at(-1));
  await waitForDrama("漫付费收听领先");
  expect(screen.getAllByRole("tab", { name: "付费ID" }).at(-1)).toHaveAttribute("aria-selected", "true");

  await user.click(screen.getAllByRole("tab", { name: "播放" }).at(-1));
  await waitFor(() => expect(getCardNameOrder(["漫付费收听领先", "漫播放领先"])).toEqual(["漫播放领先", "漫付费收听领先"]));
  await user.click(screen.getAllByRole("tab", { name: "付费/收听" }).at(-1));
  await waitFor(() => expect(getCardNameOrder(["漫付费收听领先", "漫播放领先"])).toEqual(["漫付费收听领先", "漫播放领先"]));
  expect(screen.getAllByRole("tab", { name: "付费/收听" })).toHaveLength(2);
  expect(onRouteStateChange).toHaveBeenLastCalledWith({
    view: "ongoing",
    platform: "manbo",
    metric: "secondary",
  });
});

test("ongoing logs explicit metric changes but ignores route restoration and platform switching", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <OngoingPanel routeState={{ view: "ongoing", platform: "missevan", metric: "playback" }} />
  );
  await waitForDrama("猫甲");
  await waitFor(() => expect(getUsageLogEntries("ongoing")).toHaveLength(1));
  expect(getUsageLogEntries("ongoing_metric_change")).toEqual([]);

  rerender(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", metric: "secondary" }} />);
  await waitFor(() => expect(screen.getAllByRole("tab", { name: "追剧" }).at(-1)).toHaveAttribute("aria-selected", "true"));
  await user.click(screen.getAllByRole("tab", { name: "追剧" }).at(-1));
  await user.click(screen.getAllByRole("tab", { name: "付费ID" }).at(-1));
  await waitFor(() => expect(getUsageLogEntries("ongoing_metric_change")).toHaveLength(1));

  await user.click(screen.getAllByRole("tab", { name: /漫播/ }).at(-1));
  await waitForDrama("漫甲");
  expect(getUsageLogEntries("ongoing_metric_change")).toHaveLength(1);
  await user.click(screen.getAllByRole("tab", { name: "付费/收听" }).at(-1));
  await waitFor(() => expect(getUsageLogEntries("ongoing_metric_change")).toHaveLength(2));
  expect(getUsageLogEntries("ongoing_metric_change")).toEqual([
    {
      platform: "missevan",
      action: "ongoing_metric_change",
      source: "ongoing",
      previousMetric: "secondary",
      metric: "paid-id",
      success: true,
    },
    {
      platform: "manbo",
      action: "ongoing_metric_change",
      source: "ongoing",
      previousMetric: "paid-id",
      metric: "secondary",
      success: true,
    },
  ]);
});

test("mobile platform tabs keep their icons and counts with accessible names before and after loading", async () => {
  let resolveManboCount;
  testState.fetchByPlatform.manbo = new Promise((resolve) => {
    resolveManboCount = resolve;
  });
  render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", window: "30d" }} />);

  await waitForDrama("猫甲");
  await waitFor(() => expect(screen.getByRole("tab", { name: "猫耳平台，3部作品" })).toBeInTheDocument());
  const manboTab = screen.getByRole("tab", { name: "漫播平台，作品数量暂未加载" });
  expect(manboTab).toHaveTextContent("—");
  expect(manboTab.querySelector('[aria-hidden="true"][data-platform="manbo"]')).not.toBeNull();

  resolveManboCount(createFetchResult(createPayload("manbo", manboItems)));
  await waitFor(() => expect(screen.getByRole("tab", { name: "漫播平台，2部作品" })).toBeInTheDocument());
});

test("ongoing CV selections remain separate when the platform tab changes", async () => {
  const user = userEvent.setup();
  render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", window: "3d" }} />);

  await waitForDrama("猫甲");
  await user.click(screen.getAllByRole("tab", { name: /漫播/ }).at(-1));
  await waitForDrama("漫甲");
  const manboFilter = await openDesktopFilter(user);
  await user.click(within(manboFilter).getByRole("button", { name: "筛选漫乙，1部作品" }));
  expect(getDesktopFilterTrigger()).toHaveTextContent("CV筛选 · 1");

  await user.click(screen.getAllByRole("tab", { name: /猫耳/ }).at(-1));
  await waitForDrama("猫甲");
  expect(getDesktopFilterTrigger()).toHaveTextContent("CV筛选");
  expect(getDesktopFilterTrigger()).not.toHaveTextContent("· 1");

  await user.click(screen.getAllByRole("tab", { name: /漫播/ }).at(-1));
  await waitForDrama("漫甲");
  expect(getDesktopFilterTrigger()).toHaveTextContent("CV筛选 · 1");
  const filter = await openDesktopFilter(user);
  await user.click(within(filter).getByRole("button", { name: "清空" }));
});

test("ongoing share exports the filtered metric order, retries failures, and releases its preview URL", async () => {
  const user = userEvent.setup();
  const shareItems = [
    createItem("81", "分享排序落后", ["分享CV"], 1, { subscription_num: 10 }),
    createItem("82", "分享排序领先", ["分享CV"], 1, { subscription_num: 80 }),
    createItem("83", "分享筛选排除", ["其他CV"], 1, { subscription_num: 30 }),
  ];
  testState.fetchByPlatform.missevan = createFetchResult(createPayload("missevan", shareItems));
  shareTestState.failNext = true;
  render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", metric: "playback" }} />);

  await waitForDrama("分享排序领先");
  await user.click(screen.getAllByRole("tab", { name: "追剧" }).at(-1));
  const filter = await openDesktopFilter(user);
  await user.click(within(filter).getByRole("button", { name: "筛选分享CV，2部作品" }));
  await user.click(screen.getAllByRole("button", { name: "分享猫耳连载列表为 PNG" }).at(-1));

  await screen.findByText("模拟绘图失败");
  await user.click(screen.getByRole("button", { name: "重试" }));
  const firstImage = await screen.findByRole("img", { name: /猫耳一周内更新剧集/ });
  await waitFor(() => expect(getUsageLogEntries("share_image_generate")).toHaveLength(2));
  expect(getUsageLogEntries("share_image_generate")).toEqual([
    {
      platform: "missevan",
      action: "share_image_generate",
      source: "ongoing",
      itemCount: 2,
      isRetry: false,
      metric: "secondary",
      success: true,
    },
    {
      platform: "missevan",
      action: "share_image_generate",
      source: "ongoing",
      itemCount: 2,
      isRetry: true,
      metric: "secondary",
      success: true,
    },
  ]);
  expect(shareTestState.requests).toHaveLength(2);
  expect(shareTestState.requests[0].platform).toBe("missevan");
  expect(shareTestState.requests[0].metric).toBe("secondary");
  expect(shareTestState.requests[0].selectedCvNames).toEqual(["分享CV"]);
  expect(shareTestState.requests[0].items.map((item) => item.name)).toEqual([
    "分享排序领先",
    "分享排序落后",
  ]);
  expect(firstImage).toHaveClass("w-full", "max-w-full", "sm:w-auto", "sm:max-w-full");
  expect(firstImage.parentElement).toHaveClass("overflow-auto");
  const originalSizeButton = screen.getByRole("button", { name: "按原图尺寸查看" });
  expect(originalSizeButton).toHaveClass("sm:hidden");
  Object.defineProperty(firstImage, "naturalWidth", { configurable: true, value: 680 });
  fireEvent.load(firstImage);
  await waitFor(() => expect(screen.getByRole("dialog").style.width).toBe("748px"));
  await user.click(originalSizeButton);
  expect(firstImage).toHaveClass("w-auto", "max-w-none");
  expect(screen.getByRole("button", { name: "保存 PNG" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "关闭图片预览" }));
  await waitFor(() => expect(shareTestState.urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:ongoing-2"));

  await user.click(screen.getAllByRole("button", { name: "分享猫耳连载列表为 PNG" }).at(-1));
  const secondImage = await screen.findByRole("img", { name: /猫耳一周内更新剧集/ });
  await waitFor(() => expect(screen.getByRole("dialog").style.width).toBe(""));
  expect(secondImage).toHaveClass("w-full", "max-w-full");
  expect(screen.getByRole("button", { name: "按原图尺寸查看" })).toBeInTheDocument();
  Object.defineProperty(secondImage, "naturalWidth", { configurable: true, value: 1280 });
  fireEvent.load(secondImage);
  await waitFor(() => expect(screen.getByRole("dialog").style.width).toBe("1348px"));
  expect(screen.getByRole("dialog")).toHaveClass("max-w-[calc(100vw-2rem)]");
  expect(secondImage.parentElement).toHaveClass("overflow-auto");
  expect(secondImage.style.width).toBe("");
  expect(secondImage).toHaveClass("w-full", "sm:w-auto", "sm:max-w-full");
  await user.click(screen.getByRole("button", { name: "关闭图片预览" }));
  await waitFor(() => expect(shareTestState.urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:ongoing-3"));

  await user.click(screen.getAllByRole("button", { name: "分享猫耳连载列表为 PNG" }).at(-1));
  const failedImage = await screen.findByRole("img", { name: /猫耳一周内更新剧集/ });
  fireEvent.error(failedImage);
  await screen.findByText("PNG 图片无法加载，请重试。");
  expect(screen.getByRole("dialog").style.width).toBe("");
  expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "关闭图片预览" }));
  await waitFor(() => expect(shareTestState.urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:ongoing-4"));
});

test("ongoing share snapshots no, multiple, and platform-specific CV selections", async () => {
  const user = userEvent.setup();
  render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan", metric: "playback" }} />);
  await waitForDrama("猫甲");

  const clearCurrentSelection = async () => {
    const filter = await openDesktopFilter(user);
    const clearButton = within(filter).getByRole("button", { name: "清空" });
    if (!clearButton.disabled) await user.click(clearButton);
    await user.click(getDesktopFilterTrigger());
  };
  await clearCurrentSelection();

  const shareCat = screen.getAllByRole("button", { name: "分享猫耳连载列表为 PNG" }).at(-1);
  await user.click(shareCat);
  await screen.findByRole("img", { name: /猫耳一周内更新剧集/ });
  expect(shareTestState.requests[0].selectedCvNames).toEqual([]);
  await user.click(screen.getByRole("button", { name: "关闭图片预览" }));

  const catFilter = await openDesktopFilter(user);
  await user.click(within(catFilter).getByRole("button", { name: "筛选甲，2部作品" }));
  await user.click(within(catFilter).getByRole("button", { name: "筛选乙，1部作品" }));
  await user.click(screen.getAllByRole("button", { name: "分享猫耳连载列表为 PNG" }).at(-1));
  await screen.findByRole("img", { name: /猫耳一周内更新剧集/ });
  expect(shareTestState.requests[1].selectedCvNames).toEqual(["甲", "乙"]);
  expect(shareTestState.requests[1].items.map((item) => item.name)).toEqual(["猫甲", "猫乙", "猫丙"]);
  await user.click(screen.getByRole("button", { name: "关闭图片预览" }));

  await clearCurrentSelection();
  await user.click(screen.getAllByRole("tab", { name: /漫播/ }).at(-1));
  await waitForDrama("漫甲");
  await clearCurrentSelection();
  await user.click(screen.getAllByRole("button", { name: "分享漫播连载列表为 PNG" }).at(-1));
  await screen.findByRole("img", { name: /漫播一周内更新剧集/ });
  expect(shareTestState.requests[2].platform).toBe("manbo");
  expect(shareTestState.requests[2].selectedCvNames).toEqual([]);
  expect(shareTestState.requests[1].selectedCvNames).toEqual(["甲", "乙"]);
  await user.click(screen.getByRole("button", { name: "关闭图片预览" }));
  await clearCurrentSelection();
});

test("ongoing share buttons are disabled when the current list has no visible rows", async () => {
  testState.fetchByPlatform.missevan = createFetchResult(createPayload("missevan", []));
  render(<OngoingPanel routeState={{ view: "ongoing", platform: "missevan" }} />);
  await screen.findByText("还没有连载中数据");
  const shareButtons = screen.getAllByRole("button", { name: "分享猫耳连载列表为 PNG" });
  expect(shareButtons).toHaveLength(2);
  shareButtons.forEach((button) => expect(button).toBeDisabled());
  expect(getUsageLogEntries("share_image_generate")).toEqual([]);
});
