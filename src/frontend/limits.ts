import { MAX_DURATION_MS } from "../worker/domain/constants";

export const MAX_DURATION_LABEL = `${MAX_DURATION_MS / 3_600_000} 時間`;

export const MIN_DURATION_MS = 1_000;

export function wasExtendClamped(
  previousEndsAt: number | null,
  deltaMs: number,
  nextEndsAt: number | null,
): boolean {
  if (previousEndsAt === null || nextEndsAt === null) return false;
  return nextEndsAt < previousEndsAt + deltaMs;
}

export type DurationCheck = { ok: true; durationMs: number } | { ok: false; message: string };

function toAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseDuration(input: { minutes: string; seconds: string }): DurationCheck {
  const minutes = toAmount(input.minutes);
  const seconds = toAmount(input.seconds);
  if (minutes === null || seconds === null) {
    return { ok: false, message: "時間は 0 以上の数字で指定してください。" };
  }

  const durationMs = Math.round(minutes * 60_000 + seconds * 1_000);
  if (durationMs < MIN_DURATION_MS) {
    return { ok: false, message: "1 秒以上を指定してください。" };
  }
  if (durationMs > MAX_DURATION_MS) {
    return { ok: false, message: `設定できるのは最大 ${MAX_DURATION_LABEL}までです。` };
  }
  return { ok: true, durationMs };
}
