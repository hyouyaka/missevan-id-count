import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { FeedbackView } from "@/app/FeedbackView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderFeedback() {
  return render(<FeedbackView feedbackEnabled={true} frontendVersion="1.7.6" />);
}

function renderDisabledFeedback() {
  return render(<FeedbackView feedbackEnabled={false} frontendVersion="1.7.6" />);
}

test("feedback introduction links to the MMToolkit Xiaohongshu account", () => {
  renderFeedback();

  expect(screen.getByText("请填写表格提交反馈，也可私信小红书账号", { exact: false })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "MMToolkit" })).toHaveAttribute(
    "href",
    "https://xhslink.cn/o/9hUXfAAAP8I"
  );
});

test("explanations share a card above the feedback form without nested cards", () => {
  renderFeedback();

  const statisticsTitle = screen.getByText("统计说明");
  const statisticsHeader = statisticsTitle.closest('[data-slot="card-header"]');
  expect(statisticsTitle).toBeInTheDocument();
  expect(statisticsHeader).toBeInTheDocument();
  expect(statisticsHeader.querySelector("svg")).toHaveClass("size-5");
  const explanationCard = screen.getByRole("button", { name: "收益预估计算说明" })
    .closest('[data-slot="card"]');
  const feedbackCard = screen.getByText("建议反馈").closest('[data-slot="card"]');
  const form = screen.getByRole("button", { name: "提交反馈" }).closest("form");

  expect(explanationCard).toBeInTheDocument();
  expect(feedbackCard).toBeInTheDocument();
  expect(explanationCard).not.toBe(feedbackCard);
  expect(explanationCard.compareDocumentPosition(feedbackCard)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(form.closest('[data-slot="card"]')).toBe(feedbackCard);
  expect(form.querySelector('[data-slot="card"]')).not.toBeInTheDocument();
  expect(screen.queryByText("匿名反馈", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("无需填写联系方式，反馈将匿名发送。", { exact: true })).not.toBeInTheDocument();
});

test("disabled feedback keeps explanations available without exposing the form", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true });
  renderDisabledFeedback();

  expect(screen.getByText("反馈暂未启用", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("如需交流，可私信小红书账号", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText("当前站点反馈服务暂未启用", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "MMToolkit" })).toHaveAttribute(
    "href",
    "https://xhslink.cn/o/9hUXfAAAP8I"
  );
  expect(screen.queryByLabelText("类型")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("反馈内容")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "提交反馈" })).not.toBeInTheDocument();
  expect(screen.queryByText("请填写表格提交反馈", { exact: false })).not.toBeInTheDocument();

  const trigger = screen.getByRole("button", { name: "收益预估计算说明" });
  await user.click(trigger);

  expect(screen.getByRole("heading", { name: /基础规则$/ })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/usage-log?frontendVersion=1.7.6",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        action: "feedback_explanation_open",
        section: "revenue_calculation",
        success: true,
      }),
      keepalive: true,
    })
  );
});

test("feedback form exposes the four supported types and an anonymous honeypot", () => {
  renderFeedback();

  expect(screen.getByRole("option", { name: "Bug" })).toHaveValue("bug");
  expect(screen.getByRole("option", { name: "数据异常" })).toHaveValue("data");
  expect(screen.getByRole("option", { name: "功能建议" })).toHaveValue("feature");
  expect(screen.getByRole("option", { name: "其他" })).toHaveValue("other");
  expect(screen.getByLabelText("类型")).toHaveClass("w-fit", "min-w-[7rem]", "max-w-full");
  const honeypot = document.querySelector('input[name="website"]');
  expect(honeypot).toHaveAttribute("tabindex", "-1");
  expect(honeypot).toHaveAttribute("autocomplete", "off");
});

test.each([
  ["empty", ""],
  ["too short", "1234"],
  ["too long", "x".repeat(3001)],
])("%s feedback cannot be submitted", async (_label, value) => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  renderFeedback();

  fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value } });
  await user.click(screen.getByRole("button", { name: "提交反馈" }));

  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText("请检查反馈内容后重试。", { exact: true })).toBeInTheDocument();
});

test("valid feedback POSTs only the anonymous feedback payload", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });
  const user = userEvent.setup();
  renderFeedback();

  await user.selectOptions(screen.getByLabelText("类型"), "data");
  await user.type(screen.getByLabelText("反馈内容"), "数据统计结果与页面显示不一致");
  await user.click(screen.getByRole("button", { name: "提交反馈" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith(
    "/feedback",
    expect.objectContaining({
      method: "POST",
      credentials: "omit",
      body: JSON.stringify({
        type: "data",
        message: "数据统计结果与页面显示不一致",
        website: "",
        frontendVersion: "1.7.6",
      }),
    })
  );
  const [, request] = fetchMock.mock.calls[0];
  expect(request.body).not.toMatch(/email|nickname|name|ip|user-agent|cookie/i);
});

test("five-character feedback meets the minimum length", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });
  const user = userEvent.setup();
  renderFeedback();

  expect(screen.getByText("内容长度为 5～3000 个字符。")).toBeInTheDocument();
  await user.type(screen.getByLabelText("反馈内容"), "12345");
  await user.click(screen.getByRole("button", { name: "提交反馈" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).message).toBe("12345");
});

