import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const favorite = {
  key: "missevan:93038",
  platform: "missevan",
  dramaId: "93038",
  title: "一屋暗灯",
  cover: "",
  paymentLabel: "付费",
  contentTypeLabel: "广播剧",
  dramaUpdatedAt: "2026-08-08T12:30:00.000Z",
  mainCvText: "主要CV：倒霉死勒，袁铭喆",
  createdAt: 1770000000000,
  updatedAt: 1770000000000,
  lastSnapshotAt: 1770000007000,
};

function createSnapshot(offset, overrides = {}) {
  const capturedAt = 1770000000000 + offset * 1000;
  return {
    id: `${favorite.key}:${capturedAt}`,
    favoriteKey: favorite.key,
    platform: favorite.platform,
    dramaId: favorite.dramaId,
    capturedAt,
    status: "success",
    metrics: {
      viewCount: 100000 + offset,
      subscriptionCount: 20000 + offset,
      rewardCount: 300 + offset,
      rewardTotal: 4000 + offset,
      giftTotal: null,
      paidOrListenCount: null,
      paidIdCount: 500 + offset,
    },
    metricErrors: {},
    errors: [],
    ...overrides,
  };
}

const snapshots = [
  createSnapshot(1),
  createSnapshot(2),
  createSnapshot(3),
  createSnapshot(4),
  createSnapshot(5),
  createSnapshot(6, {
    status: "partial",
    metrics: {
      viewCount: 100006,
      subscriptionCount: 20006,
      rewardCount: 306,
      rewardTotal: 4006,
      giftTotal: null,
      paidOrListenCount: null,
      paidIdCount: null,
    },
    metricErrors: { paidIdCount: "付费 ID 读取失败" },
    errors: ["付费 ID 读取失败"],
  }),
  createSnapshot(7, {
    status: "failed",
    metrics: {},
    errors: ["作品详情读取失败"],
  }),
];

