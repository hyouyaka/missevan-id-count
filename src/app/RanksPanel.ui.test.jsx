import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/app/LazyRankTrendDialog", () => ({ LazyRankTrendDialog: () => null }));

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

test("rank title share buttons are per-rank on desktop, active-rank only on mobile, and disabled for empty ranks", async () => {
  const user = userEvent.setup();
  shareState.failNext = true;
  render(<RanksPanel routeState={{ view: "ranks", platform: "missevan", category: "new", rank: "new_daily" }} />);

  const dailyButtons = await screen.findAllByRole("button", { name: "分享新品日榜为 PNG" });
  const weeklyButton = screen.getByRole("button", { name: "分享新品周榜为 PNG" });
  expect(dailyButtons.length).toBe(2);
  expect(weeklyButton).toBeDisabled();
  await user.click(dailyButtons[0]);
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
