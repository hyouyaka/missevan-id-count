import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SearchPanel } from "@/app/SearchPanel";

const candidates = [
  { key: "missevan:1", type: "drama", name: "魔道祖师", platform: "missevan", id: "1", contentTypeLabel: "广播剧", cover: "https://example.com/cover.jpg", mainCvNames: ["张福正", "孙睿扬"] },
  { key: "manbo:2", type: "drama", name: "魔道祖师", platform: "manbo", id: "2", contentTypeLabel: "有声剧" },
  { key: "cv:1", type: "cv", name: "路知行", profileId: "mapped:1", avatar: "https://example.com/avatar.jpg" },
];
const response = (data, ok = true) => ({ ok, headers: { get: () => null }, json: async () => data });
function Harness(props) {
  const [formState, update] = useState({ keyword: "" });
  return <SearchPanel frontendVersion="1.8.5" {...props} formState={formState} onUpdateFormState={(patch) => update((current) => ({ ...current, ...patch }))} />;
}
async function advance(ms = 250) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function input() { return screen.getByRole("combobox"); }
async function type(keyword = "魔") {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: keyword } });
  await advance();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("/search-suggestions")
    ? response({ suggestions: candidates })
    : response({ results: { missevan: { success: true, results: [{ id: 1 }], meta: { matchedCount: 1 } } } })));
  vi.stubGlobal("requestAnimationFrame", (callback) => setTimeout(callback, 0));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("debounces single Han input, shows labeled choices, and starts with no selection", async () => {
  render(<Harness />);
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: "魔" } });
  await advance(249);
  expect(fetch).not.toHaveBeenCalled();
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.getByRole("option", { name: "魔道祖师，猫耳，广播剧" })).toBeVisible();
  expect(screen.getByRole("option", { name: "魔道祖师，漫播，有声剧" })).toBeVisible();
  expect(input()).toHaveAttribute("aria-expanded", "true");
  expect(input()).not.toHaveAttribute("aria-activedescendant");
  expect(screen.getByAltText("魔道祖师封面")).toHaveAttribute("src", "/image-proxy?url=https%3A%2F%2Fexample.com%2Fcover.jpg");
  expect(screen.getByAltText("路知行头像")).toHaveAttribute("src", "/image-proxy?url=https%3A%2F%2Fexample.com%2Favatar.jpg");
  expect(screen.getByText("张福正，孙睿扬")).toBeVisible();
  fireEvent.error(screen.getByAltText("魔道祖师封面"));
  expect(screen.queryByAltText("魔道祖师封面")).toBeNull();
  expect(screen.getByRole("option", { name: "魔道祖师，猫耳，广播剧" })).toBeVisible();
});

test("arrow keys clamp at boundaries and Enter fills a name without opening or searching", async () => {
  const onOpenSearchResult = vi.fn();
  render(<Harness onOpenSearchResult={onOpenSearchResult} />);
  await type();
  fireEvent.keyDown(input(), { key: "ArrowUp" });
  expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input(), { key: "ArrowUp" });
  fireEvent.keyDown(input(), { key: "ArrowUp" });
  fireEvent.keyDown(input(), { key: "ArrowUp" });
  expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(input()).toHaveValue("魔道祖师");
  expect(screen.queryByRole("listbox")).toBeNull();
  await advance(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onOpenSearchResult).not.toHaveBeenCalled();
  fireEvent.submit(input().closest("form"));
  await advance(1);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/unified-search?keyword="))).toBe(true);
});

test("Enter without a selected candidate submits normally; search button ignores selected candidate", async () => {
  render(<Harness />);
  await type("魔道");
  fireEvent.submit(input().closest("form"));
  await advance(1);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/unified-search"))).toBe(true);
  await type("天官");
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("button", { name: "搜索", exact: true }));
  await advance(1);
  expect(fetch.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("/unified-search?keyword=天官"))).toBe(true);
});

