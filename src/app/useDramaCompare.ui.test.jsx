import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { MAX_COMPARE_ITEMS } from "@/app/dramaCompareUtils";
import { useDramaCompare } from "@/app/useDramaCompare";

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

function drama(id, compareKind = "drama") {
  return {
    compareKind,
    id: String(id),
    platform: "missevan",
    title: `作品 ${id}`,
  };
}

function CompareHarness() {
  const comparison = useDramaCompare();
  const [probe, setProbe] = useState("");

  return (
    <div>
      <output data-testid="count">{comparison.compareItems.length}</output>
      <output data-testid="probe">{probe}</output>
      <button
        type="button"
        onClick={() => {
          comparison.addDramaToCompareBasket(drama(1));
          comparison.addDramaToCompareBasket(drama(1));
          setProbe(String(comparison.canAddDramaToCompareBasket(drama(1))));
        }}
      >
        同步重复添加
      </button>
      {Array.from({ length: MAX_COMPARE_ITEMS + 1 }, (_, index) => (
        <button
          key={index + 1}
          type="button"
          onClick={() => comparison.addDramaToCompareBasket(drama(index + 1))}
        >
          添加普通 {index + 1}
        </button>
      ))}
      <button type="button" onClick={() => comparison.addDramaToCompareBasket(drama("peak", "peak_series"))}>
        添加巅峰系列
      </button>
      <button type="button" onClick={() => comparison.clearCompareBasket()}>
        清空
      </button>
      <button
        type="button"
        onClick={() => {
          comparison.removeDramaFromCompareBasket("drama:missevan:1");
          setProbe(String(comparison.canAddDramaToCompareBasket(drama(1))));
        }}
      >
        移除第一部并检查
      </button>
      <button
        type="button"
        onClick={() => {
          comparison.clearCompareBasket();
          setProbe(String(comparison.canAddDramaToCompareBasket(drama(7))));
        }}
      >
        清空并检查
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

test("StrictMode adds a drama once and observes same-act duplicates synchronously", () => {
  render(
    <StrictMode>
      <CompareHarness />
    </StrictMode>
  );

  fireEvent.click(screen.getByRole("button", { name: "同步重复添加" }));

  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(screen.getByTestId("probe")).toHaveTextContent("false");
  expect(toastMocks.success).toHaveBeenCalledTimes(1);
  expect(toastMocks.info).toHaveBeenCalledWith("已在对比中。");
});

test("compare constraints and remove or clear actions use the synchronous item mirror", () => {
  render(<CompareHarness />);

  fireEvent.click(screen.getByRole("button", { name: "添加普通 1" }));
  fireEvent.click(screen.getByRole("button", { name: "添加巅峰系列" }));
  expect(toastMocks.warning).toHaveBeenCalledWith("巅峰榜系列只能和其他巅峰榜系列对比。");

  fireEvent.click(screen.getByRole("button", { name: "清空" }));
  fireEvent.click(screen.getByRole("button", { name: "添加巅峰系列" }));
  fireEvent.click(screen.getByRole("button", { name: "添加普通 1" }));
  expect(toastMocks.warning).toHaveBeenCalledWith("普通剧集不能和巅峰榜系列混合对比。");

  fireEvent.click(screen.getByRole("button", { name: "清空" }));
  for (let index = 1; index <= MAX_COMPARE_ITEMS; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: `添加普通 ${index}` }));
  }
  fireEvent.click(screen.getByRole("button", { name: `添加普通 ${MAX_COMPARE_ITEMS + 1}` }));
  expect(screen.getByTestId("count")).toHaveTextContent(String(MAX_COMPARE_ITEMS));
  expect(toastMocks.warning).toHaveBeenCalledWith(`对比最多添加 ${MAX_COMPARE_ITEMS} 部剧集。`);

  fireEvent.click(screen.getByRole("button", { name: "移除第一部并检查" }));
  expect(screen.getByTestId("count")).toHaveTextContent(String(MAX_COMPARE_ITEMS - 1));
  expect(screen.getByTestId("probe")).toHaveTextContent("true");

  fireEvent.click(screen.getByRole("button", { name: "清空并检查" }));
  expect(screen.getByTestId("count")).toHaveTextContent("0");
  expect(screen.getByTestId("probe")).toHaveTextContent("true");
});
