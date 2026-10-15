import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DramaMetricsPreview } from "@/app/DramaMetricsPreview";
import { StrictMode } from "react";

const response = (body, ok = true) => ({ ok, headers: { get: () => "1.8.5" }, json: async () => body });
const metricsResponse = (extra = {}) => response({ success: true, metrics: { view_count: 128640000, subscription_num: 86200, reward_num: 13400, diamond_value: 76543210, pay_count: 0, member_listen_count: 0 }, ...extra });
let metricsRequest;
let fetchMock;
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function Preview(props) {
  return <DramaMetricsPreview platform="missevan" id="123" name="测试作品" source="ranks" frontendVersion="1.8.5" onEnterStatistics={async () => true} {...props}><button type="button">作品标题</button></DramaMetricsPreview>;
}
const metricCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/search-card-metrics"));
const usageActions = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/usage-log")).map(([, options]) => JSON.parse(options.body));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  metricsRequest = vi.fn(async () => metricsResponse());
  fetchMock = vi.fn((url, options) => String(url).includes("/search-card-metrics") ? metricsRequest(options) : Promise.resolve(response({ success: true })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("opening fetches fresh complete numbers without navigating or showing stale item values", async () => {
  const user = userEvent.setup();
  const enter = vi.fn(async () => true);
  const version = vi.fn();
  render(<Preview item={{ view_count: 999 }} onEnterStatistics={enter} handleVersionResponse={version} />);
  expect(metricCalls()).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "作品标题" }));
  const dialog = screen.getByRole("dialog", { name: "测试作品" });
  expect(await within(dialog).findByText("128640000")).toBeVisible();
  expect(within(dialog).queryByText("999")).not.toBeInTheDocument();
  expect(within(dialog).queryByText(/万|亿/)).not.toBeInTheDocument();
  expect(metricCalls()).toHaveLength(1);
  expect(JSON.parse(metricCalls()[0][1].body)).toEqual({ platform: "missevan", id: "123" });
  expect(metricCalls()[0][1].cache).toBe("no-store");
  expect(enter).not.toHaveBeenCalled();
  expect(version).toHaveBeenCalledWith(expect.objectContaining({ backendVersion: "1.8.5" }));
  expect(within(dialog).getByText(/^数据获取于：\d{2}:\d{2}:\d{2}$/)).toBeVisible();
  expect(within(dialog).queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
  expect(usageActions()).toEqual([expect.objectContaining({ action: "drama_preview_open", platform: "missevan", dramaId: "123", source: "ranks" })]);
});

test.each([
  [{ revenue_type: "drama" }, "付费人数", "收听人数"],
  [{ is_member: true }, "收听人数", "付费人数"],
])("Manbo uses response type information and places nonzero audience counts after diamond totals: %j", async (cardPatch, present, absent) => {
  metricsRequest.mockResolvedValue(metricsResponse({ card_patch: cardPatch, metrics: { view_count: 128640000, subscription_num: 86200, diamond_value: 76543210, pay_count: 789, member_listen_count: 789 } }));
  render(<Preview platform="manbo" item={{ revenue_type: "episode" }} />);
  await userEvent.click(screen.getByRole("button", { name: "作品标题" }));
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByText(present)).toBeVisible();
  expect(within(dialog).queryByText(absent)).not.toBeInTheDocument();
  expect(within(dialog).getByText("789")).toBeVisible();
  expect(within(dialog).getAllByRole("term").map((node) => node.textContent)).toEqual(["总播放量", "收藏数", "投喂总数", present]);
});

test.each([
  [{ revenue_type: "drama" }, "付费人数", "pay_count"],
  [{ is_member: true }, "收听人数", "member_listen_count"],
])("Manbo hides zero %s audience counts but keeps missing values visible as failures", async (cardPatch, label, field) => {
  metricsRequest.mockResolvedValueOnce(metricsResponse({ card_patch: cardPatch }));
  const user = userEvent.setup();
  render(<Preview platform="manbo" />);
  const trigger = screen.getByRole("button", { name: "作品标题" });
  await user.click(trigger);
  await screen.findByText("128640000");
  expect(screen.queryByText(label)).not.toBeInTheDocument();
  expect(screen.getAllByRole("term")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "关闭数据速览" }));
  metricsRequest.mockResolvedValueOnce(metricsResponse({ card_patch: cardPatch, metrics: { view_count: 128640000, subscription_num: 86200, diamond_value: 76543210, [field]: null } }));
  await user.click(trigger);
  await screen.findByText("128640000");
  expect(screen.getByText(label)).toBeVisible();
  expect(screen.getByText("获取失败")).toBeVisible();
});

