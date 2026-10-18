import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { createSession, remainingText, sessionRoot, setDurationInput, startTimer } from "./fixtures";

async function apiState(request: APIRequestContext, id: string): Promise<string> {
  const response = await request.get(`/api/sessions/${id}`);
  const body = (await response.json()) as { state: { status: string } };
  return body.state.status;
}

test.describe("timer", () => {
  test("starts a countdown with the entered duration", async ({ page }) => {
    await createSession(page);
    await expect(page.getByRole("button", { name: "スタート" })).toBeEnabled();

    await startTimer(page, "5", "0");

    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(page.locator("#status-label")).toHaveText("動作中");
    await expect(remainingText(page)).toHaveText(/^0[45]:[0-5]\d$/);
  });

  test("counts down over time", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "1", "0");
    await expect(remainingText(page)).toHaveText(/^(01:00|00:5\d)$/);

    await expect(remainingText(page)).toHaveText(/^00:[0-4]\d$/, { timeout: 20_000 });
  });

  test("starts a timer with second granularity", async ({ page }) => {
    await createSession(page);

    await startTimer(page, "0", "3");

    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(remainingText(page)).toHaveText(/^00:0[23]$/);
    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "true", { timeout: 15_000 });
  });

  test("pauses and resumes without losing time", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "1", "0");

    await page.getByRole("button", { name: "一時停止" }).click();
    await expect(sessionRoot(page)).toHaveAttribute("data-status", "paused");
    await expect(page.locator("#status-label")).toHaveText("一時停止中");

    const frozen = await remainingText(page).textContent();

    await page.getByRole("button", { name: "再開" }).click();
    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(remainingText(page)).toHaveText(frozen!);
  });

  test("extends a running timer by an arbitrary duration", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "1", "0");
    await expect(remainingText(page)).toHaveText(/^(01:00|00:5\d)$/);

    await setDurationInput(page, "0", "30");
    await page.getByRole("button", { name: "延長" }).click();

    await expect(remainingText(page)).toHaveText(/^01:(2[0-9]|30)$/);
    await expect(page.locator("#message")).toBeHidden();
  });

  test("warns when the extension is capped at the maximum duration", async ({ page, request }) => {
    const { id, adminToken } = await createSession(page);

    await request.post(`/api/sessions/${id}/ops`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: { type: "set", durationMs: 86_400_000 },
    });
    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(remainingText(page)).toHaveText(/^2[34]:[0-5]\d:[0-5]\d$/);

    await setDurationInput(page, "1", "0");
    await page.getByRole("button", { name: "延長" }).click();

    await expect(page.locator("#message")).toContainText("これ以上は延長されません");
    await expect(remainingText(page)).toHaveText(/^2[34]:[0-5]\d:[0-5]\d$/);
  });

  test("rejects a duration below one second", async ({ page }) => {
    await createSession(page);

    await setDurationInput(page, "0", "0");
    await page.getByRole("button", { name: "スタート" }).click();

    await expect(sessionRoot(page)).toHaveAttribute("data-status", "idle");
    await expect(page.locator("#message")).toContainText("1 秒以上");
  });

  test("adjusts the duration with the stepper buttons", async ({ page }) => {
    await createSession(page);
    const value = (selector: string) => page.locator(selector).inputValue();

    await page.getByRole("button", { name: "分を1つ増やす" }).click();
    expect(await value("#duration-minutes")).toBe("6");

    await page.getByRole("button", { name: "分を1つ減らす" }).click();
    await page.getByRole("button", { name: "分を1つ減らす" }).click();
    expect(await value("#duration-minutes")).toBe("4");

    await page.getByRole("button", { name: "秒を1つ増やす" }).click();
    expect(await value("#duration-seconds")).toBe("1");

    await page.getByRole("button", { name: "スタート" }).click();
    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(remainingText(page)).toHaveText(/^04:0[01]$/);
  });

  test("carries seconds into the minute field and borrows back out", async ({ page }) => {
    await createSession(page);
    const value = (selector: string) => page.locator(selector).inputValue();

    // 5:00 - 1s -> 4:59
    await page.getByRole("button", { name: "秒を1つ減らす" }).click();
    expect(await value("#duration-minutes")).toBe("4");
    expect(await value("#duration-seconds")).toBe("59");

    // 4:59 + 1s -> 5:00
    await page.getByRole("button", { name: "秒を1つ増やす" }).click();
    expect(await value("#duration-minutes")).toBe("5");
    expect(await value("#duration-seconds")).toBe("0");
  });

  test("holds each stepper at its own bounds", async ({ page }) => {
    await createSession(page);

    await page.locator("#duration-minutes").fill("1440");
    await page.getByRole("button", { name: "分を1つ増やす" }).click();
    expect(await page.locator("#duration-minutes").inputValue()).toBe("1440");

    // The seconds field cannot borrow below 0:00.
    await page.locator("#duration-minutes").fill("0");
    await page.getByRole("button", { name: "秒を1つ減らす" }).click();
    expect(await page.locator("#duration-minutes").inputValue()).toBe("0");
    expect(await page.locator("#duration-seconds").inputValue()).toBe("0");
  });

  test("repeats the stepper only after the hold delay", async ({ page }) => {
    await createSession(page);
    const seconds = page.locator("#duration-seconds");
    const button = page.getByRole("button", { name: "秒を1つ増やす" });
    const box = await button.boundingBox();
    if (box === null) throw new Error("stepper is not visible");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Below the hold threshold the press still counts as a single step.
    await page.waitForTimeout(150);
    expect(await seconds.inputValue()).toBe("1");

    await page.waitForTimeout(700);
    expect(Number(await seconds.inputValue())).toBeGreaterThan(1);

    await page.mouse.up();
    const released = await seconds.inputValue();
    await page.waitForTimeout(200);
    expect(await seconds.inputValue()).toBe(released);
  });

  test("remembers the chosen alarm sound across a reload", async ({ page }) => {
    await createSession(page);

    await page.locator("#alarm-sound").selectOption("bell");
    await expect(page.locator("#alarm-sound")).toHaveValue("bell");

    await page.reload();
    await expect(page.locator("#alarm-sound")).toHaveValue("bell");
  });

  test("copies the shared url", async ({ page }) => {
    await createSession(page);

    await expect(page.locator("#share-url")).toHaveValue(/\/s\/[A-Za-z0-9_-]{21}$/);
    await page.getByRole("button", { name: "URL をコピー" }).click();
    await expect(page.locator("#message")).toContainText("コピー");
  });
});

