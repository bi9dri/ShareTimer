import { expect, it } from "vite-plus/test";

import {
  ALARM_SOURCES,
  evaluateAlarm,
  initAlarmGate,
  SCHEDULE_LEAD_MS,
  scheduleOffsetSeconds,
} from "../../src/frontend/alarm";
import { ALARM_SOUNDS } from "../../src/worker/domain/constants";
import type { PublicState } from "../../src/worker/domain/types";

function state(patch: Partial<PublicState> = {}): PublicState {
  return {
    id: "V1StGXR8_Z5jdHi6B-myT",
    status: "running",
    durationMs: 60_000,
    endsAt: 1_000_000,
    remainingMs: null,
    alarmSound: "alarm",
    createdAt: 0,
    serverTime: 0,
    ...patch,
  };
}

it("does not fire for a timer that was already expired on arrival", () => {
  for (let i = 0; i < 3; i++) {
    const decision = evaluateAlarm(
      initAlarmGate(),
      state({ status: "expired", endsAt: null }),
      -1_000,
    );
    expect(decision.fire).toBe(false);
  }
});

it("waits for the lead window before scheduling", () => {
  const gate = initAlarmGate();
  expect(evaluateAlarm(gate, state(), SCHEDULE_LEAD_MS + 1).fire).toBe(false);
  expect(evaluateAlarm(gate, state(), SCHEDULE_LEAD_MS).fire).toBe(true);
});

it("fires exactly once for a timer generation", () => {
  const first = evaluateAlarm(initAlarmGate(), state(), 500);
  expect(first.fire).toBe(true);

  const second = evaluateAlarm(first.gate, state(), 400);
  expect(second.fire).toBe(false);

  const third = evaluateAlarm(second.gate, state(), -10);
  expect(third.fire).toBe(false);
});

it("still fires when a throttled tab wakes up late", () => {
  expect(evaluateAlarm(initAlarmGate(), state(), -5_000).fire).toBe(true);
});

it("arms a fresh generation when endsAt changes", () => {
  const armed = evaluateAlarm(initAlarmGate(), state(), 100);
  expect(armed.fire).toBe(true);

  const rescheduled = evaluateAlarm(armed.gate, state({ endsAt: 1_060_000 }), 59_000);
  expect(rescheduled.fire).toBe(false);

  expect(evaluateAlarm(rescheduled.gate, state({ endsAt: 1_060_000 }), 100).fire).toBe(true);
});

it("re-arms after a pause and resume cycle", () => {
  const armed = evaluateAlarm(initAlarmGate(), state(), 100);
  const paused = evaluateAlarm(armed.gate, state({ status: "paused", endsAt: null }), 0);
  expect(paused.gate.generation).toBeNull();

  const resumed = evaluateAlarm(paused.gate, state({ endsAt: 1_120_000 }), 100);
  expect(resumed.fire).toBe(true);
});

it("schedules the sound on the boundary, with no latency compensation", () => {
  expect(scheduleOffsetSeconds(1_500)).toBeCloseTo(1.5, 5);
  expect(scheduleOffsetSeconds(10)).toBeCloseTo(0.01, 5);
  expect(scheduleOffsetSeconds(-400)).toBe(0);
});

it("maps every alarm sound to a bundled file and nothing else", () => {
  expect(Object.keys(ALARM_SOURCES).sort()).toEqual([...ALARM_SOUNDS].sort());
  for (const sound of ALARM_SOUNDS) {
    expect(ALARM_SOURCES[sound]).toMatch(/^\/alarm\/[a-z]+\.wav$/);
  }
});
