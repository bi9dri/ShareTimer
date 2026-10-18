import { ADMIN_TOKEN_BYTES } from "./constants";
import { base64urlEncode, randomBytes } from "./random";

export function generateAdminToken(): string {
  return base64urlEncode(randomBytes(ADMIN_TOKEN_BYTES));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyToken(token: string, expectedHash: string): Promise<boolean> {
  return timingSafeEqual(await hashToken(token), expectedHash);
}
