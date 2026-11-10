import { expect, it } from "vite-plus/test";

import { MAX_DURATION_MS } from "../../src/worker/domain/constants";
import { parseOp } from "../../src/worker/domain/validation";

it("parses a set op with a preset alarm sound", () => {
  expect(parseOp({ type: "set", durationMs: 60_000, alarmSound: "alarm" })).toEqual({
    ok: true,
    op: { type: "set", durationMs: 60_000, alarmSound: "alarm" },
  });
});

it("parses a set op without an alarm sound", () => {
  expect(parseOp({ type: "set", durationMs: 60_000 })).toEqual({
    ok: true,
    op: { type: "set", durationMs: 60_000 },
  });
});

it("accepts the duration boundaries", () => {
  expect(parseOp({ type: "set", durationMs: 1 }).ok).toBe(true);
  expect(parseOp({ type: "set", durationMs: MAX_DURATION_MS }).ok).toBe(true);
});

it("rejects out-of-range durations", () => {
  for (const durationMs of [0, -1, MAX_DURATION_MS + 1, 1.5, Number.NaN]) {
    const result = parseOp({ type: "set", durationMs });
    expect(result.ok).toBe(false);
  }
});

it("parses pause, resume and setAlarmSound", () => {
  expect(parseOp({ type: "pause" })).toEqual({ ok: true, op: { type: "pause" } });
  expect(parseOp({ type: "resume" })).toEqual({ ok: true, op: { type: "resume" } });
  expect(parseOp({ type: "setAlarmSound", alarmSound: "bell" })).toEqual({
    ok: true,
    op: { type: "setAlarmSound", alarmSound: "bell" },
  });
});

it("parses an extend op with a positive integer delta", () => {
  expect(parseOp({ type: "extend", deltaMs: 5_000 })).toEqual({
    ok: true,
    op: { type: "extend", deltaMs: 5_000 },
  });
});

it("rejects a non-positive or fractional delta", () => {
  for (const deltaMs of [0, -1, 0.5, Number.POSITIVE_INFINITY, "5000", null]) {
    expect(parseOp({ type: "extend", deltaMs })).toEqual({
      ok: false,
      status: 422,
      message: "deltaMs must be a positive integer",
    });
  }
});

it("rejects an unknown alarm sound", () => {
  expect(parseOp({ type: "set", durationMs: 1_000, alarmSound: "siren" })).toEqual({
    ok: false,
    status: 422,
    message: "alarmSound is not a known preset",
  });
  expect(parseOp({ type: "set", durationMs: 1_000, alarmSound: 123 })).toEqual({
    ok: false,
    status: 422,
    message: "alarmSound is not a known preset",
  });
  expect(parseOp({ type: "setAlarmSound", alarmSound: "siren" })).toEqual({
    ok: false,
    status: 422,
    message: "alarmSound is not a known preset",
  });
  expect(parseOp({ type: "setAlarmSound", alarmSound: false })).toEqual({
    ok: false,
    status: 422,
    message: "alarmSound is not a known preset",
  });
});

it("rejects an unknown op type", () => {
  expect(parseOp({ type: "reset" })).toEqual({
    ok: false,
    status: 422,
    message: "unknown op type",
  });
});

it("rejects bodies that are not objects", () => {
  for (const body of [null, undefined, "set", 42, [], true]) {
    expect(parseOp(body)).toEqual({
      ok: false,
      status: 422,
      message: "body must be a JSON object",
    });
  }
});

it("reports a reason for rejected bodies", () => {
  const result = parseOp({ type: "set", durationMs: 0 });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
});
