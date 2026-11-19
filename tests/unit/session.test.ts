import { expect, it } from "vite-plus/test";

import {
  DEFAULT_ALARM_SOUND,
  MAX_DURATION_MS,
  SESSION_TTL_MS,
  TTL_MARGIN_MS,
} from "../../src/worker/domain/constants";
import {
  applyOp,
  createSession,
  expireIfDue,
  isDeletedByTtl,
  nextAlarmAt,
  toPublicState,
} from "../../src/worker/domain/session";

const T0 = 1_700_000_000_000;
const ID = "V1StGXR8_Z5jdHi6B-myT";

function newSession() {
  return createSession({ id: ID, adminTokenHash: "hash", now: T0 });
}

function run(session: ReturnType<typeof newSession>, op: Parameters<typeof applyOp>[1], now: number) {
  const result = applyOp(session, op, now);
  if (!result.ok) throw new Error(`expected ok, got ${result.status}: ${result.message}`);
  return result.session;
}

it("starts idle with no endsAt", () => {
  const session = newSession();
  expect(session).toMatchObject({
    id: ID,
    adminTokenHash: "hash",
    status: "idle",
    endsAt: null,
    remainingMs: null,
    alarmSound: DEFAULT_ALARM_SOUND,
    createdAt: T0,
    lastAdminOpAt: T0,
  });
});

it("set moves idle to running with an absolute endsAt", () => {
  const session = run(newSession(), { type: "set", durationMs: 60_000 }, T0 + 1_000);
  expect(session.status).toBe("running");
  expect(session.durationMs).toBe(60_000);
  expect(session.endsAt).toBe(T0 + 61_000);
  expect(session.remainingMs).toBeNull();
  expect(session.lastAdminOpAt).toBe(T0 + 1_000);
});

it("set can change the alarm sound", () => {
  const session = run(newSession(), { type: "set", durationMs: 60_000, alarmSound: "bell" }, T0);
  expect(session.alarmSound).toBe("bell");
});

it("set restarts an expired timer", () => {
  const expired = run(newSession(), { type: "set", durationMs: 1_000 }, T0);
  const due = expireIfDue(expired, T0 + 1_000);
  expect(due.status).toBe("expired");
  const restarted = run(due, { type: "set", durationMs: 2_000 }, T0 + 5_000);
  expect(restarted.status).toBe("running");
  expect(restarted.endsAt).toBe(T0 + 7_000);
});

it("pause freezes the remaining time", () => {
  const running = run(newSession(), { type: "set", durationMs: 60_000 }, T0);
  const paused = run(running, { type: "pause" }, T0 + 20_000);
  expect(paused.status).toBe("paused");
  expect(paused.endsAt).toBeNull();
  expect(paused.remainingMs).toBe(40_000);
});

it("pause clamps a negative remaining time to zero", () => {
  const running = run(newSession(), { type: "set", durationMs: 1_000 }, T0);
  const paused = run(running, { type: "pause" }, T0 + 5_000);
  expect(paused.remainingMs).toBe(0);
});

it("resume rebuilds endsAt from the frozen remaining time", () => {
  const running = run(newSession(), { type: "set", durationMs: 60_000 }, T0);
  const paused = run(running, { type: "pause" }, T0 + 20_000);
  const resumed = run(paused, { type: "resume" }, T0 + 30_000);
  expect(resumed.status).toBe("running");
  expect(resumed.endsAt).toBe(T0 + 70_000);
  expect(resumed.remainingMs).toBeNull();
});

it("rejects pause unless running", () => {
  expect(applyOp(newSession(), { type: "pause" }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "pause requires a running timer",
  });
  const brokenRunning = { ...newSession(), status: "running" as const, endsAt: null };
  expect(applyOp(brokenRunning, { type: "pause" }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "pause requires a running timer",
  });
  const nonRunningWithEndsAt = { ...newSession(), status: "paused" as const, endsAt: T0 + 10_000 };
  expect(applyOp(nonRunningWithEndsAt, { type: "pause" }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "pause requires a running timer",
  });
});

