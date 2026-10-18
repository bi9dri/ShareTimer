import type { PublicState } from "./domain/types";

export const RETRY_MS = 1_000;

export type ServerMessage =
  | { type: "hello"; data: { retryMs: number } }
  | { type: "state"; data: PublicState }
  | { type: "time"; data: { serverTime: number } }
  | { type: "closed"; data: Record<string, never> };

export function encodeMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
