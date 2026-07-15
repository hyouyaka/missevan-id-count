import { expect, test } from "@playwright/test";

test("web app loads the tool shell", async ({ page }) => {
  await page.goto("/tool");
  await expect(page).toHaveTitle("小猫小狐数据分析");
  await expect(page.locator("#app")).toBeVisible();
});