it("rejects resume unless paused", () => {
  const running = run(newSession(), { type: "set", durationMs: 1_000 }, T0);
  expect(applyOp(running, { type: "resume" }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "resume requires a paused timer",
  });
  expect(applyOp(newSession(), { type: "resume" }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "resume requires a paused timer",
  });
  const brokenPaused = { ...newSession(), status: "paused" as const, remainingMs: null };
  expect(applyOp(brokenPaused, { type: "resume" }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "resume requires a paused timer",
  });
  const nonPausedWithRemainingMs = { ...newSession(), status: "running" as const, remainingMs: 10_000 };
  expect(applyOp(nonPausedWithRemainingMs, { type: "resume" }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "resume requires a paused timer",
  });
});

it("extend pushes endsAt forward while running", () => {
  const running = run(newSession(), { type: "set", durationMs: 60_000 }, T0);
  const extended = run(running, { type: "extend", deltaMs: 30_000 }, T0 + 10_000);
  expect(extended.endsAt).toBe(T0 + 90_000);
});

it("extend never pushes the end beyond MAX_DURATION from now", () => {
  const running = run(newSession(), { type: "set", durationMs: 60_000 }, T0);
  const now = T0 + 10_000;
  const extended = run(running, { type: "extend", deltaMs: MAX_DURATION_MS }, now);
  expect(extended.endsAt).toBe(now + MAX_DURATION_MS);
});

it("rejects extend unless running", () => {
  expect(applyOp(newSession(), { type: "extend", deltaMs: 1_000 }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "extend requires a running timer",
  });
  const brokenRunning = { ...newSession(), status: "running" as const, endsAt: null };
  expect(applyOp(brokenRunning, { type: "extend", deltaMs: 1_000 }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "extend requires a running timer",
  });
  const nonRunningWithEndsAt = { ...newSession(), status: "paused" as const, endsAt: T0 + 10_000 };
  expect(applyOp(nonRunningWithEndsAt, { type: "extend", deltaMs: 1_000 }, T0)).toEqual({
    ok: false,
    status: 409,
    message: "extend requires a running timer",
  });
});

it("setAlarmSound applies in any status without touching endsAt", () => {
  const running = run(newSession(), { type: "set", durationMs: 60_000 }, T0);
  const changed = run(running, { type: "setAlarmSound", alarmSound: "piano" }, T0 + 1_000);
  expect(changed.alarmSound).toBe("piano");
  expect(changed.endsAt).toBe(T0 + 60_000);
  expect(changed.lastAdminOpAt).toBe(T0 + 1_000);
});

it("expires exactly at endsAt and clears the running fields", () => {
  const running = run(newSession(), { type: "set", durationMs: 1_000 }, T0);
  expect(expireIfDue(running, T0 + 999).status).toBe("running");
  const due = expireIfDue(running, T0 + 1_000);
  expect(due.status).toBe("expired");
  expect(due.endsAt).toBeNull();
  expect(due.remainingMs).toBeNull();

  const brokenRunning = { ...running, endsAt: null };
  expect(expireIfDue(brokenRunning, T0 + 2_000)).toBe(brokenRunning);
});

it("does not expire a paused or idle session", () => {
  const paused = run(
    run(newSession(), { type: "set", durationMs: 1_000 }, T0),
    { type: "pause" },
    T0 + 2_000,
  );
  expect(expireIfDue(paused, T0 + 10_000).status).toBe("paused");
  expect(expireIfDue(newSession(), T0 + 10_000).status).toBe("idle");

  const nonRunningWithEndsAt = { ...newSession(), status: "paused" as const, endsAt: T0 + 100 };
  expect(expireIfDue(nonRunningWithEndsAt, T0 + 500)).toBe(nonRunningWithEndsAt);
});

