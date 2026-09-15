import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const appVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

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

test("CV profile keeps compact controls and responsive work columns in WebKit-sized layouts", async ({ page }, testInfo) => {
  await page.addInitScript((version) => {
    window.localStorage.setItem("missevan-changelog-seen-version", version);
  }, appVersion);
  await page.route("**/cv-profile?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profileResponse),
    })
  );
  await page.route("**/ranks/trends/availability?**", (route) => {
    const ids = new URL(route.request().url()).searchParams.getAll("id");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, ids }),
    });
  });

  await page.setViewportSize({ width: 376, height: 800 });
  await page.goto("/?view=cv&cv=%E5%93%8D%E5%BA%94%E5%BC%8F%E6%B5%8B%E8%AF%95%20CV&sort=plays_asc");
  await expect(page.getByRole("heading", { name: "响应式测试 CV" })).toBeVisible();

  await expect(page.getByRole("button", { name: /当前按播放量/ })).toHaveCount(0);
  const getVisibleTitleText = (accessibleName) =>
    page.getByRole("button", { name: accessibleName, exact: true }).evaluate((button) =>
      Array.from(button.children)
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => element.textContent)
        .join("")
    );
  expect(await getVisibleTitleText(shortTitle)).toBe(`${shortTitle}广播剧`);
  expect(await getVisibleTitleText(longTitle)).toBe(
    `${Array.from(longTitle).slice(0, 18).join("")}...广播剧`
  );

  const titleButtons = page.locator(".cv-profile-work-grid > article button[aria-label]").filter({ hasText: shortTitle });
  await expect(titleButtons.first()).toHaveAttribute("aria-label", shortTitle);
  const filterButtons = page.locator('button[aria-label*="筛选，"]');
  await expect(filterButtons).toHaveCount(4);
  const filterHeights = await filterButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height)
  );
  expect(filterHeights.every((height) => height <= 32)).toBe(true);
  for (const width of [375, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const mobileToolbar = await filterButtons.evaluateAll((buttons) => buttons.map((button) => {
      const visibleLabel = [...button.querySelectorAll("span")]
        .find((span) => getComputedStyle(span).display !== "none")?.textContent;
      const bounds = button.getBoundingClientRect();
      return { text: visibleLabel, y: bounds.y };
    }));
    expect(mobileToolbar.map((item) => item.text)).toEqual(["平台·全", "付费·全", "时间·全", "搭档·全"]);
    if (width >= 375) {
      expect(new Set(mobileToolbar.map((item) => Math.round(item.y))).size).toBe(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 376, height: 800 });
  await page.getByRole("button", { name: "时间筛选，全部" }).click();
  const releaseOptions = page.getByRole("dialog", { name: "时间筛选选项", exact: true });
  await expect(releaseOptions).toHaveAttribute("data-slot", "popover-content");
  await expect(releaseOptions.getByRole("button", { name: /筛选2024，\d+部作品/ })).toBeVisible();
  await expect(releaseOptions.getByRole("button", { name: /筛选暂无，\d+部作品/ })).toBeVisible();
  const releaseChip = releaseOptions.getByRole("button", { name: /筛选2024，\d+部作品/ });
  await releaseOptions.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) =>
      animation.finished.catch(() => undefined)
    ));
  });
  const releaseChipDimensions = await releaseChip.evaluate((button) => {
    const visualChip = button.querySelector("span");
    return {
      buttonHeight: button.getBoundingClientRect().height,
      visualHeight: visualChip?.getBoundingClientRect().height,
    };
  });
  expect(releaseChipDimensions.buttonHeight).toBe(44);
  expect(releaseChipDimensions.visualHeight).toBe(36);
  await page.keyboard.press("Escape");
  const loadMoreButton = page.getByRole("button", { name: "加载更多" });
  await expect(loadMoreButton).toHaveAttribute("data-touch", "compact");
  const loadMoreBox = await loadMoreButton.boundingBox();
  expect(loadMoreBox?.height).toBeLessThanOrEqual(32);

  const firstArticle = page.locator(".cv-profile-work-grid > article").first();
  const coverBox = await firstArticle.locator("[data-cv-work-cover]").boundingBox();
  const metaBox = await firstArticle.locator("[data-cv-work-meta]").boundingBox();
  const playbackBox = await firstArticle.locator("[data-cv-work-playback]").boundingBox();
  const watermarkBox = await firstArticle.locator("[data-cv-work-watermark]").boundingBox();
  const articleBox = await firstArticle.boundingBox();
  expect(Math.abs(((coverBox?.y ?? 0) + (coverBox?.height ?? 0) / 2) - ((metaBox?.y ?? 0) + (metaBox?.height ?? 0) / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs((coverBox?.x ?? 0) - (playbackBox?.x ?? 0))).toBeLessThanOrEqual(1);
  expect((playbackBox?.y ?? 0)).toBeGreaterThan((metaBox?.y ?? 0) + (metaBox?.height ?? 0));
  expect((watermarkBox?.x ?? 0) + (watermarkBox?.width ?? 0)).toBeLessThanOrEqual((articleBox?.x ?? 0) + (articleBox?.width ?? 0));
  await expect(firstArticle.getByRole("link", { name: /打开作品ID/ })).toHaveCount(0);
  await expect(firstArticle.locator("[data-cv-work-meta] [data-platform=\"missevan\"]")).toHaveCount(1);

  const partnerTrigger = page.getByRole("button", { name: "搭档筛选，全部" });
  await partnerTrigger.click();
  await expect(page.getByRole("textbox", { name: "搜索搭档" })).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(partnerTrigger).toBeFocused();

  await page.setViewportSize({ width: 375, height: 700 });
  await partnerTrigger.scrollIntoViewIfNeeded();
  await partnerTrigger.click();
  await page.getByRole("textbox", { name: "搜索搭档" }).fill("测试");
  await page.setViewportSize({ width: 375, height: 420 });
  const partnerPopover = page.getByRole("dialog", { name: "搭档筛选选项", exact: true });
  const applyButton = partnerPopover.getByRole("button", { name: "应用" });
  await expect(applyButton).toBeVisible();
  await expect.poll(async () => {
    const bounds = await applyButton.boundingBox();
    return Boolean(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 420);
  }).toBe(true);
  await applyButton.click();

  const expectedColumns = [
    { width: 320, count: 1 },
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
    const actionModes = await page.locator('[data-cv-work-actions="true"]').evaluateAll((elements) =>
      [...new Set(elements.map((element) => element.dataset.actionMode))]
    );
    expect(actionModes.every((mode) => ["all", "trend-more", "more-only"].includes(mode))).toBe(true);
    await expect.poll(async () =>
      page.locator('[data-cv-work-actions="true"]').evaluateAll((elements) =>
        elements.every((element) => {
          const [trend, compare, more] = element.querySelectorAll(":scope > button");
          if (!trend || !compare || !more) return false;
          const available = element.getBoundingClientRect().width;
          const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
          const expectedMode = available + 0.5 >=
            trend.getBoundingClientRect().width +
              compare.getBoundingClientRect().width +
              more.getBoundingClientRect().width +
              gap * 2
            ? "all"
            : available + 0.5 >=
                trend.getBoundingClientRect().width + more.getBoundingClientRect().width + gap
              ? "trend-more"
              : "more-only";
          return element.dataset.actionMode === expectedMode;
        })
      )
    ).toBe(true);
    if (width === 320 || width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath(`cv-profile-${width}.png`),
        fullPage: true,
      });
    }
  }

  const firstWorkActions = page.locator('[data-cv-work-actions="true"]').first();
  for (const [width, mode] of [["15rem", "all"], ["10rem", "trend-more"], ["6rem", "more-only"]]) {
    await firstWorkActions.evaluate((element, flexBasis) => {
      element.style.flex = `0 0 ${flexBasis}`;
      element.style.width = flexBasis;
    }, width);
    await expect(firstWorkActions).toHaveAttribute("data-action-mode", mode);
  }
});
