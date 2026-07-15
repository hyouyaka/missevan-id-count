import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("tool shell has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/tool");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact)
  );
  expect(seriousViolations).toEqual([]);
});
