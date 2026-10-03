import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const titles = { missevan: "桌面猫耳测试剧", manbo: "桌面漫播测试剧" };
const ids = { missevan: "123", manbo: "456" };

async function mockDesktop(page, { taskStatus = "completed" } = {}) {
  const tasks = new Map();
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "mmToolkit", { value: Object.freeze({ desktopApp: true }) });
    window.desktopStorageAccesses = [];
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (/histor|favorite/i.test(key)) window.desktopStorageAccesses.push(key);
      return original.call(this, key);
    };
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      window.desktopStorageAccesses.push(`indexedDB:${args[0]}`);
      return open(...args);
    };
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname === "/app-config") return reply({ desktopApp: true, missevanEnabled: true, feedbackEnabled: false, frontendVersion: version, backendVersion: version });
    if (/^\/(favorites|desktop|cv-profile|ranks|ongoing|feedback|usage-log|register-new-drama-ids)(\/|$)/.test(url.pathname)) {
      requests.push({ forbidden: url.pathname });
      return reply({ error: "removed" }, 404);
    }
    if (url.pathname === "/unified-search") return reply({ success: true, results: Object.fromEntries([
      ...["missevan", "manbo"].map((platform) => [platform, {
        success: true, results: [{ id: ids[platform], name: titles[platform], platform, sound_id: 789, needpay: true, price: 10 }],
        meta: { matchedCount: 1, nextOffset: 1, hasMore: false },
      }]), ["cv", { success: false, results: [], meta: { matchedCount: 0 } }],
    ]) });
    if (url.pathname === "/search-card-metrics") return reply({ success: true, metrics: { play_count: 1234, follow_count: 12 } });
    if (["/getdramacards", "/manbo/getdramacards"].includes(url.pathname)) {
      const platform = url.pathname.startsWith("/manbo") ? "manbo" : "missevan";
      requests.push({ importPlatform: platform, items: request.postDataJSON().items });
      return reply({ success: true, results: [{ id: ids[platform], name: titles[platform], platform, sound_id: 789, needpay: true }] });
    }
    if (["/getdramas", "/manbo/getdramas"].includes(url.pathname)) {
      const platform = url.pathname.startsWith("/manbo") ? "manbo" : "missevan";
      return reply([{ id: ids[platform], success: true, info: {
        drama: { id: ids[platform], name: titles[platform], view_count: 1234, price: 10 },
        episodes: { episode: [{ sound_id: 789, name: "第一集", needpay: 1, price: 10, duration: 100, view_count: 1234 }] },
      } }]);
    }
    if (url.pathname === "/stat-tasks" && request.method() === "POST") {
      const body = request.postDataJSON();
      const taskId = `task-${tasks.size + 1}`;
      tasks.set(taskId, body);
      requests.push(body);
      return reply({ taskId, taskType: body.taskType, platform: body.platform, status: "queued", progress: 0 });
    }
    if (url.pathname.startsWith("/stat-tasks/")) {
      const taskId = url.pathname.split("/")[2];
      if (url.pathname.endsWith("/cancel")) {
        requests.push({ cancelTaskId: taskId });
        return reply({ taskId, status: "cancelled" });
      }
      if (taskStatus === "running") return reply({ taskId, status: "running", progress: 20, currentAction: "测试任务运行中" });
      const body = tasks.get(taskId);
      const title = titles[body.platform];
      const result = body.taskType === "id"
        ? { idResults: [{ dramaId: ids[body.platform], title, selectedEpisodeCount: 1, danmaku: 25, users: 10 }], idSelectedEpisodeCount: 1 }
        : body.taskType === "play_count"
          ? { playCountResults: [{ title, selectedEpisodeCount: 1, playCountTotal: 1234 }], playCountSelectedEpisodeCount: 1, playCountTotal: 1234 }
          : { revenueResults: [{ platform: body.platform, dramaId: ids[body.platform], title, subtitle: "收益测试", revenueType: "season", totalRevenue: 100, paidUserCount: 10, rewardTotal: 0, viewCount: 1234 }] };
      return reply({ taskId, status: "completed", progress: 100, currentAction: "统计完成", totalDanmaku: 25, totalUsers: 10, result });
    }
    return route.continue();
  });
  return { tasks, requests, errors };
}

