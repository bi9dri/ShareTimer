import { expect, test } from "@playwright/test";

import { createSession } from "./fixtures";

test.describe("landing", () => {
  test("creates a session and becomes the administrator", async ({ page }) => {
    const { id, adminToken } = await createSession(page);

    expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(page.locator("#admin")).toBeVisible();
  });

  test("keeps the administrator role across a reload", async ({ page }) => {
    await createSession(page);
    await page.reload();

    await expect(page.locator("#admin")).toBeVisible();
    await expect(page.locator("#status-label")).toHaveText("待機中");
  });

  test("treats a visitor without a token as a viewer", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const { id } = await createSession(adminPage);

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`/s/${id}`);

    await expect(viewerPage.locator("#admin")).toBeHidden();
    await expect(viewerPage.locator("#remaining")).toHaveText("--:--");
    await expect(viewerPage.locator("#status-label")).toHaveText("待機中");

    await adminContext.close();
    await viewerContext.close();
  });

  test("shows a not-found page for an unknown session", async ({ page }) => {
    await page.goto("/s/aaaaaaaaaaaaaaaaaaaaa");

    await expect(page.getByText("セッションが見つかりません")).toBeVisible();
    await expect(page.locator("#admin")).toHaveCount(0);
  });

  test("shows a not-found page for a malformed session id", async ({ page }) => {
    await page.goto("/s/not-a-session-id");

    await expect(page.getByText("セッションが見つかりません")).toBeVisible();
  });

  test("reports a live connection to the session", async ({ page }) => {
    await createSession(page);

    await expect(page.locator("#connection")).toHaveAttribute("data-status", "online");
    await expect(page.locator("#connection")).toHaveText("同期済み");
  });

  test("reveals the connection state only on hover", async ({ page }) => {
    await createSession(page);
    const tip = page.locator("#connection-label");
    const opacity = () => tip.evaluate((el) => getComputedStyle(el).opacity);

    expect(await opacity()).toBe("0");

    await page.locator("#connection").hover();
    await expect.poll(opacity).toBe("1");
  });

  test("serves the app shell for a session url", async ({ page }) => {
    const { id } = await createSession(page);
    await page.goto(`/s/${id}`);

    await expect(page).toHaveTitle("ShareTimer");
    await expect(page.locator("#share-url")).toHaveValue(new RegExp(`/s/${id}$`));
  });

  test("writes absolute urls into the social meta tags", async ({ page, baseURL }) => {
    const { id } = await createSession(page);
    const url = `${baseURL}/s/${id}`;
    const meta = (name: string) =>
      page.locator(`meta[property="${name}"]`).getAttribute("content");

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url);
    expect(await meta("og:url")).toBe(url);
    expect(await meta("og:image")).toBe(`${baseURL}/og-image.png`);
    expect(await page.content()).not.toContain("{{");
  });
});
