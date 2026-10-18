import { SESSION_ID_LENGTH } from "./constants";
import { randomBytes } from "./random";

const ID_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

const SESSION_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${SESSION_ID_LENGTH}}$`);

export function generateSessionId(): string {
  const bytes = randomBytes(SESSION_ID_LENGTH);
  let id = "";
  for (const byte of bytes) id += ID_ALPHABET.charAt(byte & 63);
  return id;
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}