it("schedules the earliest of expiry and ttl deletion", () => {
  const running = run(newSession(), { type: "set", durationMs: 60_000 }, T0);
  expect(nextAlarmAt(running)).toBe(T0 + 60_000);
  expect(nextAlarmAt(newSession())).toBe(T0 + SESSION_TTL_MS + TTL_MARGIN_MS);

  const brokenRunning = { ...running, endsAt: null };
  expect(nextAlarmAt(brokenRunning)).toBe(T0 + SESSION_TTL_MS + TTL_MARGIN_MS);

  const nonRunningWithEndsAt = { ...newSession(), status: "paused" as const, endsAt: T0 + 100 };
  expect(nextAlarmAt(nonRunningWithEndsAt)).toBe(T0 + SESSION_TTL_MS + TTL_MARGIN_MS);
});

it("keeps the ttl deletion strictly after a max-length timer expires", () => {
  const running = run(newSession(), { type: "set", durationMs: MAX_DURATION_MS }, T0);
  expect(nextAlarmAt(running)).toBe(T0 + MAX_DURATION_MS);
  expect(isDeletedByTtl(running, T0 + MAX_DURATION_MS)).toBe(false);
});

it("deletes a session once the admin ttl has passed", () => {
  const running = run(newSession(), { type: "set", durationMs: 1_000 }, T0);
  const ttlAt = T0 + SESSION_TTL_MS + TTL_MARGIN_MS;
  expect(isDeletedByTtl(running, ttlAt - 1)).toBe(false);
  expect(isDeletedByTtl(running, ttlAt)).toBe(true);
});

it("exposes only the public fields, with an endsAt when running", () => {
  const running = run(newSession(), { type: "set", durationMs: 60_000 }, T0);
  const state = toPublicState(running, T0 + 5_000);
  expect(state).toEqual({
    id: ID,
    status: "running",
    durationMs: 60_000,
    endsAt: T0 + 60_000,
    remainingMs: null,
    alarmSound: DEFAULT_ALARM_SOUND,
    createdAt: T0,
    serverTime: T0 + 5_000,
  });
  expect(Object.keys(state)).not.toContain("adminTokenHash");
  expect(Object.keys(state)).not.toContain("lastAdminOpAt");
});

it("normalizes an alarm sound that predates the bundled presets", () => {
  const legacy = { ...newSession(), alarmSound: "beep" as never };
  expect(toPublicState(legacy, T0).alarmSound).toBe(DEFAULT_ALARM_SOUND);
});

it("exposes remainingMs only while paused", () => {
  const paused = run(
    run(newSession(), { type: "set", durationMs: 60_000 }, T0),
    { type: "pause" },
    T0 + 20_000,
  );
  const state = toPublicState(paused, T0 + 21_000);
  expect(state.endsAt).toBeNull();
  expect(state.remainingMs).toBe(40_000);
});

it("keeps endsAt and remainingMs null when idle or expired", () => {
  const idleState = toPublicState(newSession(), T0);
  expect(idleState.status).toBe("idle");
  expect(idleState.endsAt).toBeNull();
  expect(idleState.remainingMs).toBeNull();

  const running = run(newSession(), { type: "set", durationMs: 1_000 }, T0);
  const expired = expireIfDue(running, T0 + 1_000);
  const expiredState = toPublicState(expired, T0 + 2_000);
  expect(expiredState.status).toBe("expired");
  expect(expiredState.endsAt).toBeNull();
  expect(expiredState.remainingMs).toBeNull();

  const idleWithEndsAt = { ...newSession(), endsAt: T0 + 5_000 };
  expect(toPublicState(idleWithEndsAt, T0).endsAt).toBeNull();

  const runningWithRemainingMs = { ...running, remainingMs: 5_000 };
  expect(toPublicState(runningWithRemainingMs, T0).remainingMs).toBeNull();
});

