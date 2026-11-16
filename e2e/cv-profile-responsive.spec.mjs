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
  cvRanks: {
    updatedAt: "2026-11-13T12:00:00Z",
    updatedAtByPlatform: { missevan: "2026-11-12T12:00:00Z", manbo: "2026-11-13T12:00:00Z" },
    items: [
      { platform: "missevan", rankKey: "cv", rank: 1 },
      { platform: "missevan", rankKey: "cv-paid", rank: 12 },
      { platform: "manbo", rankKey: "cv", rank: 123 },
      { platform: "manbo", rankKey: "cv-paid", rank: 1234 },
    ],
  },
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
    ...Array.from({ length: 48 }, (_, index) => ({
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

profileResponse.works.forEach((work) => {
  if (work.platform === "missevan" && ["1", "4", "5"].includes(work.id)) {
    work.seriesId = "missevan:series:responsive";
    work.seriesTitle = "响应式分组系列";
  }
});

async function mockCvProfilePage(page) {
  await page.addInitScript((version) => {
    window.localStorage.setItem("missevan-changelog-seen-version", version);
  }, appVersion);
  await page.route("**/cv-profile?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Backend-Version": appVersion },
      body: JSON.stringify(profileResponse),
    })
  );
  await page.route("**/ranks/trends/availability?**", (route) => {
    const ids = new URL(route.request().url()).searchParams.getAll("id");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Backend-Version": appVersion },
      body: JSON.stringify({ success: true, ids }),
    });
  });
}

test("CV profile rank badges and identity layout fit mobile, tablet and desktop widths", async ({ page }, testInfo) => {
  await mockCvProfilePage(page);
  await page.setViewportSize({ width: 376, height: 800 });
  await page.goto("/?view=cv&cv=%E5%93%8D%E5%BA%94%E5%BC%8F%E6%B5%8B%E8%AF%95%20CV&sort=plays_asc");
  await expect(page.getByRole("heading", { name: "响应式测试 CV" })).toBeVisible();
  const ranks = page.getByLabel("CV榜排名");
  await expect(ranks.locator('[data-slot="badge"]')).toHaveCount(4);
  await expect(ranks.getByText("猫耳总榜 #1", { exact: true })).toHaveAttribute("title", /2026-11-12/);
  await expect(ranks.getByText("漫播总榜 #123", { exact: true })).toHaveAttribute("title", /2026-11-13/);
  for (const width of [320, 376, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(ranks.getByText("漫播付费榜 #1234", { exact: true })).toBeVisible();
    const layout = await ranks.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const heading = element.previousElementSibling.getBoundingClientRect();
      return {
        belowName: box.top >= heading.bottom,
        fits: Array.from(element.children).every((badge) => {
          const rect = badge.getBoundingClientRect();
          return rect.left >= box.left - 1 && rect.right <= box.right + 1;
        }),
        rows: new Set(Array.from(element.children).map((badge) => Math.round(badge.getBoundingClientRect().top))).size,
      };
    });
    expect(layout.belowName).toBe(true);
    expect(layout.fits).toBe(true);
    const header = await page.locator('[data-cv-profile-identity="true"]').evaluate((identity) => {
      const box = identity.getBoundingClientRect();
      const cards = Array.from(identity.nextElementSibling.children).map((card) => card.getBoundingClientRect());
      const avatar = identity.firstElementChild.getBoundingClientRect();
      const name = identity.querySelector("h2").getBoundingClientRect();
      return {
        statsBelow: cards.every((card) => card.top >= box.bottom),
        statsFillWidth: Math.abs(cards[0].left - box.left) < 1 && Math.abs(cards.at(-1).right - box.right) < 1,
        horizontalIdentity: name.left >= avatar.right,
      };
    });
    expect(header).toEqual({ statsBelow: true, statsFillWidth: true, horizontalIdentity: true });
    if (width === 320) expect(layout.rows).toBeGreaterThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`cv-rank-badges-${width}.png`), fullPage: false });
  }
});