test("desktop searches both platforms and completes all three statistics without legacy features", async ({ page }) => {
  const state = await mockDesktop(page);
  await page.goto("/tool?view=favorites&cv=old-profile");
  const input = page.getByPlaceholder("请输入关键词、ID、分享链接。");
  await expect(input).toBeVisible();
  await input.fill("桌面测试");
  await input.press("Enter");
  for (const platform of ["missevan", "manbo"]) {
    await page.locator(`[role="tab"][data-platform="${platform}"]`).click();
    await expect(page.getByText(titles[platform], { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "导入分集", exact: true }).first().click();
    await expect(page.getByText("第一集", { exact: true }).first()).toBeVisible();
    await page.getByRole("switch", { name: "切换全选付费", exact: true }).click();
    for (const [label, taskType] of [["统计弹幕 ID", "id"], ["统计播放量", "play_count"], ["收益预估", "revenue"]]) {
      const before = state.tasks.size;
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect.poll(() => state.tasks.size).toBe(before + 1);
      expect([...state.tasks.values()].at(-1)).toMatchObject({ platform, taskType });
      await expect(page.getByText("已完成", { exact: true })).toBeVisible();
    }
  }
  expect(state.requests.filter((request) => request.forbidden)).toEqual([]);
  expect(await page.evaluate(() => window.desktopStorageAccesses)).toEqual([]);
  expect(state.errors).toEqual([]);
  await expect(page.locator('[data-platform="cv"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开菜单" })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("cv")).toBeNull();
});

for (const accessDenied of [true, false]) {
  test(`desktop episode import reports ${accessDenied ? "access denial" : "item failure"} without a misleading paid warning`, async ({ page }) => {
    const state = await mockDesktop(page);
    await page.route("**/getdramas?**", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: ids.missevan, success: false, accessDenied }]),
    }));
    await page.goto("/tool");
    const input = page.getByPlaceholder("请输入关键词、ID、分享链接。");
    await input.fill("桌面测试");
    await input.press("Enter");
    const message = accessDenied
      ? "如果遇到接口受限，请使用任意浏览器打开猫耳首页按提示解锁即可。"
      : `导入作品失败（ID：${ids.missevan}），请稍后重试。`;
    await page.getByRole("button", { name: "导入分集", exact: true }).first().click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "统计付费ID", exact: true }).first().click();
    await expect(page.getByText(message, { exact: true })).toHaveCount(2);
    await expect(page.getByText(message, { exact: true }).last()).toBeVisible();
    await expect(page.getByText("没有可统计的付费分集。", { exact: true })).toHaveCount(0);
    expect(state.tasks.size).toBe(0);
    expect(state.errors).toEqual([]);
  });
}

test("desktop bootstrap errors cannot fall back to the web workspace", async ({ page }) => {
  await mockDesktop(page);
  await page.route("**/app-config?**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/tool");
  await expect(page.getByText("无法读取桌面版入口配置", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开菜单" })).toHaveCount(0);
});

test("desktop routes drama IDs, episode IDs and share links to their platform imports", async ({ page }) => {
  const state = await mockDesktop(page);
  await page.goto("/tool");
  const input = page.getByPlaceholder("请输入关键词、ID、分享链接。");
  for (const [raw, platform] of [
    ["93420", "missevan"],
    ["12681701", "missevan"],
    ["https://www.missevan.com/mdrama/93420?share_channel=copy", "missevan"],
    ["https://www.missevan.com/sound/12681701?share_channel=copy", "missevan"],
    ["1467142227078676553", "manbo"],
    ["https://manbo.hongdoulive.com/Activecard/radioplay?id=1467142227078676553", "manbo"],
  ]) {
    const before = state.requests.length;
    await input.fill(raw);
    await input.press("Enter");
    await expect.poll(() => state.requests.length).toBe(before + 1);
    expect(state.requests.at(-1)).toMatchObject({ importPlatform: platform, items: [{ raw }] });
    await expect(page.getByText(titles[platform], { exact: true }).first()).toBeVisible();
  }
  expect(state.errors).toEqual([]);
  expect(await page.evaluate(() => window.desktopStorageAccesses)).toEqual([]);
});

test("desktop preserves successful platform results when the other platform fails", async ({ page }) => {
  const state = await mockDesktop(page);
  await page.route("**/unified-search?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ success: true, results: {
      missevan: { success: false, error: "upstream unavailable", results: [], meta: { matchedCount: 0 } },
      manbo: { success: true, results: [{ id: ids.manbo, name: titles.manbo, platform: "manbo" }], meta: { matchedCount: 1 } },
      cv: { success: false, results: [], meta: { matchedCount: 0 } },
    } }),
  }));
  await page.goto("/tool");
  const input = page.getByPlaceholder("请输入关键词、ID、分享链接。");
  await input.fill("平台异常测试");
  await input.press("Enter");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toContainText("猫耳");
  await expect(page.getByText(titles.manbo, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("未找到结果，可尝试导入作品ID或链接。", { exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("desktop keeps the latest keyword after search responses and platform switches", async ({ page }) => {
  const state = await mockDesktop(page);
  await page.route("**/unified-search?**", (route) => {
    const keyword = new URL(route.request().url()).searchParams.get("keyword");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results: Object.fromEntries(["missevan", "manbo"].map((platform) => [platform, {
        success: true,
        results: [{ id: ids[platform], name: `${keyword}作品`, platform }],
        meta: { matchedCount: 1, nextOffset: 1, hasMore: false },
      }])) }),
    });
  });
  await page.goto("/tool");
  const input = page.getByPlaceholder("请输入关键词、ID、分享链接。");
  for (const keyword of ["首次关键词", "最新关键词"]) {
    await input.fill(keyword);
    await input.press("Enter");
    await expect(page.getByText(`${keyword}作品`, { exact: true }).first()).toBeVisible();
    await expect(input).toHaveValue(keyword);
    expect(new URL(page.url()).searchParams.get("q")).toBe(keyword);
  }
  await page.locator('[role="tab"][data-platform="manbo"]').click();
  await expect(input).toHaveValue("最新关键词");
  expect(new URL(page.url()).searchParams.get("q")).toBe("最新关键词");
  expect(state.errors).toEqual([]);
});

