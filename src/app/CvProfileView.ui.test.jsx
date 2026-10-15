import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";

import { CvProfileView } from "@/app/CvProfileView";

vi.mock("@/app/LazyRankTrendDialog", () => ({
  LazyRankTrendDialog: ({ open }) => open ? <div data-testid="trend-dialog" /> : null,
}));

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
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/ranks/trends/availability?")) {
      const ids = new URL(url, "https://example.test").searchParams.getAll("id");
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ success: true, ids }),
      });
    }
    if (url.includes("/usage-log")) {
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ success: true }),
      });
    }
    if (url.includes("/ranks/trends?")) {
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ success: true, metrics: [], snapshots: [] }),
      });
    }
    return Promise.resolve({
      ok: true,
      headers: { get: () => null },
      json: async () => data,
    });
  });
}

function ProfileHarness({
  profileId = "",
  onRouteStateChange = () => {},
  onOpenSearchResult = () => {},
  ...viewProps
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
      {...viewProps}
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
  vi.unstubAllGlobals();
});

test("desktop series expansion stays in the grid and keeps nested work menus usable", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  const user = userEvent.setup();
  const onToggleFavorite = vi.fn();
  const data = createProfileData(4);
  data.works.forEach((work, index) => {
    work.platform = "missevan";
    work.seriesId = index < 2 ? "desktop-series" : "second-series";
    work.seriesTitle = index < 2 ? "桌面系列" : "另一系列";
  });
  mockProfileFetch(data);
  const { container } = render(<ProfileHarness onToggleFavorite={onToggleFavorite} />);
  await user.click(await screen.findByRole("button", { name: "展开系列桌面系列" }));
  const overlay = await screen.findByRole("region", { name: "桌面系列系列作品" });
  expect(overlay).toHaveAttribute("data-cv-series-panel", "row");
  expect(container).toContainElement(overlay);
  await user.click(screen.getByRole("button", { name: "展开系列另一系列" }));
  expect(screen.queryByRole("region", { name: "桌面系列系列作品" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("region", { name: /系列作品$/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "展开系列桌面系列" }));
  await user.click(screen.getByRole("button", { name: "作品1更多操作" }));
  expect(container.querySelector('[aria-label="收起系列桌面系列"]')).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("menuitem", { name: "收藏" }));
  expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ dramaId: "1" }));
  expect(screen.getByRole("button", { name: "收起系列桌面系列" })).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "关闭桌面系列系列详情" }));
  expect(screen.getByRole("button", { name: "展开系列桌面系列" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "展开系列桌面系列" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "展开系列桌面系列" })).toHaveFocus();
});

test("series cards default closed, use the first cover and deduplicate all CVs", async () => {
  const user = userEvent.setup();
  const data = createProfileData(5);
  data.works = data.works.map((work, index) => ({
    ...work,
    platform: "missevan",
    mainCvs: index === 0 ? ["路知行", "CV甲"] : ["CV甲", "CV乙"],
    seriesId: index < 2 ? "group-a" : index < 4 ? "group-b" : "single",
    seriesTitle: index < 2 ? "系列甲" : index < 4 ? "系列乙" : "单部",
  }));
  mockProfileFetch(data);
  render(<ProfileHarness />);
  const first = await screen.findByRole("button", { name: "展开系列系列甲" });
  expect(first).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "作品1" })).not.toBeInTheDocument();
  expect(screen.getByAltText("系列甲系列封面")).toHaveAttribute("src", "/image-proxy?url=https%3A%2F%2Fexample.com%2F1.jpg");
  expect(screen.getByText("路知行、CV甲、CV乙")).toBeInTheDocument();
  expect(screen.queryByText("单部")).not.toBeInTheDocument();
  expect(within(screen.getByLabelText("猫耳平台数据")).getByText("3")).toBeInTheDocument();
  await user.click(first);
  expect(screen.getByRole("button", { name: "作品1" })).toBeVisible();
  expect(screen.getByRole("button", { name: "展开系列系列乙" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "收起系列系列甲" }));
  expect(screen.queryByRole("button", { name: "作品1" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "展开系列系列甲" }));
  await user.click(screen.getByRole("heading", { name: "路知行" }));
  expect(screen.getByRole("button", { name: "展开系列系列甲" })).toHaveAttribute("aria-expanded", "false");
  const payment = screen.getByRole("button", { name: "付费筛选，全部" });
  await user.click(payment);
  await user.click(screen.getByRole("button", { name: "筛选免费，2个系列" }));
  await user.click(payment);
  await waitFor(() => expect(screen.getByRole("button", { name: "作品1" })).toBeVisible());
  expect(screen.queryByRole("button", { name: /系列系列/ })).not.toBeInTheDocument();
});

