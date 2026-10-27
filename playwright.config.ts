import { defineConfig, devices } from "@playwright/test";

const PORT = 8787;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // The container reports few CPUs, so the default 50% rounds down to one worker.
  workers: process.env["CI"] ? 2 : undefined,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run e2e:server",
    url: `${baseURL}/api/time?t0=0`,
    reuseExistingServer: !process.env["CI"],
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
});
