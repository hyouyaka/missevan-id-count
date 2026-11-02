import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { OutputPanel } from "@/app/OutputPanel";
import { buildPaidCoefficientBasis } from "../../shared/paidCoefficient.js";
import { setPaidCoefficient } from "./paidCoefficientStore.js";
import { createRevenueDisplayReporter } from "./revenueDisplayLog.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("first displayed revenue reports its coefficient once; slider changes do not log again", () => {
  setPaidCoefficient("missevan", 4);
  const send = vi.fn(async () => {});
  const onRevenueDisplayed = createRevenueDisplayReporter(send);
  const base = { dramaId: "logged", title: "日志作品", platform: "missevan", revenueType: "season", estimatedRevenueYuan: 15, rewardCoinTotal: 50 };
  const result = { ...base, paidCoefficientBasis: buildPaidCoefficientBasis(base) };
  const props = { platform: "missevan", showHistory: false, revenueResults: [result], onRevenueDisplayed };
  const { rerender } = render(<OutputPanel {...props} revenueDisplayTaskId="task-a" />);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ action: "stats_task_displayed", taskId: "task-a", platform: "missevan", paidCoefficient: 4 });
  expect(screen.getByText("45")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "日志作品 付费系数：4" }));
  fireEvent.change(screen.getByRole("slider"), { target: { value: "8" } });
  expect(screen.getByText("85")).toBeInTheDocument();
  expect(send).toHaveBeenCalledTimes(1);
  rerender(<OutputPanel {...props} revenueDisplayTaskId="task-b" />);
  expect(send).toHaveBeenCalledTimes(2);
  cleanup();
  setPaidCoefficient("missevan", 1);
});

test("platform coefficient synchronizes results, persists and leaves the other platform unchanged", () => {
  const stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) });
  setPaidCoefficient("missevan", 1);
  setPaidCoefficient("manbo", 3);
  const makeResult = (dramaId, platform = "missevan") => {
    const result = { dramaId, title: dramaId, platform, revenueType: "season", paidUserCount: 10, price: 10, estimatedRevenueYuan: 15, rewardCoinTotal: 50, diamondValue: 500 };
    return { ...result, paidCoefficientBasis: buildPaidCoefficientBasis(result) };
  };
  render(<>
    <OutputPanel platform="missevan" revenueResults={[makeResult("甲"), makeResult("乙")]} showHistory={false} />
    <OutputPanel platform="manbo" revenueResults={[makeResult("丙", "manbo")]} showHistory={false} />
  </>);
  fireEvent.click(screen.getByRole("button", { name: "甲 付费系数：1" }));
  const slider = screen.getByRole("slider", { name: "付费系数" });
  expect(slider).toHaveAttribute("aria-orientation", "horizontal");
  expect(slider.closest("[data-slot='popover-content']")).toHaveAttribute("data-side", "top");
  fireEvent.change(slider, { target: { value: "4" } });
  fireEvent.keyUp(slider, { key: "ArrowUp" });
  expect(screen.getByRole("button", { name: "甲 付费系数：4" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "乙 付费系数：4" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "丙 付费系数：3" })).toBeInTheDocument();
  expect(screen.getAllByText("45")).toHaveLength(2);
  expect(screen.getByText("90")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("mm-toolkit-paid-coefficients"))).toEqual({ missevan: 4, manbo: 3 });
  fireEvent.keyDown(slider, { key: "Escape" });
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  cleanup();
  setPaidCoefficient("missevan", 1);
  setPaidCoefficient("manbo", 1);
});

test("episode details hide fetch metadata and cache explanations while old details remain readable", () => {
  render(<OutputPanel
    platform="missevan"
    showHistory={false}
    idResults={[{ dramaId: "100", title: "作品", selectedEpisodeCount: 2, danmaku: 4, users: 3 }]}
    episodeDetails={[
      { key: "missevan:100:1", dramaId: "100", title: "新记录", status: "success", fetchedDanmaku: 2, uniqueUsers: 2, fetchedAt: "2026-10-03T04:00:00.000Z", cached: true },
      { key: "missevan:100:2", dramaId: "100", title: "旧记录", status: "success", fetchedDanmaku: 2, uniqueUsers: 2 },
    ]}
  />);
  fireEvent.click(screen.getByRole("button", { name: /分集明细 2 集/ }));
  expect(screen.queryByText(/弹幕数据最多缓存/)).not.toBeInTheDocument();
  expect(screen.queryByText(/弹幕抓取于/)).not.toBeInTheDocument();
  const expectedTime = new Date("2026-10-03T04:00:00.000Z").toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  expect(screen.queryByText(expectedTime)).not.toBeInTheDocument();
  expect(screen.queryByText("2026-10-03T04:00:00.000Z")).not.toBeInTheDocument();
  expect(screen.queryByText(/使用缓存/)).not.toBeInTheDocument();
  expect(screen.getByText("旧记录")).toBeInTheDocument();
});