test("desktop restores valid keyword links into the requested drama platform", async ({ page }) => {
  const state = await mockDesktop(page);
  const searches = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/unified-search") searches.push(url.searchParams.get("keyword"));
  });
  await page.goto("/tool?view=search&platform=manbo&q=%E6%A1%8C%E9%9D%A2%E6%B5%8B%E8%AF%95");
  await expect(page.getByPlaceholder("请输入关键词、ID、分享链接。")).toHaveValue("桌面测试");
  await expect(page.locator('[role="tab"][data-platform="manbo"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(titles.manbo, { exact: true }).first()).toBeVisible();
  expect(searches).toEqual(["桌面测试"]);
  expect(state.errors).toEqual([]);
});

test("web drama searches do not report an unmatched CV category as a platform failure", async ({ page }) => {
  await page.addInitScript((currentVersion) => localStorage.setItem("missevan-changelog-seen-version", currentVersion), version);
  await page.route("**/app-config?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    desktopApp: false, missevanEnabled: true, frontendVersion: version, backendVersion: version,
  }) }));
  await page.route("**/unified-search?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    success: true, results: {
      missevan: { success: true, results: [{ id: ids.missevan, name: titles.missevan, platform: "missevan" }], meta: { matchedCount: 1 } },
      manbo: { success: true, results: [], meta: { matchedCount: 0 } },
      cv: { success: false, results: [], meta: { matchedCount: 0 } },
    },
  }) }));
  await page.route("**/search-card-metrics?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, metrics: {} }) }));
  await page.goto("/tool?view=search&q=%E6%A1%8C%E9%9D%A2%E6%B5%8B%E8%AF%95");
  await expect(page.getByText(titles.missevan, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("desktop distinguishes successful empty searches from platform failures", async ({ page }) => {
  await mockDesktop(page);
  await page.route("**/unified-search?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    success: false, results: Object.fromEntries(["missevan", "manbo"].map((platform) => [platform, {
      success: false, results: [], meta: { matchedCount: 0 },
    }])),
  }) }));
  await page.goto("/tool");
  const input = page.getByPlaceholder("请输入关键词、ID、分享链接。");
  await input.fill("无匹配测试");
  await input.press("Enter");
  await expect(page.getByRole("alertdialog")).toContainText("未找到结果");
  await expect(page.getByRole("alertdialog")).not.toContainText("搜索失败");
});

test("desktop shows matching dramas without reporting an empty platform as failed", async ({ page }) => {
  await mockDesktop(page);
  await page.route("**/unified-search?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    success: true, results: {
      missevan: { success: false, results: [], meta: { matchedCount: 0 } },
      manbo: { success: true, results: [{ id: ids.manbo, name: titles.manbo, platform: "manbo" }], meta: { matchedCount: 1 } },
    },
  }) }));
  await page.goto("/tool?view=search&q=平台空匹配");
  await expect(page.getByText(titles.manbo, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("desktop reload notifies the server to cancel its active task", async ({ page }) => {
  const state = await mockDesktop(page, { taskStatus: "running" });
  await page.goto("/tool?view=search&q=桌面测试");
  await page.getByRole("button", { name: "导入分集", exact: true }).first().click();
  await expect(page.getByText("第一集", { exact: true }).first()).toBeVisible();
  await page.getByRole("switch", { name: "切换全选付费", exact: true }).click();
  await page.getByRole("button", { name: "统计弹幕 ID", exact: true }).click();
  await expect(page.getByText("测试任务运行中", { exact: true })).toBeVisible();
  const taskId = [...state.tasks.keys()][0];
  await page.reload();
  await expect.poll(() => state.requests.some((request) => request.cancelTaskId === taskId)).toBe(true);
  expect(state.tasks.size).toBe(1);
  expect(state.errors).toEqual([]);
});
