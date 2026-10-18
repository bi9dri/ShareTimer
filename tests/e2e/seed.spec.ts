import { test, expect } from "@playwright/test";

test("seed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "セッションを作成" }).click();

  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{21}$/);
  await expect(page.locator("#status-label")).toHaveText("待機中");
  await expect(page.locator("#admin")).toBeVisible();
});
