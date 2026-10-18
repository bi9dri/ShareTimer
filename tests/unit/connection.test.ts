import { expect, it } from "vite-plus/test";

import { backoffDelay, isPongOverdue, MAX_BACKOFF_MS } from "../../src/frontend/connection";

it("grows the reconnect delay exponentially", () => {
  const withoutJitter = () => 0;
  const delays = [0, 1, 2, 3].map((attempt) => backoffDelay(attempt, 1_000, withoutJitter));
  expect(delays).toEqual([500, 1_000, 2_000, 4_000]);
});

it("never exceeds the maximum backoff", () => {
  expect(backoffDelay(20, 1_000, () => 1)).toBe(MAX_BACKOFF_MS);
});

it("keeps jitter inside the halved window", () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const low = backoffDelay(attempt, 1_000, () => 0);
    const high = backoffDelay(attempt, 1_000, () => 1);
    expect(high).toBeGreaterThanOrEqual(low);
    expect(high).toBeLessThanOrEqual(Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS));
  }
});

it("treats a silent pong as overdue", () => {
  expect(isPongOverdue(1_000, 1_000, 500)).toBe(false);
  expect(isPongOverdue(1_000, 1_500, 500)).toBe(false);
  expect(isPongOverdue(1_000, 1_501, 500)).toBe(true);
});
