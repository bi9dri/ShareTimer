import { expect, it } from "vite-plus/test";

import {
  generateAdminToken,
  hashToken,
  timingSafeEqual,
  verifyToken,
} from "../../src/worker/domain/token";

it("generates a 32-byte base64url admin token", () => {
  const token = generateAdminToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it("generates distinct admin tokens", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => generateAdminToken()));
  expect(tokens.size).toBe(200);
});

it("hashes a token to a stable sha-256 hex digest", async () => {
  const hash = await hashToken("admin-token");
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(await hashToken("admin-token")).toBe(hash);
  expect(await hashToken("other-token")).not.toBe(hash);
});

it("verifies a token against its own hash", async () => {
  const token = generateAdminToken();
  const hash = await hashToken(token);
  expect(await verifyToken(token, hash)).toBe(true);
});

it("rejects a token that does not match the hash", async () => {
  const hash = await hashToken(generateAdminToken());
  expect(await verifyToken(generateAdminToken(), hash)).toBe(false);
  expect(await verifyToken("", hash)).toBe(false);
});

it("compares strings without leaking length mismatches as success", () => {
  expect(timingSafeEqual("abc", "abc")).toBe(true);
  expect(timingSafeEqual("abc", "abd")).toBe(false);
  expect(timingSafeEqual("abc", "abcd")).toBe(false);
  expect(timingSafeEqual("", "")).toBe(true);
});