test.each([false, true])("inline profile series stays open when dismissing its nested preview (popover=%s)", async (popover) => {
  vi.stubGlobal("matchMedia", vi.fn((query) => ({ matches: popover && query === "(min-width: 640px)", addEventListener() {}, removeEventListener() {} })));
  const user = userEvent.setup();
  const data = createProfileData(2);
  data.works.forEach((work) => Object.assign(work, { platform: "missevan", seriesId: "nested", seriesTitle: "嵌套系列" }));
  mockProfileFetch(data);
  render(<ProfileHarness />);
  await user.click(await screen.findByRole("button", { name: "展开系列嵌套系列" }));
  await user.click(screen.getByRole("button", { name: "作品1" }));
  expect(screen.getByRole("dialog", { name: "作品1" })).toBeVisible();
  const outside = popover ? document.body : document.querySelector('[data-slot="sheet-overlay"][data-state="open"]');
  await user.click(outside);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "作品1" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "收起系列嵌套系列" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "作品1" })).toBeVisible();
  await user.click(document.body);
  expect(screen.getByRole("button", { name: "展开系列嵌套系列" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "展开系列嵌套系列" }));
  await user.click(screen.getByRole("button", { name: "作品1" }));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "作品1" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "收起系列嵌套系列" })).toHaveAttribute("aria-expanded", "true");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "展开系列嵌套系列" })).toHaveAttribute("aria-expanded", "false");
});

test("mobile series waits for the completed click before switching to another series", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  const data = createProfileData(5);
  data.works.forEach((work, index) => Object.assign(work, { platform: "missevan", ...(index < 4 ? { seriesId: index < 2 ? "a" : "b", seriesTitle: index < 2 ? "系列甲" : "系列乙" } : {}) }));
  mockProfileFetch(data);
  const user = userEvent.setup();
  render(<ProfileHarness />);
  await user.click(await screen.findByRole("button", { name: "展开系列系列甲" }));
  const next = screen.getByRole("button", { name: "展开系列系列乙" });
  fireEvent.pointerDown(next, { pointerType: "touch", button: 0 });
  expect(screen.getByRole("button", { name: "收起系列系列甲" })).toHaveAttribute("aria-expanded", "true");
  fireEvent.pointerUp(next, { pointerType: "touch", button: 0 });
  fireEvent.click(next, { detail: 1 });
  expect(screen.getByRole("button", { name: "展开系列系列甲" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: "收起系列系列乙" })).toHaveAttribute("aria-expanded", "true");
});

test("mobile work menus toggle in place and an outside work menu still collapses the old series", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  const data = createProfileData(3);
  data.works.forEach((work, index) => Object.assign(work, { platform: "missevan", ...(index < 2 ? { seriesId: "a", seriesTitle: "系列甲" } : {}) }));
  mockProfileFetch(data);
  const user = userEvent.setup();
  render(<ProfileHarness />);
  await user.click(await screen.findByRole("button", { name: "展开系列系列甲" }));
  const ownMore = screen.getByRole("button", { name: "作品1更多操作" });
  await user.click(ownMore);
  expect(screen.getByRole("menu")).toBeVisible();
  await user.click(ownMore);
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "收起系列系列甲" })).toHaveAttribute("aria-expanded", "true");
  await user.click(ownMore);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "收起系列系列甲" })).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "作品3更多操作" }));
  expect(screen.getByRole("button", { name: "展开系列系列甲" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("menu")).toBeVisible();
});