test("click opens a unique drama card and prevents concurrent duplicate opens", async () => {
  let finish;
  const onOpenSearchResult = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  render(<Harness onOpenSearchResult={onOpenSearchResult} />);
  act(() => input().focus());
  await type();
  expect(input()).toHaveFocus();
  fireEvent.click(screen.getAllByRole("option")[1]);
  expect(input()).not.toHaveFocus();
  expect(input()).toHaveValue("");
  expect(onOpenSearchResult).toHaveBeenCalledWith({
    platform: "manbo", id: "2", name: "魔道祖师", contentTypeLabel: "有声剧",
    usageAction: "search_suggestion_open_search_result", usageSource: "search_suggestion",
  });
  expect(screen.queryByRole("listbox")).toBeNull();
  await type("路");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onOpenSearchResult).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

test("CV click preserves authoritative profile identity", async () => {
  const onOpenCv = vi.fn();
  render(<Harness onOpenCv={onOpenCv} />);
  act(() => input().focus());
  await type("路");
  expect(input()).toHaveFocus();
  fireEvent.click(screen.getByRole("option", { name: "路知行，CV" }));
  expect(input()).not.toHaveFocus();
  expect(input()).toHaveValue("");
  expect(onOpenCv).toHaveBeenCalledWith("路知行", { source: "search_suggestion", profileId: "mapped:1" });
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("composition suppresses requests and confirmation Enter; finishing restarts debounce", async () => {
  render(<Harness />);
  fireEvent.focus(input());
  fireEvent.compositionStart(input());
  fireEvent.change(input(), { target: { value: "魔" } });
  await advance(500);
  expect(fetch).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input(), { key: "Enter", isComposing: true })).toBe(false);
  fireEvent.submit(input().closest("form"));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input());
  expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(false);
  await advance(249);
  expect(fetch).not.toHaveBeenCalled();
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("imports, links, compound expressions and one letter never request suggestions", async () => {
  render(<Harness />);
  for (const keyword of ["a", "123", "1467142227078676553", "https://www.missevan.com/mdrama/123", "魔道 天官", "魔道，天官", "分享：魔道"]) {
    await type(keyword);
  }
  expect(fetch).not.toHaveBeenCalled();
  await type("lu");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("old responses cannot overwrite edited input or reopen a closed list", async () => {
  const pending = [];
  fetch.mockImplementation((url, options) => new Promise((resolve) => pending.push({ resolve, options })));
  render(<Harness />);
  await type("魔");
  await type("路");
  expect(pending[0].options.signal.aborted).toBe(true);
  await act(async () => pending[1].resolve(response({ suggestions: [candidates[2]] })));
  expect(screen.getByRole("option", { name: "路知行，CV" })).toBeVisible();
  await act(async () => pending[0].resolve(response({ suggestions: [candidates[0]] })));
  expect(screen.queryByRole("option", { name: "魔道祖师，猫耳，广播剧" })).toBeNull();
  await type("魔道");
  fireEvent.keyDown(input(), { key: "Escape" });
  expect(pending[2].options.signal.aborted).toBe(true);
  await act(async () => pending[2].resolve(response({ suggestions: candidates })));
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("clear, outside pointer and help close suggestions; refocus allows a new lookup", async () => {
  render(<Harness />);
  await type();
  fireEvent.click(screen.getByRole("button", { name: "清空输入" }));
  expect(input()).toHaveValue("");
  expect(screen.queryByRole("listbox")).toBeNull();
  await type();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.focus(input());
  await advance();
  expect(screen.getByRole("listbox")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "搜索语法说明" }));
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("timeout, no matches and errors silently hide suggestions; unmount aborts in-flight request", async () => {
  fetch.mockImplementation(() => new Promise(() => {}));
  const rendered = render(<Harness />);
  await type();
  const signal = fetch.mock.calls[0][1].signal;
  await advance(3000);
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole("listbox")).toBeNull();
  fetch.mockResolvedValue(response({ suggestions: [] }));
  await type("无");
  expect(screen.queryByRole("listbox")).toBeNull();
  fetch.mockResolvedValue(response({}, false));
  await type("错");
  expect(screen.queryByRole("listbox")).toBeNull();
  fetch.mockImplementation(() => new Promise(() => {}));
  await type("路");
  const lastSignal = fetch.mock.calls.at(-1)[1].signal;
  rendered.unmount();
  expect(lastSignal.aborted).toBe(true);
});

test("desktop has no suggestion UI or requests; external navigation cancels web requests", async () => {
  const desktop = render(<Harness isDesktopApp />);
  const desktopInput = screen.getByRole("textbox");
  fireEvent.focus(desktopInput);
  fireEvent.change(desktopInput, { target: { value: "魔道" } });
  await advance(500);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox")).toBeNull();
  desktop.unmount();
  fetch.mockImplementation(() => new Promise(() => {}));
  const web = render(<Harness />);
  await type();
  const signal = fetch.mock.calls[0][1].signal;
  web.rerender(<Harness suggestionsDisabled />);
  expect(signal.aborted).toBe(true);
  web.rerender(<Harness />);
  await advance(500);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
});
