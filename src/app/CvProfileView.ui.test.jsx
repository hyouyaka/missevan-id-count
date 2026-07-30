import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";

import { CvProfileView } from "@/app/CvProfileView";

function createProfileData(workCount = 3) {
  const works = Array.from({ length: workCount }, (_, index) => ({
    platform: index === 1 ? "manbo" : "missevan",
    id: String(index + 1),
    title: `作品${index + 1}`,
    cover: `https://example.com/${index + 1}.jpg`,
    category: index % 2 ? "audio_drama" : "radio_drama",
    needpay: index % 2 === 0,
    createTime: index === 1 ? "" : `2026.${String(index + 1).padStart(2, "0")}`,
    partners: index ? ["搭档甲"] : [],
    playCount: index === 2 ? null : 1000 - index,
    dataDate: `2026-07-${String(10 + index).padStart(2, "0")}`,
  }));
  const missevanWorks = works.filter((work) => work.platform === "missevan");
  const manboWorks = works.filter((work) => work.platform === "manbo");
  return {
    success: true,
    cv: { name: "路知行", avatar: "https://example.com/avatar.jpg" },
    stats: {
      missevan: {
        workCount: missevanWorks.length,
        playback: 1000,
        dataUpdatedAt: "2026-07-24",
      },
      manbo: {
        workCount: manboWorks.length,
        playback: manboWorks.length ? 999 : null,
        dataUpdatedAt: manboWorks.length ? "2026-07-23" : "",
      },
    },
    totals: {
      playback: 1999,
      missevanPlayback: 1000,
      manboPlayback: 999,
    },
    freshness: {
      missevan: { latestDate: "2026-07-24" },
      manbo: { latestDate: "2026-07-23" },
    },
    works,
  };
}

function mockProfileFetch(data) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    headers: { get: () => null },
    json: async () => data,
  });
}

function ProfileHarness({
  profileId = "",
  onRouteStateChange = () => {},
  onOpenSearchResult = () => {},
}) {
  const [platform, setPlatform] = useState("all");
  const [payment, setPayment] = useState("all");
  const [release, setRelease] = useState("all");
  const [partners, setPartners] = useState("all");
  return (
    <CvProfileView
      cvName="路知行"
      profileId={profileId}
      frontendVersion="1.7.6"
      onBack={() => {}}
      platformFilter={platform}
      paymentFilter={payment}
      releaseFilter={release}
      partnersFilter={partners}
      onOpenSearchResult={onOpenSearchResult}
      onRouteStateChange={(patch) => {
        if (patch.platform) {
          setPlatform(patch.platform);
        }
        if (patch.payment) {
          setPayment(patch.payment);
        }
        if (patch.release) {
          setRelease(patch.release);
        }
        if (patch.partners) {
          setPartners(patch.partners);
        }
        onRouteStateChange(patch);
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("CV profile includes the search identity discriminator in its request", async () => {
  const fetchMock = mockProfileFetch(createProfileData());
  render(<ProfileHarness profileId="missevan:id:9" />);

  await screen.findByRole("heading", { name: "路知行" });
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
    "name=%E8%B7%AF%E7%9F%A5%E8%A1%8C&profileId=missevan%3Aid%3A9"
  );
});

test("CV profile commits popover filters on close and recalculates platform stats", async () => {
  const user = userEvent.setup();
  const routeChange = vi.fn();
  const openSearchResult = vi.fn();
  mockProfileFetch(createProfileData());
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  render(
    <ProfileHarness
      onRouteStateChange={routeChange}
      onOpenSearchResult={openSearchResult}
    />
  );

  expect(screen.getByLabelText("正在加载 CV 主页")).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "路知行" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "猫耳平台数据" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "漫播平台数据" })).toBeInTheDocument();
  expect(screen.getByText("播放量更新 2026-07-24")).toBeInTheDocument();
  expect(screen.getByAltText("路知行头像")).toBeInTheDocument();
  expect(screen.getByAltText("作品1封面")).toBeInTheDocument();
  expect(screen.queryByText("双平台总播放量")).not.toBeInTheDocument();
  expect(screen.queryByText("2026-07-10")).not.toBeInTheDocument();
  expect(screen.getAllByText("广播剧").length).toBeGreaterThan(0);
  expect(screen.getAllByText("广播剧")[0]).toHaveAttribute("data-variant", "radioDrama");
  expect(screen.getByRole("button", { name: "作品1" })).toContainElement(screen.getAllByText("广播剧")[0]);
  expect(screen.getAllByLabelText("时间")[0].parentElement).toHaveTextContent("2026.01");
  expect(screen.getAllByLabelText("时间")[1].parentElement).toHaveTextContent("暂无");
  expect(screen.getAllByLabelText("搭档")[0].parentElement).toHaveTextContent("—");
  const missevanStats = screen.getByRole("article", { name: "猫耳平台数据" });
  expect(within(missevanStats).getByText("2")).toBeInTheDocument();
  expect(within(missevanStats).getByText("1000")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "平台筛选，全部" })).toHaveAttribute("data-touch", "compact");
  expect(screen.getByRole("button", { name: "付费筛选，全部" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "时间筛选，全部" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "搭档筛选，全部" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /当前按播放量/ })).not.toBeInTheDocument();

  const platformTrigger = screen.getByRole("button", { name: "平台筛选，全部" });
  await user.click(platformTrigger);
  expect(screen.getByLabelText("平台筛选选项")).toBeInTheDocument();
  await user.click(screen.getByLabelText("猫耳"));
  expect(screen.getByRole("button", { name: "作品1" })).toBeInTheDocument();
  expect(within(missevanStats).getByText("2")).toBeInTheDocument();
  expect(routeChange).not.toHaveBeenCalled();
  await user.click(platformTrigger);
  expect(routeChange).toHaveBeenCalledWith({ platform: "manbo" });
  expect(scrollIntoView).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "作品1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作品2" })).toBeInTheDocument();
  });
  expect(within(missevanStats).getByText("0")).toBeInTheDocument();
  expect(within(missevanStats).getByText("暂无数据")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "作品2" }));
  expect(openSearchResult).toHaveBeenCalledWith({
    platform: "manbo",
    id: "2",
    titles: ["作品2"],
    name: "作品2",
    paymentLabel: "免费",
    contentTypeLabel: "有声剧",
    usageAction: "cv_profile_open_search_result",
    usageSource: "cv_profile",
  });

  const paymentTrigger = screen.getByRole("button", { name: "付费筛选，全部" });
  await user.click(paymentTrigger);
  await user.click(screen.getByLabelText("免费"));
  await user.click(screen.getByRole("button", { name: "应用" }));
  expect(routeChange).toHaveBeenCalledWith({ payment: "paid" });
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(await screen.findByText("当前筛选下暂无作品")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "恢复全部筛选" }));
  expect(routeChange).toHaveBeenCalledWith({
    platform: "all",
    payment: "all",
    release: "all",
    partners: "all",
  });

});

