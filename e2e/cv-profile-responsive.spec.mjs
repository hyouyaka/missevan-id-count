import { expect, test } from "@playwright/test";

const shortTitle = "虚拟偶像团综丨《一起再出发》";
const longTitle = "全球进化后我站在食物链顶端第二季下篇特别广播剧";

const profileResponse = {
  success: true,
  cv: { name: "响应式测试 CV", avatar: "" },
  stats: {
    missevan: { workCount: 4, playback: 100000000, dataUpdatedAt: "2026-07-24" },
    manbo: { workCount: 2, playback: 58736200, dataUpdatedAt: "2026-07-24" },
  },
  works: [
    {
      platform: "missevan",
      id: "2",
      title: "低播放作品",
      cover: "",
      category: "audio_drama",
      needpay: false,
      createTime: "",
      partners: ["甲"],
      playCount: 10,
    },
    {
      platform: "missevan",
      id: "1",
      title: shortTitle,
      cover: "",
      category: "radio_drama",
      needpay: true,
      createTime: "2022.12",
      partners: ["凌飞", "吴晛", "文森", "陈张太康", "金弦", "胡良伟", "谷江山", "孙路路"],
      playCount: 92000700,
    },
    {
      platform: "manbo",
      id: "3",
      title: longTitle,
      cover: "",
      category: "radio_drama",
      needpay: true,
      createTime: "2024.01",
      partners: ["乙"],
      playCount: 80000000,
    },
    {
      platform: "missevan",
      id: "4",
      title: "第四部作品",
      cover: "",
      category: "audio_drama",
      needpay: true,
      createTime: "2023.03",
      partners: [],
      playCount: 70000000,
    },
    {
      platform: "missevan",
      id: "5",
      title: "第五部作品",
      cover: "",
      category: "radio_drama",
      needpay: true,
      createTime: "2023.02",
      partners: ["丙"],
      playCount: 60000000,
    },
    {
      platform: "manbo",
      id: "6",
      title: "暂无播放量作品",
      cover: "",
      category: "audio_drama",
      needpay: false,
      createTime: "2021.01",
      partners: ["丁"],
      playCount: null,
    },
    ...Array.from({ length: 46 }, (_, index) => ({
      platform: "missevan",
      id: String(index + 7),
      title: `渐进作品 ${index + 1}`,
      cover: "",
      category: index % 2 ? "audio_drama" : "radio_drama",
      needpay: true,
      createTime: "2020.01",
      partners: ["测试搭档"],
      playCount: 50000000 - index,
    })),
  ],
};

test("CV profile keeps compact controls and responsive work columns in WebKit-sized layouts", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("missevan-changelog-seen-version", "1.7.8");
  });
  await page.route("**/cv-profile?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profileResponse),
    })
  );

  await page.setViewportSize({ width: 376, height: 800 });
  await page.goto("/?view=cv&cv=%E5%93%8D%E5%BA%94%E5%BC%8F%E6%B5%8B%E8%AF%95%20CV&sort=plays_asc");
  await expect(page.getByRole("heading", { name: "响应式测试 CV" })).toBeVisible();

  await expect(page.getByRole("button", { name: /当前按播放量/ })).toHaveCount(0);
  const getVisibleTitleText = (accessibleName) =>
    page.getByRole("button", { name: accessibleName }).evaluate((button) =>
      Array.from(button.children)
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => element.textContent)
        .join("")
    );
  expect(await getVisibleTitleText(shortTitle)).toBe(`${shortTitle}广播剧`);
  expect(await getVisibleTitleText(longTitle)).toBe(
    `${Array.from(longTitle).slice(0, 18).join("")}...广播剧`
  );

  const titleButtons = page.locator(".cv-profile-work-grid > article > div > button");
  await expect(titleButtons.first()).toHaveAttribute("aria-label", shortTitle);
  const filterButtons = page.locator('button[aria-label*="筛选，"]');
  await expect(filterButtons).toHaveCount(4);
  const filterHeights = await filterButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height)
  );
  expect(filterHeights.every((height) => height <= 32)).toBe(true);
  await page.getByRole("button", { name: "时间筛选，全部" }).click();
  const releaseOptions = page.getByLabel("时间筛选选项");
  await expect(releaseOptions.getByText("2024", { exact: true })).toBeVisible();
  await expect(releaseOptions.getByText("暂无", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "时间筛选，全部" }).click();
  const loadMoreButton = page.getByRole("button", { name: "加载更多" });
  await expect(loadMoreButton).toHaveAttribute("data-touch", "compact");
  const loadMoreBox = await loadMoreButton.boundingBox();
  expect(loadMoreBox?.height).toBeLessThanOrEqual(32);

  const firstArticle = page.locator(".cv-profile-work-grid > article").first();
  const articleBox = await firstArticle.boundingBox();
  const platformIconBox = await firstArticle.getByRole("img", { name: "猫耳平台" }).boundingBox();
  expect((articleBox?.x ?? 0) + (articleBox?.width ?? 0) - ((platformIconBox?.x ?? 0) + (platformIconBox?.width ?? 0))).toBeGreaterThanOrEqual(7);

  const partnerTrigger = page.getByRole("button", { name: "搭档筛选，全部" });
  await partnerTrigger.click();
  await expect(page.getByRole("textbox", { name: "搜索搭档" })).not.toBeFocused();
  await partnerTrigger.click();

  const expectedColumns = [
    { width: 376, count: 1 },
    { width: 768, count: 2 },
    { width: 1280, count: 3 },
    { width: 1584, count: 3 },
  ];
  for (const { width, count } of expectedColumns) {
    await page.setViewportSize({ width, height: 800 });
    const columnCount = await page.locator(".cv-profile-work-grid").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length
    );
    expect(columnCount).toBe(count);
    if (count > 1) {
      const cardStyles = await page.locator(".cv-profile-work-grid").evaluate((element) => {
        const articleStyle = getComputedStyle(element.querySelector("article"));
        const gridStyle = getComputedStyle(element);
        return {
          borderWidth: Number.parseFloat(articleStyle.borderTopWidth),
          borderRadius: Number.parseFloat(articleStyle.borderTopLeftRadius),
          columnGap: Number.parseFloat(gridStyle.columnGap),
          beforeContent: getComputedStyle(element, "::before").content,
          afterContent: getComputedStyle(element, "::after").content,
        };
      });
      expect(cardStyles.borderWidth).toBeGreaterThanOrEqual(1);
      expect(cardStyles.borderRadius).toBeGreaterThan(0);
      expect(cardStyles.columnGap).toBeGreaterThan(0);
      expect(cardStyles.beforeContent).toBe("none");
      expect(cardStyles.afterContent).toBe("none");
    }
    const hasHorizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  }
});
