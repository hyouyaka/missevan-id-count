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
            { key: "cv", ranks: [{ key: "cv", items: [{ cvName: "首页CV", rank: 3, totalViewCount: 7700, works: [] }] }] },
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

  const cvTrigger = screen.getByRole("button", { name: "首页CV更多操作" });
  await user.click(cvTrigger);
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["趋势"]);
  await user.click(screen.getByRole("menuitem", { name: "趋势" }));
  expect(logRankTrendOpen).toHaveBeenLastCalledWith({
    platform: "cv",
    id: "首页CV",
    name: "首页CV",
    source: "homeview",
    rankKey: "cv",
    frontendVersion: "1.7.9",
  });
});