test("submit button is disabled while feedback request is pending", async () => {
  let resolveRequest;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise((resolve) => {
      resolveRequest = resolve;
    })
  );
  const user = userEvent.setup();
  renderFeedback();
  await user.type(screen.getByLabelText("反馈内容"), "这是一个足够长的测试反馈内容");
  await user.click(screen.getByRole("button", { name: "提交反馈" }));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "正在提交…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "正在提交…" }).parentElement).toHaveClass("flex", "justify-end");
  resolveRequest({ ok: true, status: 200 });
  await waitFor(() => expect(screen.getByRole("button", { name: "提交反馈" })).not.toBeDisabled());
});

test("successful feedback clears the message and restores Bug", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });
  const user = userEvent.setup();
  renderFeedback();
  await user.selectOptions(screen.getByLabelText("类型"), "feature");
  const textarea = screen.getByLabelText("反馈内容");
  await user.type(textarea, "希望增加按作者筛选的功能");
  await user.click(screen.getByRole("button", { name: "提交反馈" }));

  await waitFor(() => {
    expect(textarea).toHaveValue("");
    expect(screen.getByLabelText("类型")).toHaveValue("bug");
  });
});

test.each([
  [429, "提交过于频繁，请稍后再试。"],
  [500, "反馈暂时无法发送，请稍后再试。"],
])("server status %s shows a safe feedback error", async (status, message) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status });
  const user = userEvent.setup();
  renderFeedback();
  await user.type(screen.getByLabelText("反馈内容"), "这是一个足够长的测试反馈内容");
  await user.click(screen.getByRole("button", { name: "提交反馈" }));

  expect(await screen.findByText(message, { exact: true })).toBeInTheDocument();
});

test("revenue calculation accordion is collapsed by default and toggles the full markdown", async () => {
  const user = userEvent.setup();
  renderFeedback();

  const trigger = screen.getByRole("button", { name: "收益预估计算说明" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: /基础规则$/ })).not.toBeInTheDocument();

  await user.click(trigger);

  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("heading", { name: /基础规则$/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /猫耳 FM$/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /漫播$/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /汇总规则$/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /附注$/ })).toBeInTheDocument();
  expect(screen.getByText("10 钻石 = 1 元")).toBeInTheDocument();
  expect(screen.getByText("100 红豆 = 1 元")).toBeInTheDocument();
  expect(screen.getAllByRole("note")).toHaveLength(2);

  await user.click(trigger);

  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: /基础规则$/ })).not.toBeInTheDocument();
});

test("danmaku overflow accordion is collapsed by default and toggles the full markdown", async () => {
  const user = userEvent.setup();
  renderFeedback();

  const trigger = screen.getByRole("button", { name: "弹幕溢出判断说明" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("目前对于弹幕溢出的判断标准：", { selector: "strong" })).not.toBeInTheDocument();
  expect(screen.queryByText("奇洛李维斯回信")).not.toBeInTheDocument();

  await user.click(trigger);

  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("目前对于弹幕溢出的判断标准：", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "1. 漫播" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "2. 猫耳" })).toBeInTheDocument();
  expect(screen.getAllByText("奇洛李维斯回信").length).toBeGreaterThan(0);
  expect(screen.getByText("≤1 分钟")).toBeInTheDocument();

  await user.click(trigger);

  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: "1. 漫播" })).not.toBeInTheDocument();
});

test("opening each explanation accordion writes one usage log and collapsing does not", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true });
  renderFeedback();

  const revenueTrigger = screen.getByRole("button", { name: "收益预估计算说明" });
  await user.click(revenueTrigger);
  await user.click(revenueTrigger);
  await user.click(screen.getByRole("button", { name: "弹幕溢出判断说明" }));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/usage-log?frontendVersion=1.7.6",
    expect.objectContaining({
      body: JSON.stringify({
        action: "feedback_explanation_open",
        section: "revenue_calculation",
        success: true,
      }),
      keepalive: true,
      method: "POST",
    })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/usage-log?frontendVersion=1.7.6",
    expect.objectContaining({
      body: JSON.stringify({
        action: "feedback_explanation_open",
        section: "danmaku_overflow",
        success: true,
      }),
      keepalive: true,
      method: "POST",
    })
  );
});