test("CV profile keeps compact controls and responsive work columns in WebKit-sized layouts", async ({ page }, testInfo) => {
  await mockCvProfilePage(page);
  await page.setViewportSize({ width: 376, height: 800 });
  await page.goto("/?view=cv&cv=%E5%93%8D%E5%BA%94%E5%BC%8F%E6%B5%8B%E8%AF%95%20CV&sort=plays_asc");
  await expect(page.getByRole("heading", { name: "响应式测试 CV" })).toBeVisible();

  const groupToggle = page.getByRole("button", { name: "展开系列响应式分组系列" });
  await expect(groupToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: shortTitle, exact: true })).toHaveCount(0);
  await groupToggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: shortTitle, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "收起系列响应式分组系列" }).click();
  await page.getByRole("button", { name: "展开系列响应式分组系列" }).click();
  await expect(page.getByRole("button", { name: shortTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "收起系列低播放作品" })).toHaveCount(0);
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

  const titleButtons = page.locator(".cv-series-works > article button[aria-label]").filter({ hasText: shortTitle });
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
  await expect(releaseOptions.getByRole("button", { name: /筛选2024，\d+个系列/ })).toBeVisible();
  await expect(releaseOptions.getByRole("button", { name: /筛选暂无，\d+个系列/ })).toBeVisible();
  const releaseChip = releaseOptions.getByRole("button", { name: /筛选2024，\d+个系列/ });
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

  const firstArticle = page.locator(".cv-series-works > article").filter({ has: page.getByRole("button", { name: "渐进作品 1", exact: true }) }).first();
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
    const columnCount = await page.locator(".cv-profile-work-grid").first().evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length
    );
    expect(columnCount).toBe(count);
    if (count > 1) {
      const cardStyles = await page.locator(".cv-profile-work-grid").first().evaluate((element) => {
        const articleStyle = getComputedStyle(element.querySelector(":scope > [data-cv-series]"));
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
    const seriesCard = page.locator('[data-cv-series="missevan:series:responsive"]');
    await seriesCard.scrollIntoViewIfNeeded();
    const beforeCard = await seriesCard.boundingBox();
    const nextRow = page.locator('.cv-profile-work-grid [data-cv-series]').nth(count);
    const beforeNextRow = await nextRow.boundingBox();
    await page.getByRole("button", { name: "展开系列响应式分组系列" }).click();
    const panel = page.locator('[data-cv-series-panel]');
    await expect(panel).toHaveAttribute("data-cv-series-panel", count > 1 ? "row" : "inline");
    await expect(page.getByRole("button", { name: shortTitle, exact: true })).toBeVisible();
    await panel.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
    const afterCard = await seriesCard.boundingBox();
    const afterNextRow = await nextRow.boundingBox();
    if (count > 1) {
      expect(Math.abs(afterCard.height - beforeCard.height)).toBeLessThan(1);
      expect(afterNextRow.y - afterCard.y).toBeGreaterThan(beforeNextRow.y - beforeCard.y);
      const panelBox = await panel.boundingBox();
      const gridBox = await page.locator(".cv-profile-work-grid").boundingBox();
      expect(panelBox.width).toBeCloseTo(gridBox.width, 0);
      expect(panelBox.y).toBeGreaterThanOrEqual(afterCard.y + afterCard.height);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(afterNextRow.y);
      const detailColumns = await panel.locator(".cv-series-works").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(detailColumns).toBe(count);
    } else {
      expect(afterCard.height).toBeGreaterThan(beforeCard.height);
      expect(afterNextRow.y - afterCard.y).toBeGreaterThan(beforeNextRow.y - beforeCard.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`cv-series-${width}.png`), fullPage: false });
    await page.getByRole("button", { name: "收起系列响应式分组系列" }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: "展开系列响应式分组系列" }).click();
    if (count > 1) await page.getByRole("button", { name: "关闭响应式分组系列系列详情" }).click();
    else await page.mouse.click(2, 200);
    await expect(page.getByRole("button", { name: "展开系列响应式分组系列" })).toHaveAttribute("aria-expanded", "false");
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

test("rank view logs follow the visible single-rank or all-ranks layout", async ({ page }) => {
  await page.addInitScript((version) => {
    window.localStorage.setItem("missevan-changelog-seen-version", version);
  }, appVersion);
  const logs = [];
  await page.route("**/usage-log**", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "ranks") logs.push(payload.keyword);
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' });
  });
  const category = (key, label, ranks) => ({ key, label, ranks: ranks.map(([key, label]) => ({ key, label, items: [] })) });
  await page.route("**/ranks?**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "X-Backend-Version": appVersion }, body: JSON.stringify({
    success: true, schemaVersion: 8, updatedAt: "2026-11-13", platforms: {
      missevan: { key: "missevan", label: "猫耳", categories: [
        category("new", "新品榜", [["new_daily", "日榜"], ["new_weekly", "周榜"]]),
        category("bestseller", "畅销榜", [["bestseller_weekly", "周榜"], ["bestseller_daily", "日榜"]]),
        category("cv", "CV榜", [["cv", "总榜"], ["cv-series-count", "勤劳榜"]]),
      ] },
    },
  }) }));
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/?view=ranks&platform=missevan&category=new&rank=new_daily");
  await expect.poll(() => [...logs]).toEqual(["新品日榜"]);
  await page.getByRole("tab", { name: "周", exact: true }).click();
  await expect.poll(() => [...logs]).toEqual(["新品日榜", "新品周榜"]);
  await page.getByRole("tab", { name: "CV", exact: true }).click();
  await expect.poll(() => logs.at(-1)).toBe("CV总榜");
  await page.getByRole("tab", { name: "勤劳", exact: true }).click();
  await expect.poll(() => logs.at(-1)).toBe("CV勤劳榜");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => logs.at(-1)).toBe("CV榜");
  await page.getByRole("tab", { name: "新品榜", exact: true }).click();
  await expect.poll(() => logs.at(-1)).toBe("新品榜");
  await page.getByRole("tab", { name: "畅销榜", exact: true }).click();
  await expect.poll(() => logs.at(-1)).toBe("畅销榜");
  await page.setViewportSize({ width: 375, height: 900 });
  await expect.poll(() => [...logs]).toEqual(["新品日榜", "新品周榜", "CV总榜", "CV勤劳榜", "CV榜", "新品榜", "畅销榜", "畅销周榜"]);
});

