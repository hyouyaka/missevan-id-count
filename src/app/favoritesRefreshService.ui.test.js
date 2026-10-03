import { afterEach, expect, test, vi } from "vitest";
import { refreshFavoriteSnapshot } from "@/app/favoritesRefreshService";
import { saveSnapshot, updateFavoriteIfExists } from "@/app/favoritesStorage";

vi.mock("@/app/favoritesStorage", () => ({
  saveSnapshot: vi.fn(),
  updateFavoriteIfExists: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test.each(["creation", "wait", "poll"])("cancelling during %s sends a server cancellation without mutating DOMException", async (phase) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let pollingSignal;
  const response = (data) => ({ ok: true, headers: { get: () => null }, json: async () => data });
  const fetchMock = vi.fn(async (url, options) => {
    const pathname = String(url).split("?")[0];
    if (pathname === "/getdramas") {
      return response({ items: [{ success: true, info: { drama: { id: 42, name: "作品" }, episodes: { episode: [] } } }] });
    }
    if (pathname === "/stat-tasks") {
      if (phase === "creation") controller.abort();
      return response({ taskId: "favorite-task", status: "running", progress: 0 });
    }
    if (pathname === "/stat-tasks/favorite-task/cancel") {
      return response({ taskId: "favorite-task", status: "cancelled" });
    }
    if (pathname === "/stat-tasks/favorite-task") {
      pollingSignal = options.signal;
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("fetch aborted", "AbortError")), { once: true });
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  // Attach the handler before triggering cancellation to avoid an unhandled rejection.
  const settled = refreshFavoriteSnapshot({
    favorite: { key: "missevan:42", platform: "missevan", dramaId: 42, mainCvText: "甲、乙、丙" },
    frontendVersion: "1.8.5",
    signal: controller.signal,
    onProgress: (snapshot) => {
      if (phase === "wait" && snapshot.currentAction === "统计中") {
        queueMicrotask(() => controller.abort());
      }
    },
  }).catch((error) => error);
  await vi.advanceTimersByTimeAsync(phase === "poll" ? 1200 : 0);
  if (phase === "poll") {
    expect(pollingSignal).toBeDefined();
    controller.abort();
  }
  const error = await settled;
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: "AbortError",
    message: "收藏刷新已停止；服务器任务取消状态未知。",
    serverCancelAttempted: true,
    cancelConfirmed: false,
  });
  expect(error.cause).toBeInstanceOf(DOMException);
  expect(error.cause.name).toBe("AbortError");
  const cancels = fetchMock.mock.calls.filter(([url]) => String(url).includes("/cancel"));
  expect(cancels).toHaveLength(1);
  expect(cancels[0][1].method).toBe("POST");
  expect(cancels[0][1].signal).not.toBe(controller.signal);
  expect(saveSnapshot).not.toHaveBeenCalled();
  expect(updateFavoriteIfExists).not.toHaveBeenCalled();
});
