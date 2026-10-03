import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useFavoriteRefresh } from "@/app/useFavoriteRefresh";
import { refreshFavoriteSnapshot } from "@/app/favoritesRefreshService";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/favoritesStorage", () => ({ getFavoriteByKey: vi.fn(), saveSnapshot: vi.fn() }));
vi.mock("@/app/favoritesRefreshService", () => ({
  refreshFavoriteSnapshot: vi.fn(),
  getFavoriteBatchProgress: (index, total, progress) => (index * 100 + progress) / total,
  isFavoriteAccessDeniedError: () => false,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

test.each([false, true])("cancelled batch synchronizes saved results and releases the queue (reload fails: %s)", async (reloadFails) => {
  const saved = [];
  const visible = [];
  const order = [];
  const onReloadSnapshots = vi.fn(async () => {
    order.push("snapshots");
    if (reloadFails) throw new Error("reload failed");
    visible.push(...saved);
  });
  const onFavoritesChange = vi.fn(async () => { order.push("favorites"); });
  const onRefreshSettled = vi.fn(async () => { order.push("settled"); });
  const onRefreshStateChange = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  refreshFavoriteSnapshot.mockImplementationOnce(async () => {
    const snapshot = { status: "success", metrics: { viewCount: 123 } };
    saved.push(snapshot);
    return { snapshot };
  }).mockImplementationOnce(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { cancelConfirmed: true })), { once: true });
  }));
  const { result } = renderHook(() => useFavoriteRefresh({
    onBackgroundTaskChange: vi.fn(), onRefreshStateChange,
    onReloadSnapshots, onFavoritesChange, onRefreshSettled,
  }));
  let pending;
  act(() => { pending = result.current.refreshMany([{ key: "first" }, { key: "second" }]); });
  await waitFor(() => expect(refreshFavoriteSnapshot).toHaveBeenCalledTimes(2));
  await act(async () => {
    result.current.cancelRefresh();
    await pending;
  });
  expect(order).toEqual(["snapshots", "favorites", "settled"]);
  if (!reloadFails) expect(visible).toEqual(saved);
  expect(onRefreshStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ isRunning: false }));

  refreshFavoriteSnapshot.mockResolvedValue({ snapshot: { status: "success" } });
  await act(async () => { await result.current.refreshMany([{ key: "third" }]); });
  expect(refreshFavoriteSnapshot).toHaveBeenCalledTimes(3);
});