test.describe("start and repeat", () => {
  test("switches the start action to a repeat once a timer exists", async ({ page }) => {
    await createSession(page);
    await expect(page.getByRole("button", { name: "スタート" })).toBeEnabled();

    await startTimer(page, "0", "3");

    await expect(page.getByRole("button", { name: "スタート" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "タイマーをリセットする" })).toBeEnabled();
  });

  test("keeps both play and pause glyphs inside the toggle", async ({ page }) => {
    await createSession(page);
    const glyphs = page.locator("#toggle .toggle-glyph");

    await expect(glyphs).toHaveCount(2);

    await startTimer(page, "1", "0");
    await expect(glyphs).toHaveCount(2);

    await page.getByRole("button", { name: "一時停止" }).click();
    await expect(glyphs).toHaveCount(2);
  });

  test("disables controls that do not apply to the current status", async ({ page }) => {
    await createSession(page);

    await expect(page.getByRole("button", { name: "一時停止" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "延長" })).toBeDisabled();

    await startTimer(page, "1", "0");
    await expect(page.getByRole("button", { name: "タイマーをリセットする" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "一時停止" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "延長" })).toBeEnabled();

    await page.getByRole("button", { name: "一時停止" }).click();
    await expect(page.getByRole("button", { name: "再開" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "タイマーをリセットする" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "延長" })).toBeDisabled();
  });

  test("restarts from the full duration while paused", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "0", "10");

    await expect(remainingText(page)).toHaveText(/^00:0[4-6]$/, { timeout: 20_000 });
    await page.getByRole("button", { name: "一時停止" }).click();
    await expect(sessionRoot(page)).toHaveAttribute("data-status", "paused");

    await page.getByRole("button", { name: "タイマーをリセットする" }).click();

    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(remainingText(page)).toHaveText(/^00:(09|10)$/);
  });

  test("restarts with the duration currently in the form", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "0", "2");

    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "true", { timeout: 15_000 });
    await expect(sessionRoot(page)).toHaveAttribute("data-status", "expired", { timeout: 15_000 });

    await setDurationInput(page, "9", "0");
    await page.getByRole("button", { name: "タイマーをリセットする" }).click();

    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "false");
    await expect(remainingText(page)).toHaveText(/^(09:00|08:5\d)$/);
  });

  test("resets a running timer to the duration in the form", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "10", "0");
    await expect(remainingText(page)).toHaveText(/^(10:00|09:5\d)$/);

    await setDurationInput(page, "0", "45");
    await page.getByRole("button", { name: "タイマーをリセットする" }).click();

    await expect(sessionRoot(page)).toHaveAttribute("data-status", "running");
    await expect(remainingText(page)).toHaveText(/^00:4[45]$/);
  });

  test("mirrors the session duration back into the form after a reload", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "12", "30");

    await page.reload();

    expect(await page.locator("#duration-minutes").inputValue()).toBe("12");
    expect(await page.locator("#duration-seconds").inputValue()).toBe("30");
  });
});

