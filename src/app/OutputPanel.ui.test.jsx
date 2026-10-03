import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { OutputPanel } from "@/app/OutputPanel";

afterEach(cleanup);

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
