import { ALARM_SOUNDS, MAX_DURATION_MS, type AlarmSound } from "./constants";
import type { OpRequest } from "./types";

export type ParseOpResult =
  | { ok: true; op: OpRequest }
  | { ok: false; status: 422; message: string };

function invalid(message: string): ParseOpResult {
  return { ok: false, status: 422, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAlarmSound(value: unknown): value is AlarmSound {
  return typeof value === "string" && (ALARM_SOUNDS as readonly string[]).includes(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function parseOp(body: unknown): ParseOpResult {
  if (!isRecord(body)) return invalid("body must be a JSON object");

  switch (body["type"]) {
    case "set": {
      const durationMs = body["durationMs"];
      if (!isPositiveInteger(durationMs) || durationMs > MAX_DURATION_MS) {
        return invalid(`durationMs must be an integer between 1 and ${MAX_DURATION_MS}`);
      }
      const alarmSound = body["alarmSound"];
      if (alarmSound !== undefined) {
        if (!isAlarmSound(alarmSound)) return invalid("alarmSound is not a known preset");
        return { ok: true, op: { type: "set", durationMs, alarmSound } };
      }
      return { ok: true, op: { type: "set", durationMs } };
    }
    case "pause":
      return { ok: true, op: { type: "pause" } };
    case "resume":
      return { ok: true, op: { type: "resume" } };
    case "extend": {
      const deltaMs = body["deltaMs"];
      if (!isPositiveInteger(deltaMs)) return invalid("deltaMs must be a positive integer");
      return { ok: true, op: { type: "extend", deltaMs } };
    }
    case "setAlarmSound": {
      const alarmSound = body["alarmSound"];
      if (!isAlarmSound(alarmSound)) return invalid("alarmSound is not a known preset");
      return { ok: true, op: { type: "setAlarmSound", alarmSound } };
    }
    default:
      return invalid("unknown op type");
  }
}
