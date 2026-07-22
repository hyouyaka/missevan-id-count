import { expect, test } from "@playwright/test";

test("web app loads the tool shell", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/tool");
  await expect(page).toHaveTitle("小猫小狐数据分析");
  await expect(page.locator("#app")).toBeVisible();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByRole("heading", { name: "一周内更新" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
