export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const TTL_MARGIN_MS = 60 * 1000;

export const ADMIN_TOKEN_BYTES = 32;

export const SESSION_ID_LENGTH = 21;

export const MAX_BODY_BYTES = 8 * 1024;

export const ALARM_SOUNDS = ["alarm", "bell", "piano", "jingle"] as const;

export const DEFAULT_ALARM_SOUND = "alarm";

export type AlarmSound = (typeof ALARM_SOUNDS)[number];