test("CV profile filters release years and exposes counts under current filters", async () => {
  const user = userEvent.setup();
  const routeChange = vi.fn();
  const data = createProfileData(4);
  data.works[0].partners = ["搭档甲", "名字,带逗号", "搭档甲"];
  data.works[1].partners = [];
  data.works[2].createTime = "2025.12";
  data.works[3].createTime = "";
  mockProfileFetch(data);
  render(<ProfileHarness onRouteStateChange={routeChange} />);

  expect(await screen.findByRole("button", { name: "时间筛选，全部" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "时间筛选，全部" }));
  const releasePopover = screen.getByLabelText("时间筛选选项");
  expect(within(releasePopover).getByText("2026").parentElement).toHaveTextContent("1");
  expect(within(releasePopover).getByText("2025").parentElement).toHaveTextContent("1");
  expect(within(releasePopover).getByText("暂无").parentElement).toHaveTextContent("2");
  await user.click(screen.getByRole("button", { name: "清空" }));
  await user.click(screen.getByLabelText("2025"));
  await user.click(screen.getByRole("button", { name: "应用" }));
  expect(routeChange).toHaveBeenCalledWith({ release: "2025" });
  expect(await screen.findByRole("button", { name: "作品3" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "作品1" })).not.toBeInTheDocument();

  const partnerTrigger = screen.getByRole("button", { name: "搭档筛选，全部" });
  await user.click(partnerTrigger);
  const partnerPopover = screen.getByLabelText("搭档筛选选项");
  expect(partnerTrigger).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "搜索搭档" })).not.toHaveFocus();
  await user.type(screen.getByRole("textbox", { name: "搜索搭档" }), "逗号");
  expect(within(partnerPopover).getByText("名字,带逗号").parentElement).toHaveTextContent("0");
  expect(within(partnerPopover).queryByText("搭档甲")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索搭档" }));
  expect(within(partnerPopover).getByText("搭档甲").parentElement).toHaveTextContent("1");
  expect(within(partnerPopover).getByText("无搭档").parentElement).toHaveTextContent("0");
  await user.click(within(partnerPopover).getByRole("button", { name: "清空" }));
  await user.click(within(partnerPopover).getByLabelText("无搭档"));
  await user.click(screen.getByRole("button", { name: "应用" }));
  expect(routeChange).toHaveBeenCalledWith({
    partners: JSON.stringify(["__none__"]),
  });
});

test("CV profile progressively renders more than fifty works", async () => {
  const user = userEvent.setup();
  mockProfileFetch(createProfileData(52));
  render(<ProfileHarness />);

  expect(await screen.findByRole("button", { name: "作品1" })).toBeInTheDocument();
  expect(
    within(screen.getByRole("article", { name: "猫耳平台数据" })).getByText("51")
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "作品26" })).not.toBeInTheDocument();
  const loadMoreButton = screen.getByRole("button", { name: "加载更多" });
  expect(loadMoreButton).toHaveAttribute("data-touch", "compact");
  expect(loadMoreButton).toHaveClass("h-8", "min-h-8", "rounded-full");
  await user.click(loadMoreButton);
  expect(await screen.findByRole("button", { name: "作品26" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "作品52" })).not.toBeInTheDocument();
});
