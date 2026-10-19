import {
  ALARM_SOUNDS,
  DEFAULT_ALARM_SOUND,
  MAX_DURATION_MS,
  SESSION_TTL_MS,
  TTL_MARGIN_MS,
} from "./constants";
import type { OpRequest, PublicState, Session } from "./types";

export type OpOutcome =
  | { ok: true; session: Session }
  | { ok: false; status: 409; message: string };

export function createSession(args: {
  id: string;
  adminTokenHash: string;
  now: number;
}): Session {
  return {
    id: args.id,
    adminTokenHash: args.adminTokenHash,
    status: "idle",
    durationMs: 0,
    endsAt: null,
    remainingMs: null,
    alarmSound: DEFAULT_ALARM_SOUND,
    lastAdminOpAt: args.now,
    createdAt: args.now,
  };
}

function conflict(message: string): OpOutcome {
  return { ok: false, status: 409, message };
}

export function applyOp(session: Session, op: OpRequest, now: number): OpOutcome {
  switch (op.type) {
    case "set":
      return {
        ok: true,
        session: {
          ...session,
          status: "running",
          durationMs: op.durationMs,
          endsAt: now + op.durationMs,
          remainingMs: null,
          alarmSound: op.alarmSound ?? session.alarmSound,
          lastAdminOpAt: now,
        },
      };
    case "pause": {
      if (session.status !== "running" || session.endsAt === null) {
        return conflict("pause requires a running timer");
      }
      return {
        ok: true,
        session: {
          ...session,
          status: "paused",
          endsAt: null,
          remainingMs: Math.max(0, session.endsAt - now),
          lastAdminOpAt: now,
        },
      };
    }
    case "resume": {
      if (session.status !== "paused" || session.remainingMs === null) {
        return conflict("resume requires a paused timer");
      }
      return {
        ok: true,
        session: {
          ...session,
          status: "running",
          endsAt: now + session.remainingMs,
          remainingMs: null,
          lastAdminOpAt: now,
        },
      };
    }
    case "extend": {
      if (session.status !== "running" || session.endsAt === null) {
        return conflict("extend requires a running timer");
      }
      const endsAt = Math.min(session.endsAt + op.deltaMs, now + MAX_DURATION_MS);
      return { ok: true, session: { ...session, endsAt, lastAdminOpAt: now } };
    }
    case "setAlarmSound":
      return {
        ok: true,
        session: { ...session, alarmSound: op.alarmSound, lastAdminOpAt: now },
      };
  }
}

export function expireIfDue(session: Session, now: number): Session {
  if (session.status !== "running" || session.endsAt === null || now < session.endsAt) {
    return session;
  }
  return { ...session, status: "expired", endsAt: null, remainingMs: null };
}

export function sessionExpiresAt(session: Session): number {
  return session.lastAdminOpAt + SESSION_TTL_MS + TTL_MARGIN_MS;
}

export function isDeletedByTtl(session: Session, now: number): boolean {
  return now >= sessionExpiresAt(session);
}

export function nextAlarmAt(session: Session): number {
  const ttlAt = sessionExpiresAt(session);
  if (session.status === "running" && session.endsAt !== null) {
    return Math.min(session.endsAt, ttlAt);
  }
  return ttlAt;
}

export function toPublicState(session: Session, serverTime: number): PublicState {
  return {
    id: session.id,
    status: session.status,
    durationMs: session.durationMs,
    endsAt: session.status === "running" ? session.endsAt : null,
    remainingMs: session.status === "paused" ? session.remainingMs : null,
    // Sessions created before the bundled presets still hold an old ID.
    alarmSound: (ALARM_SOUNDS as readonly string[]).includes(session.alarmSound)
      ? session.alarmSound
      : DEFAULT_ALARM_SOUND,
    createdAt: session.createdAt,
    serverTime,
  };
}