test("progressive rendering never splits a series across load-more batches", async () => {
  const user = userEvent.setup();
  const data = createProfileData(54);
  data.works.forEach((work, index) => {
    work.platform = "missevan";
    work.playCount = 10000 - index;
    if (index < 2) { work.seriesId = "leading-series"; work.seriesTitle = "完整系列"; }
  });
  mockProfileFetch(data);
  const { container } = render(<ProfileHarness />);
  const toggle = await screen.findByRole("button", { name: "展开系列完整系列" });
  expect(container.querySelectorAll("[data-cv-series]")).toHaveLength(24);
  await user.click(toggle);
  expect(screen.getByRole("button", { name: "作品1" })).toBeVisible();
  expect(screen.getByRole("button", { name: "作品2" })).toBeVisible();
  expect(container.querySelectorAll(".cv-series-works > article")).toHaveLength(25);
  await user.click(screen.getByRole("button", { name: "加载更多" }));
  expect(container.querySelectorAll("[data-cv-series]")).toHaveLength(48);
});

test("all filter facets count distinct series and intersect other filters at work level", async () => {
  const user = userEvent.setup();
  const data = createProfileData(5);
  const fields = [
    ["missevan", "series-a", true, "2026.01", ["搭档甲"]],
    ["missevan", "series-a", false, "2025.01", ["搭档甲"]],
    ["missevan", "series-a", true, "2026.02", ["搭档乙"]],
    ["missevan", "series-b", true, "2026.03", ["搭档甲"]],
    ["manbo", undefined, false, "2025.02", []],
  ];
  data.works.forEach((work, index) => {
    const [platform, seriesId, needpay, createTime, partners] = fields[index];
    Object.assign(work, { platform, seriesId, needpay, createTime, partners });
  });
  mockProfileFetch(data);
  render(<ProfileHarness />);
  await screen.findByRole("heading", { name: "路知行" });
  for (const [filter, expected] of [
    ["平台", ["筛选猫耳，2个系列", "筛选漫播，1个系列"]],
    ["付费", ["筛选付费，2个系列", "筛选免费，2个系列"]],
    ["时间", ["筛选2026，2个系列", "筛选2025，2个系列"]],
    ["搭档", ["筛选搭档甲，2个系列", "筛选搭档乙，1个系列", "筛选无搭档，1个系列"]],
  ]) {
    const trigger = screen.getByRole("button", { name: `${filter}筛选，全部` });
    await user.click(trigger);
    expected.forEach((name) => expect(screen.getByRole("button", { name })).toBeInTheDocument());
    await user.click(trigger);
  }
  const payment = screen.getByRole("button", { name: "付费筛选，全部" });
  await user.click(payment);
  await user.click(screen.getByRole("button", { name: "筛选付费，2个系列" }));
  await user.click(payment);
  const platform = screen.getByRole("button", { name: "平台筛选，全部" });
  await user.click(platform);
  expect(screen.getByRole("button", { name: "筛选猫耳，1个系列" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "筛选漫播，1个系列" })).toBeInTheDocument();
  await user.click(platform);
  await user.click(screen.getByRole("button", { name: "时间筛选，全部" }));
  expect(screen.getByRole("button", { name: "筛选2026，0个系列" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "筛选2025，2个系列" })).toBeInTheDocument();
});

test("CV profile includes the search identity discriminator in its request", async () => {
  const fetchMock = mockProfileFetch(createProfileData());
  render(<ProfileHarness profileId="missevan:id:9" />);

  await screen.findByRole("heading", { name: "路知行" });
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
    "name=%E8%B7%AF%E7%9F%A5%E8%A1%8C&profileId=missevan%3Aid%3A9"
  );
});