test("episode-priced Manbo has three metrics and missing values do not become zero", async () => {
  metricsRequest.mockResolvedValue(metricsResponse({ card_patch: { revenue_type: "episode" }, metrics: { view_count: 128640000, subscription_num: null, diamond_value: 0 } }));
  render(<Preview platform="manbo" />);
  await userEvent.click(screen.getByRole("button", { name: "作品标题" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByText("128640000");
  expect(within(dialog).getAllByRole("term")).toHaveLength(3);
  expect(within(dialog).getByText("获取失败")).toBeVisible();
  expect(within(dialog).getByText("0")).toBeVisible();
});

test("metric layout measures both text and numbers and shares unequal column minima across rows", async () => {
  let availableWidth = 500;
  let resizeGrid;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function () {
    return this.hasAttribute("data-preview-metrics") ? availableWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function () {
    if (this.hasAttribute("data-preview-label")) return this.textContent.length * 12;
    if (this.hasAttribute("data-preview-number")) return this.textContent.length * 8;
    return 0;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.callback = callback; }
    observe(node) { if (node.hasAttribute("data-preview-metrics")) resizeGrid = this.callback; }
    unobserve() {}
    disconnect() {}
  });
  metricsRequest.mockResolvedValue(metricsResponse({ metrics: { view_count: 1234567890123456, subscription_num: 86200, diamond_value: 123456789012345680, pay_count: 789 }, card_patch: { revenue_type: "drama" } }));
  render(<Preview platform="manbo" />);
  await userEvent.click(screen.getByRole("button", { name: "作品标题" }));
  await screen.findByText("1234567890123456");
  const grid = screen.getByRole("dialog").querySelector("[data-preview-metrics]");
  expect(grid).toHaveAttribute("data-columns", "4");
  availableWidth = 225;
  act(() => resizeGrid());
  expect(grid).toHaveAttribute("data-columns", "2");
  expect(grid.style.gridTemplateColumns).toBe("minmax(144px, 1fr) minmax(48px, 1fr)");
  availableWidth = 200;
  act(() => resizeGrid());
  expect(grid).toHaveAttribute("data-columns", "1");
});

test("reopening fetches new data and there is no manual refresh action", async () => {
  const user = userEvent.setup();
  render(<Preview />);
  await user.click(screen.getByRole("button", { name: "作品标题" }));
  await screen.findByText("128640000");
  expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "关闭数据速览" }));
  metricsRequest.mockResolvedValueOnce(metricsResponse({ metrics: { view_count: 777, subscription_num: 5, reward_num: 2 } }));
  await user.click(screen.getByRole("button", { name: "作品标题" }));
  expect(await screen.findByText("777")).toBeVisible();
  expect(screen.queryByText("128640000")).not.toBeInTheDocument();
  expect(metricCalls()).toHaveLength(2);
  expect(usageActions().map((entry) => entry.action)).toEqual(["drama_preview_open", "drama_preview_open"]);
});

test.each(["ACCESS_DENIED", "METRICS_RATE_LIMITED", "METRICS_TIMEOUT"])("initial %s failure stays local and permits entering statistics", async (code) => {
  metricsRequest.mockResolvedValue(response({ success: false, code, message: "暂时不可用，请稍后重试。" }, false));
  render(<Preview />);
  await userEvent.click(screen.getByRole("button", { name: "作品标题" }));
  expect(await screen.findByText("数据获取失败")).toBeVisible();
  expect(screen.getAllByText("获取失败")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "进入统计" })).toBeEnabled();
  expect(metricCalls()).toHaveLength(1);
});

test("closing aborts requests, restores focus, and reopening rejects late responses", async () => {
  const user = userEvent.setup();
  const old = deferred();
  metricsRequest.mockImplementationOnce(() => old.promise);
  render(<Preview />);
  const trigger = screen.getByRole("button", { name: "作品标题" });
  await user.click(trigger);
  const signal = metricCalls()[0][1].signal;
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(signal.aborted).toBe(true);
  expect(trigger).toHaveFocus();
  const current = deferred();
  metricsRequest.mockImplementationOnce(() => current.promise);
  await user.click(trigger);
  expect(screen.getByText("正在获取数据")).toBeVisible();
  await act(async () => old.resolve(metricsResponse({ metrics: { view_count: 111 } })));
  expect(screen.queryByText("111")).not.toBeInTheDocument();
  await act(async () => current.resolve(metricsResponse()));
  expect(await screen.findByText("128640000")).toBeVisible();
});

test("changing the work aborts its request and clears previous values", async () => {
  const user = userEvent.setup();
  const old = deferred();
  metricsRequest.mockImplementationOnce(() => old.promise);
  const view = render(<Preview />);
  await user.click(screen.getByRole("button", { name: "作品标题" }));
  const signal = metricCalls()[0][1].signal;
  view.rerender(<Preview id="456" name="另一部作品" />);
  expect(await screen.findByText("128640000")).toBeVisible();
  expect(signal.aborted).toBe(true);
  expect(JSON.parse(metricCalls()[1][1].body).id).toBe("456");
  await act(async () => old.resolve(metricsResponse({ metrics: { view_count: 111 } })));
  expect(screen.queryByText("111")).not.toBeInTheDocument();
});

test("entering statistics locks double clicks and only closes after navigation succeeds", async () => {
  const user = userEvent.setup();
  const navigation = deferred();
  const enter = vi.fn(() => navigation.promise);
  render(<Preview onEnterStatistics={enter} />);
  await user.click(screen.getByRole("button", { name: "作品标题" }));
  await user.dblClick(screen.getByRole("button", { name: "进入统计" }));
  expect(enter).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "正在进入" })).toBeDisabled();
  await act(async () => navigation.resolve(false));
  expect(screen.getByRole("dialog")).toBeVisible();
  enter.mockResolvedValueOnce(true);
  await user.click(screen.getByRole("button", { name: "进入统计" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("mobile uses an accessible bottom sheet and restores title focus", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  const user = userEvent.setup();
  render(<Preview />);
  const trigger = screen.getByRole("button", { name: "作品标题" });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "测试作品" })).toHaveAttribute("data-slot", "sheet-content");
  expect(await screen.findByText("128640000")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "关闭数据速览" }));
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("StrictMode does not double-count preview opens", async () => {
  render(<StrictMode><Preview /></StrictMode>);
  await userEvent.click(screen.getByRole("button", { name: "作品标题" }));
  await screen.findByText("128640000");
  expect(usageActions().filter((entry) => entry.action === "drama_preview_open")).toHaveLength(1);
});

test("clicking outside a desktop preview restores title focus", async () => {
  const user = userEvent.setup();
  render(<><Preview /><button type="button">其他操作</button></>);
  const trigger = screen.getByRole("button", { name: "作品标题" });
  await user.click(trigger);
  await screen.findByText("128640000");
  await user.click(screen.getByRole("button", { name: "其他操作" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});