test("labor ranks keep series-first metrics and independent dates on both platforms", async ({ page }, testInfo) => {
  await page.addInitScript((version) => {
    window.localStorage.setItem("missevan-changelog-seen-version", version);
  }, appVersion);
  const payload = {
    success: true, schemaVersion: 8, updatedAt: "2026-11-13T12:00:00Z",
    cvSummary: { updatedAt: "2026-11-06T12:00:00Z" },
    platforms: Object.fromEntries(["missevan", "manbo"].map((platform) => [platform, {
      key: platform, label: platform === "manbo" ? "漫播" : "猫耳", categories: [{ key: "cv", label: "CV榜", ranks: [
        ...["cv", "cv-paid"].map((key) => ({ key, label: key === "cv" ? "总榜" : "付费榜", name: key === "cv" ? "CV总榜" : "CV付费榜", fetchedAt: "2026-11-06T12:00:00Z", items: [] })),
        { key: "cv-series-count", label: "勤劳榜", name: "CV勤劳榜", fetchedAt: platform === "manbo" ? "2026-11-12T12:00:00Z" : "2026-11-13T12:00:00Z", items: [{
          cvName: "勤劳CV", rank: 1, seriesCount: 48, totalViewCount: 123456789,
          works: [{ platform, dramaId: "101", title: "勤劳作品", viewCount: 100, mainCvs: ["勤劳CV"] }],
        }, ...Array.from({ length: 31 }, (_, index) => ({
          cvName: `并列CV${index + 1}`, rank: index < 28 ? index + 2 : 30,
          seriesCount: index < 28 ? 47 - index : 10, totalViewCount: null, works: [],
        }))] },
      ] }],
    }])),
  };
  await page.route("**/ranks?**", (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "X-Backend-Version": appVersion }, body: JSON.stringify(payload),
  }));
  for (const platform of ["missevan", "manbo"]) {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?view=ranks&platform=${platform}&category=cv&rank=cv-series-count`);
      const rankSection = page.locator("section:visible").filter({ has: page.getByRole("heading", { name: /^CV勤劳榜/ }) }).last();
      await expect(rankSection).toBeVisible();
      await expect(rankSection.getByText("32 位 CV", { exact: true })).toBeVisible();
      await expect(rankSection.getByLabel("系列数: 48", { exact: true })).toBeVisible();
      await expect(rankSection.getByLabel("总播放量: 1.23亿", { exact: true })).toBeVisible();
      await expect(rankSection.getByText(/周增/)).toHaveCount(0);
      await expect(rankSection.getByRole("button", { name: "查看勤劳CV趋势" })).toHaveCount(0);
      await expect(rankSection.getByText(new RegExp(platform === "manbo" ? "更新：.*2026-11-12" : "更新：.*2026-11-13"))).toBeVisible();
      if (width >= 1024) {
        for (const name of ["CV总榜", "CV付费榜"]) {
          const playbackSection = page.locator("section:visible").filter({ has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) }).last();
          await expect(playbackSection.getByText(/更新：.*2026-11-06/)).toBeVisible();
        }
      }
      const metricOrder = await rankSection.evaluate((section) => {
        const count = section.querySelector('[aria-label="系列数: 48"]');
        const playback = section.querySelector('[aria-label="总播放量: 1.23亿"]');
        return count.getBoundingClientRect().top < playback.getBoundingClientRect().top;
      });
      expect(metricOrder).toBe(true);
      const lastTiedCv = rankSection.getByRole("button", { name: "并列CV31", exact: true });
      await lastTiedCv.scrollIntoViewIfNeeded();
      await expect(lastTiedCv).toBeVisible();
      await rankSection.getByRole("button", { name: "勤劳CV", exact: true }).scrollIntoViewIfNeeded();
      await rankSection.getByRole("button", { name: "展开勤劳CV作品列表" }).click();
      await expect(rankSection.getByRole("button", { name: "勤劳作品", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`labor-${platform}-${width}.png`), fullPage: false });
    }
  }
});

test("CV rank series cards expand inline at all viewport widths", async ({ page }, testInfo) => {
  await page.addInitScript((version) => {
    window.localStorage.setItem("missevan-changelog-seen-version", version);
  }, appVersion);
  const works = [
    { platform: "missevan", dramaId: "101", title: "榜单第一季", viewCount: 5000, mainCvs: ["CV甲", "CV乙"], seriesId: "rank-series", seriesTitle: "榜单系列" },
    { platform: "missevan", dramaId: "102", title: "榜单第二季", viewCount: 4000, mainCvs: ["CV乙", "CV丙"], seriesId: "rank-series", seriesTitle: "榜单系列" },
    { platform: "missevan", dramaId: "103", title: "榜单单部", viewCount: 3000, mainCvs: ["CV甲"] },
  ];
  await page.route("**/ranks?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      schemaVersion: 6,
      updatedAt: "2026-10-10",
      platforms: { missevan: { key: "missevan", label: "猫耳", categories: [{ key: "cv", label: "CV榜", ranks: [{ key: "cv", name: "CV总榜", label: "总榜", items: [{ cvName: "CV甲", rank: 1, totalViewCount: 12000, seriesCount: 2, workCount: 3, works }] }] }] } },
    }),
  }));
  for (const width of [376, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=ranks&platform=missevan&category=cv&rank=cv");
    await page.getByRole("button", { name: "展开CV甲作品列表" }).click();
    const seriesCard = page.locator('[data-cv-series="rank-series"]');
    await expect(seriesCard.getByText("CV甲、CV乙、CV丙", { exact: true })).toBeVisible();
    const before = await seriesCard.boundingBox();
    await page.getByRole("button", { name: "展开系列榜单系列" }).click();
    const panel = page.locator('[data-cv-series-panel]');
    await expect(panel).toHaveAttribute("data-cv-series-panel", "inline");
    await expect(page.getByRole("button", { name: "榜单第一季", exact: true })).toBeVisible();
    const after = await seriesCard.boundingBox();
    expect(after.height).toBeGreaterThan(before.height);
    const typography = await seriesCard.evaluate((card) => {
      const properties = (element) => {
        const style = getComputedStyle(element);
        return [style.fontSize, style.fontWeight, style.color];
      };
      const summary = card.firstElementChild;
      const details = card.querySelector("[data-cv-series-panel]");
      const idRow = details.querySelector('[aria-label="作品ID：101"]');
      const icon = idRow.firstElementChild.getBoundingClientRect();
      const id = idRow.lastElementChild.getBoundingClientRect();
      return {
        seriesCv: properties(summary.querySelector('[title^="主役CV："] span')),
        workCv: properties(details.querySelector('svg[aria-label="主役CV"] + span')),
        seriesPlayback: properties(summary.querySelector('[aria-label^="系列总播放量："] > span')),
        workPlayback: properties(details.querySelector('svg[aria-label="播放量"] + span')),
        idAlignment: Math.abs(icon.y + icon.height / 2 - id.y - id.height / 2),
        idLinks: idRow.querySelectorAll("a").length,
      };
    });
    expect(typography.seriesCv).toEqual(typography.workCv);
    expect(typography.seriesPlayback).toEqual(typography.workPlayback);
    expect(typography.idAlignment).toBeLessThanOrEqual(1);
    expect(typography.idLinks).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`cv-rank-series-${width}.png`), fullPage: false });
    await page.mouse.click(2, 200);
    await expect(page.getByRole("button", { name: "展开系列榜单系列" })).toHaveAttribute("aria-expanded", "false");
  }
});