test("CV profile work titles fetch a preview before navigating to statistics", async () => {
  const user = userEvent.setup();
  const open = vi.fn(async () => true);
  const fetchMock = mockProfileFetch(createProfileData());
  render(<ProfileHarness onOpenSearchResult={open} />);
  await user.click(await screen.findByRole("button", { name: "作品1" }));
  expect(screen.getByRole("dialog", { name: "作品1" })).toBeVisible();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/search-card-metrics"))).toBe(true);
  expect(open).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "进入统计" }));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "1", usageAction: "cv_profile_open_search_result", usageSource: "cv_profile" }));
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
  expect(screen.getByLabelText("播放量：暂无数据")).toBeInTheDocument();
  const missevanStats = screen.getByRole("article", { name: "猫耳平台数据" });
  expect(within(missevanStats).getByText("2")).toBeInTheDocument();
  expect(within(missevanStats).getByText("1000")).toBeInTheDocument();
  const platformFilterTrigger = screen.getByRole("button", { name: "平台筛选，全部" });
  expect(platformFilterTrigger).toHaveAttribute("data-touch", "compact");
  expect(platformFilterTrigger).toHaveClass("w-fit", "px-1.5!", "text-[13px]!");
  expect(within(platformFilterTrigger).getByText("平台·全", { exact: true })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "付费筛选，全部" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "时间筛选，全部" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "搭档筛选，全部" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /当前按播放量/ })).not.toBeInTheDocument();

  const platformTrigger = screen.getByRole("button", { name: "平台筛选，全部" });
  await user.click(platformTrigger);
  expect(screen.getByLabelText("平台筛选选项")).toBeInTheDocument();
  const catEarOption = screen.getByRole("button", { name: "筛选猫耳，2个系列" });
  await user.click(catEarOption);
  expect(catEarOption).toHaveAttribute("aria-pressed", "false");
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
  expect(openSearchResult).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "进入统计" }));
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
  await user.click(screen.getByRole("button", { name: "关闭数据速览" }));
  expect(screen.queryByRole("link", { name: /打开作品ID/ })).not.toBeInTheDocument();

  const paymentTrigger = screen.getByRole("button", { name: "付费筛选，全部" });
  await user.click(paymentTrigger);
  await user.click(screen.getByRole("button", { name: "筛选免费，1个系列" }));
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