test.describe("shared state across devices", () => {
  test("viewers follow the administrator in real time", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const { id } = await createSession(adminPage);

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`/s/${id}`);

    await expect(sessionRoot(viewerPage)).toHaveAttribute("data-status", "idle");
    await expect(viewerPage.locator("#admin")).toBeHidden();

    await startTimer(adminPage, "3", "0");
    await expect(sessionRoot(viewerPage)).toHaveAttribute("data-status", "running");
    await expect(remainingText(viewerPage)).toHaveText(/^0[23]:[0-5]\d$/);

    await adminPage.getByRole("button", { name: "一時停止" }).click();
    await expect(sessionRoot(viewerPage)).toHaveAttribute("data-status", "paused");
    await expect(viewerPage.locator("#status-label")).toHaveText("一時停止中");

    await adminContext.close();
    await viewerContext.close();
  });

  test("a reloading viewer catches up to the current state", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const { id } = await createSession(adminPage);
    await startTimer(adminPage, "3", "0");

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`/s/${id}`);

    await expect(sessionRoot(viewerPage)).toHaveAttribute("data-status", "running");
    await expect(remainingText(viewerPage)).toHaveText(/^0[23]:[0-5]\d$/);

    await viewerPage.reload();
    await expect(sessionRoot(viewerPage)).toHaveAttribute("data-status", "running");
    await expect(remainingText(viewerPage)).toHaveText(/^0[23]:[0-5]\d$/);

    await adminContext.close();
    await viewerContext.close();
  });
});

test.describe("alarm", () => {
  test("rings on every device when the timer runs out", async ({ browser, request }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const { id, adminToken } = await createSession(adminPage);

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`/s/${id}`);

    const response = await request.post(`/api/sessions/${id}/ops`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: { type: "set", durationMs: 2_500 },
    });
    expect(response.ok()).toBe(true);

    for (const page of [adminPage, viewerPage]) {
      await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "true", { timeout: 15_000 });
      await expect(remainingText(page)).toHaveText("00:00");
      // The alarm rings once and stops on its own; there is nothing to dismiss.
      await expect(page.locator("#alarming")).toHaveCount(0);
    }

    await adminContext.close();
    await viewerContext.close();
  });

  test("holds the alarm display until the clock reaches zero", async ({ page }) => {
    await createSession(page);
    await startTimer(page, "0", "4");

    // 00:01 is already inside the audio lead window; the display must stay normal.
    await expect(remainingText(page)).toHaveText("00:01");
    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "false");

    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "true", { timeout: 15_000 });
    await expect(remainingText(page)).toHaveText("00:00");
  });

  test("returns to the pre-countdown look a few seconds after the alarm", async ({
    page,
    request,
  }) => {
    const { id, adminToken } = await createSession(page);

    await request.post(`/api/sessions/${id}/ops`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: { type: "set", durationMs: 2_500 },
    });

    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "true", { timeout: 15_000 });

    // The alarm clears itself without any user action.
    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "false", { timeout: 15_000 });
    await expect(sessionRoot(page)).toHaveAttribute("data-status", "expired");
  });

  test("does not ring for a timer that already finished before joining", async ({
    browser,
    request,
  }) => {
    const created = await request.post("/api/sessions");
    const { id, adminToken } = (await created.json()) as { id: string; adminToken: string };

    await request.post(`/api/sessions/${id}/ops`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: { type: "set", durationMs: 1 },
    });
    await expect.poll(async () => apiState(request, id), { timeout: 15_000 }).toBe("expired");

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/s/${id}`);

    await expect(sessionRoot(page)).toHaveAttribute("data-status", "expired");
    await expect(page.locator("#status-label")).toHaveText("終了");
    await expect(sessionRoot(page)).toHaveAttribute("data-alarming", "false");

    await context.close();
  });
});