test("Manbo slider exposes the fractional final stop and hides zero official counts", () => {
  setPaidCoefficient("manbo", 1);
  const base = { dramaId: "decimal", title: "小数上限", platform: "manbo", revenueType: "episode", payCount: 76, seasonPaidUserCount: 10, episodePaidUserCountTotal: 20, paidEpisodeCount: 2, minimumEpisodePrice: 10, diamondValue: 500, estimatedRevenueYuan: 12.6, minRevenueYuan: 12.6, maxRevenueYuan: 81 };
  const zero = { ...base, dramaId: "zero", title: "无官方人数", payCount: 0 };
  render(<OutputPanel platform="manbo" showHistory={false} revenueResults={[base, zero].map((result) => ({ ...result, paidCoefficientBasis: buildPaidCoefficientBasis(result) }))} />);
  expect(screen.getAllByText("付费人数")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "小数上限 付费系数：1" }));
  const slider = screen.getByRole("slider", { name: "付费系数" });
  expect(slider).toHaveAttribute("max", "8");
  for (const value of [1, 2, 3, 4, 5, 6, 7, 8]) {
    fireEvent.change(slider, { target: { value: String(value) } });
    expect(slider).toHaveAttribute("aria-valuetext", String(Math.min(value, 7.6)));
  }
  expect(screen.getByRole("button", { name: "小数上限 付费系数：7.6" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "无官方人数 付费系数：7" })).toBeInTheDocument();
  cleanup();
  setPaidCoefficient("manbo", 1);
});

test("official and reward-only results disable the coefficient and legacy history displays one", () => {
  const result = { dramaId: "official", title: "官方人数作品", platform: "manbo", revenueType: "episode", payCount: 20, estimatedRevenueYuan: 30 };
  render(<OutputPanel platform="manbo" revenueResults={[
    { ...result, paidCoefficientBasis: buildPaidCoefficientBasis(result) },
    { ...result, dramaId: "member", title: "会员作品", revenueType: "member", paidCoefficientBasis: buildPaidCoefficientBasis({ ...result, revenueType: "member" }) },
  ]} historyEntries={[{ id: "legacy", taskType: "revenue", platform: "manbo", createdAtLabel: "旧记录", items: [{ id: "old", title: "旧作品", segments: [{ metricKey: "revenue", label: "收益预估", value: "30" }] }] }]} />);
  expect(screen.getAllByText("不可用")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /付费系数/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开" }));
  expect(screen.getByText("付费系数：1")).toBeInTheDocument();
});

const replay = {
  version: 1,
  operation: "paid_id",
  dramaIds: ["100"],
};

function renderHistory(overrides = {}) {
  const onReplayHistoryEntry = vi.fn();
  render(
    <OutputPanel
      platform="missevan"
      historyEntries={[
        {
          id: "replayable",
          platform: "missevan",
          createdAt: 2,
          createdAtLabel: "2026-09-14 10:30",
          taskType: "id",
          items: [{ id: "100", title: "当前作品", segments: [{ metricKey: "uniqueUsers", label: "去重 ID", value: "10" }] }],
          replay,
        },
        {
          id: "legacy",
          platform: "manbo",
          createdAt: 1,
          createdAtLabel: "2026-09-14 10:20",
          taskType: "play_count",
          items: [{ id: "200", title: "旧作品", segments: [{ metricKey: "playCount", label: "总播放量", value: "20" }] }],
        },
      ]}
      onReplayHistoryEntry={onReplayHistoryEntry}
      {...overrides}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "展开" }));
  return onReplayHistoryEntry;
}

test("history shows task labels and only replayable records can be rerun", () => {
  const onReplayHistoryEntry = renderHistory();

  expect(screen.getByText((_content, element) => element?.textContent === "2026-09-14 10:30 · 猫耳 · 付费ID")).toBeInTheDocument();
  expect(screen.getByText((_content, element) => element?.textContent === "2026-09-14 10:20 · 漫播 · 播放量统计")).toBeInTheDocument();
  const replayButton = screen.getByRole("button", { name: "刷新 付费ID" });
  expect(replayButton).toHaveClass("h-8", "sm:text-xs");
  fireEvent.click(replayButton);
  expect(onReplayHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({ id: "replayable" }));
  expect(screen.getByRole("button", { name: "旧记录未保存刷新参数，无法刷新" })).toBeDisabled();
});

test("preparing a replay disables all history replay actions", () => {
  renderHistory({ isReplayPreparing: true, replayPreparingEntryIds: ["replayable"] });
  expect(screen.getByRole("button", { name: "刷新 付费ID" })).toBeDisabled();
});

test("an active statistics run disables history replay actions", () => {
  renderHistory({ isRunning: true });
  expect(screen.getByRole("button", { name: "刷新 付费ID" })).toBeDisabled();
});

test("mounted history stays expanded and re-enables refresh after completion, failure, or cancellation", () => {
  const { rerender } = render(
    <OutputPanel platform="missevan" historyEntries={[{ id: "replayable", platform: "missevan", createdAt: 2, createdAtLabel: "now", taskType: "id", items: [], replay }]} isRunning historyActionsDisabled />
  );
  fireEvent.click(screen.getByRole("button", { name: "展开" }));
  expect(screen.getByRole("button", { name: "刷新 付费ID" })).toBeDisabled();
  ["completed", "failed", "cancelled"].forEach((status) => {
    rerender(<OutputPanel platform="missevan" historyEntries={[{ id: "replayable", platform: "missevan", createdAt: 2, createdAtLabel: status, taskType: "id", items: [], replay }]} />);
    expect(screen.getByRole("button", { name: "刷新 付费ID" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "展开" })).not.toBeInTheDocument();
  });
});
