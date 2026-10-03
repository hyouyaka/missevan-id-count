import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const candidates = [
  { key: "missevan:123", type: "drama", platform: "missevan", id: "123", name: "魔道祖师", contentTypeLabel: "广播剧", cover: "https://example.com/cover.jpg", mainCvNames: ["张福正", "孙睿扬"] },
  { key: "manbo:1467142227078676553", type: "drama", platform: "manbo", id: "1467142227078676553", name: "魔道祖师", contentTypeLabel: "有声剧" },
  { key: "missevan:124", type: "drama", platform: "missevan", id: "124", name: "魔道祖师特别长名称测试第二季下篇特别广播剧", contentTypeLabel: "广播剧" },
  { key: "cv:1", type: "cv", name: "路知行", profileId: "mapped:1", avatar: "https://example.com/avatar.jpg" },
  { key: "cv:2", type: "cv", name: "路知行", profileId: "mapped:2" },
];
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "X-Backend-Version": version }, body: JSON.stringify(body) });

async function setup(page) {
  const calls = { suggestions: 0, searches: 0, cardBodies: [], profiles: [], usageBodies: [] };
  await page.addInitScript((appVersion) => localStorage.setItem("missevan-changelog-seen-version", appVersion), version);
  await page.route("**/search-suggestions?**", (route) => {
    calls.suggestions++;
    return json(route, { suggestions: candidates });
  });
  await page.route("**/image-proxy?**", (route) => route.fulfill({
    status: 200, contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#a3bdce"/><circle cx="32" cy="26" r="13" fill="#e0eaf0"/><path d="M10 64 Q32 20 54 64" fill="#e0eaf0"/></svg>',
  }));
  await page.route("**/unified-search?**", (route) => {
    calls.searches++;
    return json(route, { results: {
      missevan: { success: true, results: [{ id: 123, name: "魔道祖师", content_type_label: "广播剧" }], meta: { matchedCount: 1 } },
      manbo: { success: false, results: [] }, cv: { success: false, results: [] },
    } });
  });
  await page.route("**/getdramacards?**", (route) => {
    const body = route.request().postDataJSON();
    calls.cardBodies.push(body);
    const platform = route.request().url().includes("/manbo/") ? "manbo" : "missevan";
    const id = platform === "manbo" ? body.items[0].raw : body.drama_ids[0];
    const candidate = candidates.find((item) => item.platform === platform && item.id === id);
    return json(route, { success: true, results: [{ id, name: candidate.name, platform, content_type_label: candidate.contentTypeLabel }] });
  });
  await page.route("**/cv-profile?**", (route) => {
    calls.profiles.push(new URL(route.request().url()).searchParams.get("cvKey"));
    return json(route, { success: true, cv: { name: "路知行", avatar: "" }, stats: {}, works: [] });
  });
  await page.route("**/search-card-metrics?**", (route) => json(route, { success: true, metrics: {} }));
  await page.route("**/ranks/trends/availability?**", (route) => json(route, { success: true, ids: [] }));
  await page.route("**/usage-log?**", (route) => {
    calls.usageBodies.push(route.request().postDataJSON());
    return json(route, { success: true });
  });
  await page.goto("/tool");
  return calls;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 480 }]) {
  test(`suggestion layout and keyboard search at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls = await setup(page);
    const input = page.getByRole("combobox");
    await input.fill("魔");
    const list = page.getByRole("listbox", { name: "搜索联想" });
    await expect(list).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(5);
    await expect(page.getByAltText("魔道祖师封面")).toBeVisible();
    await expect(page.getByText("张福正，孙睿扬")).toBeVisible();
    const thumbnailBounds = await page.getByAltText("魔道祖师封面").boundingBox();
    expect(thumbnailBounds.height).toBeGreaterThanOrEqual(52);
    expect(thumbnailBounds.height).toBeLessThanOrEqual(56);
    await expect(input).not.toHaveAttribute("aria-activedescendant");
    const bounds = await list.boundingBox();
    const inputBounds = await input.boundingBox();
    expect(Math.abs(bounds.width - inputBounds.width)).toBeLessThan(2);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).include("form").analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`suggestions-${viewport.width}.png`) });
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(input).toHaveValue("魔道祖师");
    await expect(list).toHaveCount(0);
    expect(calls.searches).toBe(0);
    await input.press("Enter");
    await expect.poll(() => calls.searches).toBe(1);
    expect(calls.cardBodies).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

test("click opens a drama card by ID and CV navigation keeps its identity", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  const calls = await setup(page);
  const input = page.getByRole("combobox");
  await input.fill("魔");
  await expect(input).toBeFocused();
  await page.getByRole("option", { name: "魔道祖师，猫耳，广播剧", exact: true }).click();
  await expect(input).not.toBeFocused();
  await expect.poll(() => calls.cardBodies.length).toBe(1);
  expect(calls.cardBodies[0].drama_ids).toEqual(["123"]);
  expect(calls.cardBodies[0]).toMatchObject({
    usageAction: "search_suggestion_open_search_result", source: "search_suggestion",
  });
  expect(calls.searches).toBe(0);
  await expect(page).toHaveURL(/view=search/);
  await expect(page.getByText("魔道祖师", { exact: true }).first()).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await input.fill("路");
  await page.getByRole("option", { name: "路知行，CV" }).nth(1).click();
  await expect(input).not.toBeFocused();
  await expect(page).toHaveURL(/view=cv/);
  expect(new URL(page.url()).searchParams.get("cvKey")).toBe("mapped:2");
  await expect.poll(() => calls.usageBodies.some((body) => (
    body.action === "cv_profile_open" && body.source === "search_suggestion" && body.cvName === "路知行"
  ))).toBe(true);
  await expect(input).toHaveValue("");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("successive suggestion clicks clear the input even when the route stays unchanged", async ({ page }) => {
  const calls = await setup(page);
  const input = page.getByRole("combobox");
  for (const candidate of [candidates[0], candidates[2], candidates[1], candidates[1]]) {
    const previousCount = calls.cardBodies.length;
    await input.fill("魔");
    await page.getByRole("option", { name: `${candidate.name}，${candidate.platform === "manbo" ? "漫播" : "猫耳"}，${candidate.contentTypeLabel}`, exact: true }).click();
    await expect.poll(() => calls.cardBodies.length).toBe(previousCount + 1);
    expect(calls.cardBodies[previousCount]).toMatchObject({
      usageAction: "search_suggestion_open_search_result", source: "search_suggestion",
    });
    await expect(page.getByText(candidate.name, { exact: true }).first()).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(input).not.toBeFocused();
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
  expect(calls.searches).toBe(0);
});

test("browser composition, escape, clear and imports do not accidentally submit", async ({ page }) => {
  const calls = await setup(page);
  const input = page.getByRole("combobox");
  await input.focus();
  await input.dispatchEvent("compositionstart");
  await input.fill("魔");
  await input.press("Enter");
  expect(calls.searches).toBe(0);
  expect(calls.suggestions).toBe(0);
  await input.dispatchEvent("compositionend", { data: "魔" });
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await input.fill("魔道");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("button", { name: "清空输入" }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const before = calls.suggestions;
  await input.fill("https://www.missevan.com/mdrama/123");
  // A visible help popover forces a render after the debounce window without submitting.
  await page.getByRole("button", { name: "搜索语法说明" }).click();
  await expect(page.locator("#search-syntax-help")).toBeVisible();
  expect(calls.suggestions).toBe(before);
});
