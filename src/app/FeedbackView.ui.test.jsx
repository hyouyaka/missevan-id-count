import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { FeedbackView } from "@/app/FeedbackView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("feedback introduction links to the MMToolkit Xiaohongshu account", () => {
  render(<FeedbackView featureSuggestionUrl="" />);

  expect(
    screen.getByText(
      "可以提交Bug、数据异常、新功能建议等，我的回复也会显示在这里。也可私信小红书账号",
      { exact: false }
    )
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "MMToolkit" })).toHaveAttribute(
    "href",
    "https://xhslink.cn/m/53LZBGOylUC"
  );
});

test("revenue calculation accordion is collapsed by default and toggles the full markdown", async () => {
  const user = userEvent.setup();
  render(<FeedbackView featureSuggestionUrl="" />);

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
  render(<FeedbackView featureSuggestionUrl="" />);

  const trigger = screen.getByRole("button", { name: "弹幕溢出判断说明" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByText("目前对于弹幕溢出的判断标准：", { selector: "strong" })
  ).not.toBeInTheDocument();
  expect(screen.queryByText("奇洛李维斯回信")).not.toBeInTheDocument();

  await user.click(trigger);

  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getByText("目前对于弹幕溢出的判断标准：", { selector: "strong" })
  ).toBeInTheDocument();
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
  render(
    <FeedbackView
      featureSuggestionUrl=""
      frontendVersion="1.7.6"
    />
  );

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
