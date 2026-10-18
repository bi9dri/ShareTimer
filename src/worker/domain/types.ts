import type { AlarmSound } from "./constants";

export type SessionStatus = "idle" | "running" | "paused" | "expired";

export interface Session {
  id: string;
  adminTokenHash: string;
  status: SessionStatus;
  durationMs: number;
  endsAt: number | null;
  remainingMs: number | null;
  alarmSound: AlarmSound;
  lastAdminOpAt: number;
  createdAt: number;
}

export type OpRequest =
  | { type: "set"; durationMs: number; alarmSound?: AlarmSound }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "extend"; deltaMs: number }
  | { type: "setAlarmSound"; alarmSound: AlarmSound };

export interface PublicState {
  id: string;
  status: SessionStatus;
  durationMs: number;
  endsAt: number | null;
  remainingMs: number | null;
  alarmSound: AlarmSound;
  createdAt: number;
  serverTime: number;
}
