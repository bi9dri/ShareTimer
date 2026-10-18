import { expect, type Page } from "@playwright/test";

export interface CreatedSession {
  id: string;
  adminToken: string;
}

export async function createSession(page: Page): Promise<CreatedSession> {
  await page.goto("/");
  await page.getByRole("button", { name: "セッションを作成" }).click();
  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{21}$/);

  const id = new URL(page.url()).pathname.split("/").pop()!;
  const adminToken = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    `sharetimer:${id}`,
  );
  expect(adminToken).not.toBeNull();
  return { id, adminToken: adminToken! };
}

export function remainingText(page: Page) {
  return page.locator("#remaining");
}

export function sessionRoot(page: Page) {
  return page.locator("#session");
}

export async function setDurationInput(
  page: Page,
  minutes: string,
  seconds: string,
): Promise<void> {
  await page.locator("#duration-minutes").fill(minutes);
  await page.locator("#duration-seconds").fill(seconds);
}

export async function startTimer(page: Page, minutes: string, seconds: string): Promise<void> {
  await setDurationInput(page, minutes, seconds);
  await page.getByRole("button", { name: "スタート" }).click();
}