test("CV profile work cards provide library-backed actions and a plain platform ID", async () => {
  const user = userEvent.setup();
  const openSearchResult = vi.fn(async () => true);
  const toggleFavorite = vi.fn();
  const addCompareItem = vi.fn();
  const startPaidIdStatistics = vi.fn();
  const startRevenueEstimate = vi.fn();
  mockProfileFetch(createProfileData());
  render(
    <ProfileHarness
      onOpenSearchResult={openSearchResult}
      onToggleFavorite={toggleFavorite}
      onAddCompareItem={addCompareItem}
      onStartDramaPaidIdStatistics={startPaidIdStatistics}
      onStartRevenueEstimate={startRevenueEstimate}
    />
  );

  await screen.findByRole("button", { name: "作品1" });
  const firstCard = screen.getByRole("button", { name: "作品1" }).closest("article");
  expect(firstCard?.querySelector("[data-cv-work-cover]")).toBeTruthy();
  expect(firstCard?.querySelector("[data-cv-work-meta] [data-platform=\"missevan\"]")).toBeTruthy();
  expect(firstCard?.querySelector("[data-cv-work-watermark] [data-platform=\"missevan\"]")).toBeTruthy();
  expect(firstCard?.querySelector("[data-cv-work-playback]")).toHaveTextContent("1000");

  await user.click(await screen.findByRole("button", { name: "加入作品1对比" }));
  expect(addCompareItem).toHaveBeenCalledWith(expect.objectContaining({
    platform: "missevan",
    id: "1",
    title: "作品1",
  }));
  await user.click(await screen.findByRole("button", { name: "查看作品2趋势" }));
  expect(await screen.findByTestId("trend-dialog")).toBeInTheDocument();
  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/ranks/trends?"),
    expect.objectContaining({ cache: "no-store" })
  );
  expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes("platform=manbo") && String(url).includes("id=2"))).toBe(true);

  await user.click(screen.getByRole("button", { name: "作品1更多操作" }));
  expect(screen.getByRole("menuitem", { name: "收藏" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "付费ID" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "收益" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /在猫耳打开作品ID 1/ })).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "收藏" }));
  expect(toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({
    platform: "missevan",
    dramaId: "1",
    source: "cv_profile",
  }));

  await user.click(screen.getByRole("button", { name: "作品1更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "付费ID" }));
  await waitFor(() => expect(openSearchResult).toHaveBeenLastCalledWith(expect.objectContaining({
    id: "1",
    suppressUsageLog: true,
  })));
  expect(startPaidIdStatistics).toHaveBeenCalledWith("1", {
    platform: "missevan",
    source: "1payID",
  });

  await user.click(screen.getByRole("button", { name: "作品2更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "收益" }));
  await waitFor(() => expect(startRevenueEstimate).toHaveBeenCalledWith(["2"], {
    platform: "manbo",
    source: "2earn",
  }));

  openSearchResult.mockResolvedValueOnce(false);
  await user.click(screen.getByRole("button", { name: "作品1更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "付费ID" }));
  await waitFor(() => expect(openSearchResult).toHaveBeenLastCalledWith(expect.objectContaining({
    id: "1",
    suppressUsageLog: true,
  })));
  expect(startPaidIdStatistics).toHaveBeenCalledTimes(1);
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
  expect(within(releasePopover).getByRole("button", { name: "筛选2026，1个系列" })).toHaveAttribute("aria-pressed", "true");
  expect(within(releasePopover).getByRole("button", { name: "筛选2025，1个系列" })).toHaveAttribute("aria-pressed", "true");
  expect(within(releasePopover).getByRole("button", { name: "筛选暂无，2个系列" })).toHaveAttribute("aria-pressed", "true");
  await user.click(within(releasePopover).getByRole("button", { name: "全选" }));
  await user.click(screen.getByRole("button", { name: "清空" }));
  expect(within(releasePopover).getByRole("button", { name: "筛选2025，1个系列" })).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByRole("button", { name: "筛选2025，1个系列" }));
  await user.click(screen.getByRole("button", { name: "筛选2026，1个系列" }));
  expect(within(releasePopover).getByRole("button", { name: "筛选2025，1个系列" })).toHaveAttribute("aria-pressed", "true");
  expect(within(releasePopover).getByRole("button", { name: "筛选2026，1个系列" })).toHaveAttribute("aria-pressed", "true");
  await user.click(within(releasePopover).getByRole("button", { name: "全选" }));
  await user.click(within(releasePopover).getByRole("button", { name: "清空" }));
  await user.click(within(releasePopover).getByRole("button", { name: "筛选2025，1个系列" }));
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
  expect(within(partnerPopover).getByRole("button", { name: "筛选名字,带逗号，0个系列" })).toBeInTheDocument();
  expect(within(partnerPopover).queryByRole("button", { name: /筛选搭档甲/ })).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索搭档" }));
  expect(within(partnerPopover).getByRole("button", { name: "筛选搭档甲，1个系列" })).toBeInTheDocument();
  expect(within(partnerPopover).getByRole("button", { name: "筛选无搭档，0个系列" })).toBeInTheDocument();
  await user.click(within(partnerPopover).getByRole("button", { name: "清空" }));
  await user.click(within(partnerPopover).getByRole("button", { name: "筛选无搭档，0个系列" }));
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