async function seedFavorites(page) {
  await page.evaluate(async ({ favoriteRecord, snapshotRecords }) => {
    const db = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open("mm-toolkit-favorites", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["favorites", "snapshots", "settings"], "readwrite");
      transaction.objectStore("favorites").put(favoriteRecord);
      snapshotRecords.forEach((snapshot) => transaction.objectStore("snapshots").put(snapshot));
      transaction.objectStore("settings").put({
        key: "favorites",
        value: { deltaMetric: "viewCount", sortBy: "lastSnapshotAt" },
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, { favoriteRecord: favorite, snapshotRecords: snapshots });
}

test("favorites history switches between a scroll-free mobile timeline and desktop table", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("missevan-changelog-seen-version", "1.7.7");
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/tool?view=favorites");
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.getByRole("heading", { name: "收藏" })).toBeVisible({ timeout: 15_000 });
  await seedFavorites(page);
  await page.reload();
  await expect(page.getByText("一屋暗灯", { exact: true })).toBeVisible();

  const mobileToolbar = page.getByTestId("favorite-mobile-toolbar");
  const primaryToolbarRow = page.getByTestId("favorite-mobile-toolbar-primary");
  const secondaryToolbarRow = page.getByTestId("favorite-mobile-toolbar-secondary");
  const desktopToolbar = page.getByTestId("favorite-desktop-toolbar");
  await expect(mobileToolbar).toBeVisible();
  await expect(primaryToolbarRow).toBeVisible();
  await expect(secondaryToolbarRow).toBeVisible();
  await expect(desktopToolbar).toBeHidden();
  expect(await mobileToolbar.evaluate((element) => getComputedStyle(element).position)).not.toMatch(/fixed|sticky/);
  const mobileSearch = mobileToolbar.getByRole("searchbox", { name: "搜索收藏" });
  await expect(mobileSearch).toBeVisible();
  await expect(mobileToolbar.getByRole("button", { name: "清除搜索" })).toBeDisabled();
  await expect(mobileToolbar.getByRole("combobox", { name: "关注指标：播放量" })).toBeVisible();
  await expect(mobileToolbar.getByRole("combobox", { name: "排序：最近刷新" })).toBeVisible();

  expect((await primaryToolbarRow.boundingBox())?.height).toBe(44);
  expect((await secondaryToolbarRow.boundingBox())?.height).toBe(44);
  const metricBox = await mobileToolbar.getByRole("combobox", { name: "关注指标：播放量" }).boundingBox();
  const sortBox = await mobileToolbar.getByRole("combobox", { name: "排序：最近刷新" }).boundingBox();
  const allSelectLabelBox = await primaryToolbarRow.locator("label").boundingBox();
  const filterBox = await mobileToolbar.getByRole("button", { name: "筛选" }).boundingBox();
  const refreshBox = await mobileToolbar.getByRole("button", { name: "刷新所选 0 部" }).boundingBox();
  const moreBox = await mobileToolbar.getByRole("button", { name: "更多收藏操作" }).boundingBox();
  const narrowSearchBox = await page.getByTestId("favorite-mobile-search-control").boundingBox();
  const refreshLabel = mobileToolbar.locator(".favorite-mobile-refresh-label");
  const touchTargetHeights = [
    narrowSearchBox?.height,
    allSelectLabelBox?.height,
    filterBox?.height,
    refreshBox?.height,
    metricBox?.height,
    sortBox?.height,
    moreBox?.height,
  ];
  expect(touchTargetHeights.every((height) => (height ?? 0) >= 44)).toBe(true);
  expect(refreshBox?.width).toBeCloseTo(44, 1);
  expect(metricBox?.width).toBeCloseTo(sortBox?.width ?? 0, 1);
  await expect(refreshLabel).toBeHidden();
  expect(metricBox?.x).toBeLessThan(sortBox?.x ?? 0);
  expect((moreBox?.x ?? 0) + (moreBox?.width ?? 0)).toBeLessThanOrEqual(320);

  expect(narrowSearchBox?.width).toBeGreaterThanOrEqual(44);
  let previousMetricWidth = metricBox?.width ?? 0;
  for (const width of [390, 418, 454, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const resizedMetricBox = await mobileToolbar.getByRole("combobox", { name: "关注指标：播放量" }).boundingBox();
    const resizedSortBox = await mobileToolbar.getByRole("combobox", { name: "排序：最近刷新" }).boundingBox();
    const resizedSearchBox = await page.getByTestId("favorite-mobile-search-control").boundingBox();
    const resizedAllSelectLabelBox = await primaryToolbarRow.locator("label").boundingBox();
    const resizedFilterBox = await mobileToolbar.getByRole("button", { name: "筛选" }).boundingBox();
    const resizedRefreshBox = await mobileToolbar.getByRole("button", { name: "刷新所选 0 部" }).boundingBox();
    const resizedMoreBox = await mobileToolbar.getByRole("button", { name: "更多收藏操作" }).boundingBox();
    expect(resizedMetricBox?.width).toBeCloseTo(resizedSortBox?.width ?? 0, 1);
    expect(resizedMetricBox?.width ?? 0).toBeGreaterThan(previousMetricWidth);
    expect(resizedAllSelectLabelBox?.width).toBeCloseTo(allSelectLabelBox?.width ?? 0, 1);
    expect(resizedFilterBox?.width).toBeCloseTo(filterBox?.width ?? 0, 1);
    expect(resizedRefreshBox?.width).toBeCloseTo(96, 1);
    expect(resizedMoreBox?.width).toBeCloseTo(moreBox?.width ?? 0, 1);
    expect(resizedSearchBox?.width).toBeGreaterThan(narrowSearchBox?.width ?? 0);
    await expect(refreshLabel).toBeVisible();
    expect(await secondaryToolbarRow.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    previousMetricWidth = resizedMetricBox?.width ?? previousMetricWidth;
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await mobileToolbar.getByRole("combobox", { name: "关注指标：播放量" }).click();
  const mobileMetricListbox = page.getByRole("listbox");
  await expect(mobileMetricListbox).toBeVisible();
  expect((await mobileMetricListbox.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(88);
  expect(await mobileMetricListbox.getByRole("option", { name: "付费/收听人数" }).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await mobileSearch.fill("一屋");
  await mobileToolbar.getByRole("button", { name: "清除搜索" }).click();
  await expect(mobileSearch).toHaveValue("");

  const favoriteTitle = page.getByText("一屋暗灯", { exact: true });
  const cardTopBeforePanel = (await favoriteTitle.boundingBox())?.y;
  const filterTrigger = mobileToolbar.getByRole("button", { name: "筛选" });
  await expect(filterTrigger).not.toContainText("筛选");
  await expect(mobileToolbar.getByRole("button", { name: "更多收藏操作" })).not.toContainText("更多");
  await filterTrigger.click();
  await expect(filterTrigger).toHaveAttribute("aria-expanded", "true");
  const filterPanel = page.locator("#favorite-mobile-filter-panel");
  await expect(filterPanel).toBeVisible();
  const filterPanelBox = await filterPanel.boundingBox();
  const filterTriggerBox = await filterTrigger.boundingBox();
  expect(filterPanelBox?.width).toBeCloseTo(270, 1);
  expect(Math.abs(
    ((filterPanelBox?.x ?? 0) + (filterPanelBox?.width ?? 0))
      - ((filterTriggerBox?.x ?? 0) + (filterTriggerBox?.width ?? 0))
  )).toBeLessThanOrEqual(1);
  expect(Math.abs(
    (filterPanelBox?.y ?? 0) - ((filterTriggerBox?.y ?? 0) + (filterTriggerBox?.height ?? 0))
  )).toBeLessThanOrEqual(1);
  expect((await favoriteTitle.boundingBox())?.y).toBeCloseTo(cardTopBeforePanel ?? 0, 1);
  await expect(filterPanel.locator("[data-platform=missevan]")).toBeVisible();
  await filterTrigger.click();
  await expect(filterPanel).toHaveCount(0);
  await filterTrigger.click();
  await page.getByRole("heading", { name: "收藏" }).click();
  await expect(filterPanel).toHaveCount(0);
  await filterTrigger.click();
  await page.keyboard.press("Escape");
  await expect(filterPanel).toHaveCount(0);
  await expect(filterTrigger).toBeFocused();
  await mobileToolbar.getByRole("button", { name: "更多收藏操作" }).click();
  await expect(filterPanel).toHaveCount(0);
  const morePanel = page.locator("#favorite-mobile-more-panel");
  await expect(morePanel).toBeVisible();
  expect((await morePanel.boundingBox())?.width).toBeCloseTo(160, 1);
  expect((await favoriteTitle.boundingBox())?.y).toBeCloseTo(cardTopBeforePanel ?? 0, 1);
  const importButton = morePanel.getByRole("button", { name: "导入历史" });
  const exportButton = morePanel.getByRole("button", { name: "导出历史" });
  const downloadButton = morePanel.getByRole("button", { name: "下载数据" });
  await expect(importButton).toBeVisible();
  expect((await importButton.boundingBox())?.y ?? 0).toBeLessThan((await exportButton.boundingBox())?.y ?? 0);
  expect((await exportButton.boundingBox())?.y ?? 0).toBeLessThan((await downloadButton.boundingBox())?.y ?? 0);
  await page.getByRole("heading", { name: "收藏" }).click();
  await expect(morePanel).toHaveCount(0);

  await page.getByRole("checkbox", { name: "选择一屋暗灯" }).check();
  await expect(mobileToolbar.getByRole("button", { name: "刷新所选 1 部" })).toContainText("1");
  await mobileToolbar.getByRole("button", { name: "更多收藏操作" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#favorite-mobile-more-panel").getByRole("button", { name: "下载数据" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^mm-toolkit-favorites-history-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.getByRole("button", { name: "历史记录（7）" }).click();
  const timeline = page.locator(".favorite-history-timeline");
  const table = page.locator(".favorite-history-table");
  await expect(timeline).toBeVisible();
  await expect(table).toBeHidden();
  await expect(timeline.locator("li")).toHaveCount(5);
  const firstTimelineBackground = await timeline.locator("li").nth(0).evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  const secondTimelineBackground = await timeline.locator("li").nth(1).evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(firstTimelineBackground).not.toBe(secondTimelineBackground);
  const successColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "color-mix(in oklch, var(--accent-success) 88%, var(--foreground))";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(await timeline.locator(".favorite-history-delta").first().evaluate((element) => getComputedStyle(element).color)).toBe(successColor);

  const failedTrigger = timeline.getByRole("button", { name: "查看失败详情" });
  const failedTriggerBox = await failedTrigger.boundingBox();
  expect(failedTriggerBox?.height).toBeGreaterThanOrEqual(44);
  await failedTrigger.click();
  await expect(timeline.getByText("作品详情读取失败")).toBeVisible();

  for (const width of [320, 390, 418, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(timeline).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  }

  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact)
  );
  expect(seriousViolations).toEqual([]);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(mobileToolbar).toBeHidden();
  await expect(desktopToolbar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(mobileToolbar).toBeHidden();
  await expect(desktopToolbar).toBeVisible();
  await expect(desktopToolbar.getByRole("button", { name: "更多收藏操作" })).toBeVisible();
  await expect(timeline).toBeHidden();
  await expect(table).toBeVisible();
  await expect(table.locator("thead")).toBeVisible();
  const firstTableBackground = await table.locator("tbody tr").nth(0).evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  const secondTableBackground = await table.locator("tbody tr").nth(1).evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(firstTableBackground).not.toBe(secondTableBackground);
  expect(await table.locator(".favorite-history-delta").first().evaluate((element) => getComputedStyle(element).color)).toBe(successColor);
  await expect(table.getByText("失败", { exact: true })).toBeVisible();
});

test("favorite background task details wrap within a 377px viewport", async ({ page }) => {
  const longAction = "正在统计收益：一屋暗灯 / 分集 12/16 / 正在汇总打赏榜与付费用户数据";
  const taskSnapshot = {
    taskId: "favorite-overflow-task",
    status: "running",
    progress: 58,
    currentAction: longAction,
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("missevan-changelog-seen-version", "1.7.7");
  });
  await page.route("**/getdramas**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        success: true,
        info: {
          drama: {
            id: favorite.dramaId,
            name: "吞海 第三季（上）",
            view_count: 100000,
            subscription_num: 20000,
            diamond_value: 0,
          },
          episodes: { episode: [] },
        },
      }]),
    });
  });
  await page.route("**/favorites/meta**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mainCvText: favorite.mainCvText }),
    });
  });
  await page.route("**/stat-tasks**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(taskSnapshot),
    });
  });

  await page.setViewportSize({ width: 377, height: 700 });
  await page.goto("/tool?view=favorites");
  await expect(page.getByRole("heading", { name: "收藏" })).toBeVisible({ timeout: 15_000 });
  await seedFavorites(page);
  await page.reload();
  await page.getByRole("checkbox", { name: "选择一屋暗灯" }).check();
  await page.getByTestId("favorite-mobile-toolbar").getByRole("button", { name: "刷新所选 1 部" }).click();

  const taskCenter = page.locator(".mobile-background-task-center");
  await expect(taskCenter).toBeVisible();
  await taskCenter.getByRole("button", { name: "后台任务中心" }).click();
  const panel = taskCenter.locator(":scope > div.absolute");
  const action = panel.getByText(longAction, { exact: true });
  const progress = panel.getByRole("progressbar");
  await expect(action).toBeVisible();
  await expect(progress).toBeVisible();

  const actionBox = await action.boundingBox();
  const panelBox = await panel.boundingBox();
  const progressBox = await progress.boundingBox();
  expect(actionBox?.height ?? 0).toBeGreaterThan(20);
  expect(progressBox?.x ?? 0).toBeGreaterThanOrEqual(panelBox?.x ?? 0);
  expect((progressBox?.x ?? 0) + (progressBox?.width ?? 0)).toBeLessThanOrEqual(
    (panelBox?.x ?? 0) + (panelBox?.width ?? 0) + 1
  );
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
