import { defineConfig, devices } from "@playwright/test";

const PORT = 8787;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/vrt",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/vrt", open: "never" }]],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
      },
    },
  ],
  webServer: {
    command: "pnpm run e2e:server",
    url: `${baseURL}/api/time?t0=0`,
    reuseExistingServer: !process.env["CI"],
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
});
