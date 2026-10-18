import { expect, it } from "vite-plus/test";

import { computeSample, remainingMs, selectBestSample } from "../../src/frontend/clock";

it("estimates the offset from a round trip", () => {
  const sample = computeSample({ t0: 1_000, t1: 1_100, serverTime: 2_000 });
  expect(sample.rtt).toBe(100);
  expect(sample.offset).toBe(950);
});

it("uses the midpoint so one-way delay does not bias the offset", () => {
  const sample = computeSample({ t0: 10_000, t1: 10_400, serverTime: 10_200 });
  expect(sample.rtt).toBe(400);
  expect(sample.offset).toBe(0);
});

it("keeps the sample with the smallest round trip", () => {
  const best = selectBestSample([
    { offset: 10, rtt: 120 },
    { offset: 40, rtt: 20 },
    { offset: 25, rtt: 60 },
  ]);
  expect(best).toEqual({ offset: 40, rtt: 20 });
});

it("has no sample when nothing was measured", () => {
  expect(selectBestSample([])).toBeNull();
});

it("computes the remaining time against the corrected clock", () => {
  expect(remainingMs(5_000, 1_000, 200)).toBe(3_800);
  expect(remainingMs(5_000, 5_100, 200)).toBe(-300);
});
