import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { OngoingPanel } from "@/app/OngoingPanel";

const testState = vi.hoisted(() => ({
  cacheByPlatform: {},
  fetchByPlatform: {},
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

vi.mock("@/app/LazyRankTrendDialog", () => ({
  LazyRankTrendDialog: () => null,
}));

function createItem(id, name, mainCvs, delta) {
  const metric = (key, label, value) => ({ key, label, value, visible: true });
  const windowMetric = (key, label, value) => ({ key, label, delta: value, available: true });
  const metrics = {
    view_count: metric("view_count", "播放量", 100 + delta),
    subscription_num: metric("subscription_num", "追剧人数", 20 + delta),
    danmaku_uid_count: metric("danmaku_uid_count", "付费ID数", 10 + delta),
  };
  const windowMetrics = {
    view_count: windowMetric("view_count", "播放量", delta),
    subscription_num: windowMetric("subscription_num", "追剧人数", delta),
    danmaku_uid_count: windowMetric("danmaku_uid_count", "付费ID数", delta),
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
