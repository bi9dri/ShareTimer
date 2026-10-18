import { expect, it } from "vite-plus/test";

import { generateSessionId, isValidSessionId } from "../../src/worker/domain/id";
import { SESSION_ID_LENGTH } from "../../src/worker/domain/constants";

it("generates an id of the configured length using the url-safe alphabet", () => {
  const id = generateSessionId();
  expect(id).toHaveLength(SESSION_ID_LENGTH);
  expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
});

it("generates distinct ids", () => {
  const ids = new Set(Array.from({ length: 500 }, () => generateSessionId()));
  expect(ids.size).toBe(500);
});

it("accepts a well-formed session id", () => {
  expect(isValidSessionId("V1StGXR8_Z5jdHi6B-myT")).toBe(true);
});

it("rejects malformed session ids", () => {
  expect(isValidSessionId("")).toBe(false);
  expect(isValidSessionId("V1StGXR8_Z5jdHi6B-my")).toBe(false);
  expect(isValidSessionId("V1StGXR8_Z5jdHi6B-myTT")).toBe(false);
  expect(isValidSessionId("V1StGXR8_Z5jdHi6B-my!")).toBe(false);
  expect(isValidSessionId("../etc/passwd/aaaaaaaaa")).toBe(false);
});
