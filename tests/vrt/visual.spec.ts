import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

const FIXED_SESSION_ID = "V1StGXR8_Z5jdHi6B-myT";

interface Session {
  id: string;
  adminToken: string;
}

async function createSession(request: APIRequestContext): Promise<Session> {
  const response = await request.post("/api/sessions");
  expect(response.status()).toBe(201);
  return (await response.json()) as Session;
}

async function postOp(
  request: APIRequestContext,
  session: Session,
  data: unknown,
): Promise<void> {
  const response = await request.post(`/api/sessions/${session.id}/ops`, {
    headers: { authorization: `Bearer ${session.adminToken}` },
    data,
  });
  expect(response.ok()).toBe(true);
}

async function openAsAdmin(page: Page, session: Session): Promise<void> {
  await page.addInitScript(
    ({ key, token }) => window.localStorage.setItem(key, token),
    { key: `sharetimer:${session.id}`, token: session.adminToken },
  );
  await page.goto(`/s/${session.id}`);
}

async function waitForLive(page: Page): Promise<void> {
  await expect(page.locator("#connection")).toHaveAttribute("data-status", "online");
}

async function pinShareUrl(page: Page): Promise<void> {
  const { origin } = new URL(page.url());
  await page.locator("#share-url").evaluate(
    (input, value) => {
      (input as HTMLInputElement).value = value;
    },
    `${origin}/s/${FIXED_SESSION_ID}`,
  );
}

test("landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "セッションを作成" })).toBeVisible();

  await expect(page).toHaveScreenshot("landing.png", { fullPage: true });
});

test("session idle as administrator", async ({ page, request }) => {
  const session = await createSession(request);
  await openAsAdmin(page, session);
  await waitForLive(page);
  await expect(page.locator("#session")).toHaveAttribute("data-status", "idle");
  await expect(page.locator("#admin")).toBeVisible();
  await pinShareUrl(page);

  await expect(page).toHaveScreenshot("session-idle.png", { fullPage: true });
});

test("session paused as administrator", async ({ page, request }) => {
  const session = await createSession(request);
  await postOp(request, session, { type: "set", durationMs: 3_600_000 });
  await postOp(request, session, { type: "pause" });

  await openAsAdmin(page, session);
  await waitForLive(page);
  await expect(page.locator("#session")).toHaveAttribute("data-status", "paused");
  await expect(page.locator("#remaining")).toHaveText("1:00:00");
  await pinShareUrl(page);

  await expect(page).toHaveScreenshot("session-paused.png", { fullPage: true });
});

test("not found page", async ({ page }) => {
  await page.goto("/s/aaaaaaaaaaaaaaaaaaaaa");
  await expect(page.getByText("セッションが見つかりません")).toBeVisible();

  await expect(page).toHaveScreenshot("not-found.png", { fullPage: true });
});
