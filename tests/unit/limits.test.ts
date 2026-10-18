import { expect, it } from "vite-plus/test";

import { MAX_DURATION_LABEL, parseDuration, wasExtendClamped } from "../../src/frontend/limits";

it("does not flag an extension that was applied in full", () => {
  expect(wasExtendClamped(1_000_000, 60_000, 1_060_000)).toBe(false);
  expect(wasExtendClamped(1_000_000, 1, 1_000_001)).toBe(false);
});

it("flags an extension that was capped by the maximum duration", () => {
  expect(wasExtendClamped(1_000_000, 60_000, 1_059_000)).toBe(true);
});

it("flags an extension that was already at the maximum", () => {
  expect(wasExtendClamped(1_000_000, 60_000, 1_000_000)).toBe(true);
});

it("does not flag when the timer is not running", () => {
  expect(wasExtendClamped(null, 60_000, 1_000_000)).toBe(false);
  expect(wasExtendClamped(1_000_000, 60_000, null)).toBe(false);
});

it("describes the maximum duration for the notice", () => {
  expect(MAX_DURATION_LABEL).toBe("24 時間");
});

it("reads a duration from minutes and seconds", () => {
  expect(parseDuration({ minutes: "5", seconds: "0" })).toEqual({ ok: true, durationMs: 300_000 });
  expect(parseDuration({ minutes: "0", seconds: "30" })).toEqual({ ok: true, durationMs: 30_000 });
  expect(parseDuration({ minutes: "1", seconds: "90" })).toEqual({ ok: true, durationMs: 150_000 });
  expect(parseDuration({ minutes: "", seconds: "1" })).toEqual({ ok: true, durationMs: 1_000 });
  expect(parseDuration({ minutes: "0", seconds: "1" })).toEqual({ ok: true, durationMs: 1_000 });
});

it("accepts the maximum duration", () => {
  expect(parseDuration({ minutes: "1440", seconds: "0" })).toEqual({
    ok: true,
    durationMs: 86_400_000,
  });
});

it("rejects a duration below one second", () => {
  const result = parseDuration({ minutes: "0", seconds: "0" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain("1 秒");
});

it("rejects a duration above the maximum", () => {
  const result = parseDuration({ minutes: "1440", seconds: "1" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain(MAX_DURATION_LABEL);
});

it("rejects input that is not a non-negative number", () => {
  expect(parseDuration({ minutes: "abc", seconds: "0" }).ok).toBe(false);
  expect(parseDuration({ minutes: "-1", seconds: "0" }).ok).toBe(false);
  expect(parseDuration({ minutes: "0", seconds: "1.5" }).ok).toBe(true);
  expect(parseDuration({ minutes: "1e3", seconds: "0" }).ok).toBe(true);
});
