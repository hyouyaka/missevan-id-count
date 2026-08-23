import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const appVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

test("web app loads the tool shell", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/tool");
  await expect(page).toHaveTitle("小猫小狐工具箱");
  await expect(page.locator("#app")).toBeVisible();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByRole("heading", { name: "一周内更新" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("P1 search deep link, compact action hierarchy, and drawer work responsively", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  let unifiedSearchRequests = 0;

  await page.addInitScript((version) => {
    window.localStorage.setItem("missevan-changelog-seen-version", version);
  }, appVersion);
  await page.route("**/unified-search?**", (route) => {
    unifiedSearchRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: {
          missevan: {
            success: true,
            results: [
              { id: 123, sound_id: 456, name: "深海测试剧", author: "测试原作", main_cv_text: "主要CV：测试声优", needpay: true },
              { id: 124, sound_id: 457, name: "深海测试剧 第二季", author: "测试原作", main_cv_text: "主要CV：测试声优" },
              { id: 125, sound_id: 458, name: "深海测试剧 第三季", author: "测试原作", main_cv_text: "主要CV：测试声优" },
            ],
            meta: { matchedCount: 3, nextOffset: 3, hasMore: false },
          },
          manbo: {
            success: true,
            results: [
              { id: "mb-123", name: "漫播深海测试剧", author: "测试原作", main_cv_text: "主要CV：测试声优" },
              { id: "mb-124", name: "漫播深海测试剧 第二季", author: "测试原作", main_cv_text: "主要CV：测试声优" },
              { id: "mb-125", name: "漫播深海测试剧 第三季", author: "测试原作", main_cv_text: "主要CV：测试声优" },
            ],
            meta: { matchedCount: 3, nextOffset: 3, hasMore: false },
          },
          cv: { success: true, results: [], meta: { matchedCount: 0, exactMatch: false } },
        },
      }),
    });
  });
  await page.route("**/search-card-metrics**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, metrics: { play_count: 1200, follow_count: 30 } }),
  }));
  await page.route("**/ranks/trends/availability?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, ids: ["123", "mb-123"] }),
  }));

  try {
    await page.goto("/?view=search&q=%E6%B7%B1%E6%B5%B7%20test%EF%BC%8Cdemo&platform=missevan");
    await expect(page.locator("span:visible").filter({ hasText: /^深海测试剧$/ }).first()).toBeVisible();
    expect(new URL(page.url()).searchParams.get("q")).toBe("深海 test，demo");
    expect(unifiedSearchRequests).toBe(1);

    const searchInput = page.getByPlaceholder("请输入关键词、ID、分享链接。");
    const searchHelpButton = page.getByRole("button", { name: "搜索语法说明" });
    await searchInput.focus();
    await expect(page.locator("#search-syntax-help")).toHaveCount(0);
    await searchHelpButton.click();
    await expect(page.locator("#search-syntax-help")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(searchHelpButton).toBeFocused();

    await expect(page.getByRole("switch", { name: "切换当前作品全选" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "切换当前作品付费分集" })).toHaveCount(0);

    const importButton = page.getByRole("button", { name: "导入分集" }).first();
    const moreButton = page.getByRole("button", { name: "深海测试剧更多操作" });
    for (const [control, label] of [[importButton, "导入"], [moreButton, "更多"]]) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBe(32);
      expect((await control.textContent())?.trim()).toBe(label);
    }

    await moreButton.click();
    await expect(page.getByRole("menu")).toBeVisible();
    const menuLabels = (await page.getByRole("menuitem").allTextContents()).map((label) => label.trim());
    expect(menuLabels).toEqual(["收藏", "对比", "收益", "猫耳收听"]);
    for (const item of await page.getByRole("menuitem").all()) {
      expect((await item.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");
    await expect(moreButton).toBeFocused();

    await page.locator('[role="tab"][data-platform="manbo"]').click();
    await expect(page.locator("span:visible").filter({ hasText: /^漫播深海测试剧$/ }).first()).toBeVisible();
    await expect.poll(() => unifiedSearchRequests).toBe(1);
    expect(new URL(page.url()).searchParams.get("platform")).toBe("manbo");

    const resultTabs = page.locator('[data-slot="tabs-list"]').filter({
      has: page.locator('[data-platform="missevan"]'),
    });
    const tabsBox = await resultTabs.boundingBox();
    const cvTabBox = await resultTabs.locator('[role="tab"][data-platform="cv"]').boundingBox();
    expect((cvTabBox?.x ?? 0) + (cvTabBox?.width ?? 0)).toBeLessThanOrEqual((tabsBox?.x ?? 0) + (tabsBox?.width ?? 0) + 1);

    for (const { width, height } of [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const brandTitle = page.locator("h1");
    await page.evaluate(() => {
      const scrollFixture = document.createElement("div");
      scrollFixture.dataset.testid = "mobile-scroll-fixture";
      scrollFixture.style.height = "1000px";
      document.body.append(scrollFixture);
      window.scrollTo(0, 500);
    });
    await expect.poll(() => page.locator("h1").evaluate((element) => element.getBoundingClientRect().bottom < 0)).toBe(true);
    await expect.poll(() => page.locator("div.sticky").evaluate((element) => Math.abs(element.getBoundingClientRect().top) <= 1)).toBe(true);

    await searchInput.focus();
    await page.setViewportSize({ width: 390, height: 430 });
    const keyboardLayout = await page.evaluate(() => {
      const input = document.querySelector('input[placeholder="请输入关键词、ID、分享链接。"]')?.getBoundingClientRect();
      const menu = document.querySelector('button[aria-label="打开菜单"]')?.getBoundingClientRect();
      return {
        visible: Boolean(input && menu && input.top >= 0 && input.bottom <= innerHeight && menu.top >= 0 && menu.bottom <= innerHeight),
        separated: Boolean(input && menu && input.right <= menu.left),
      };
    });
    expect(keyboardLayout).toEqual({ visible: true, separated: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    const menuButton = page.getByRole("button", { name: "打开菜单" });
    await menuButton.click();
    await expect(page.getByRole("dialog", { name: "主菜单" })).toBeVisible();
    await expect(page.getByText("计算与统计", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "漫播", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "猫耳", exact: true })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "猫耳", exact: true }).click();
    await expect(page.getByRole("button", { name: "猫耳", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "漫播", exact: true })).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "主菜单" })).toHaveCount(0);
    await expect(menuButton).toBeFocused();
  } finally {
    await context.close();
  }
});
