import { expect, it } from "vite-plus/test";

import { formatRemaining } from "../../src/frontend/format";

it("formats a countdown as minutes and seconds", () => {
  expect(formatRemaining(0)).toBe("00:00");
  expect(formatRemaining(59_000)).toBe("00:59");
  expect(formatRemaining(60_000)).toBe("01:00");
  expect(formatRemaining(65_400)).toBe("01:06");
});

it("rounds up so the last second is shown until it truly ends", () => {
  expect(formatRemaining(1)).toBe("00:01");
  expect(formatRemaining(1_001)).toBe("00:02");
});

it("clamps a finished timer at zero", () => {
  expect(formatRemaining(-1)).toBe("00:00");
  expect(formatRemaining(-60_000)).toBe("00:00");
});

it("adds an hours field for long timers", () => {
  expect(formatRemaining(3_600_000)).toBe("1:00:00");
  expect(formatRemaining(3_661_000)).toBe("1:01:01");
  expect(formatRemaining(24 * 3_600_000)).toBe("24:00:00");
});
