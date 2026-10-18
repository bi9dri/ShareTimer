import { expect, it } from "vite-plus/test";

import {
  adminTokenKey,
  clearAdminToken,
  loadAdminToken,
  loadVolume,
  saveAdminToken,
  saveVolume,
  type KeyValueStore,
} from "../../src/frontend/storage";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

it("namespaces the admin token by session id", () => {
  expect(adminTokenKey("V1StGXR8_Z5jdHi6B-myT")).toBe("sharetimer:V1StGXR8_Z5jdHi6B-myT");
});

it("round trips the admin token", () => {
  const store = memoryStore();
  saveAdminToken(store, "abc", "secret");
  expect(loadAdminToken(store, "abc")).toBe("secret");
  expect(loadAdminToken(store, "other")).toBeNull();

  clearAdminToken(store, "abc");
  expect(loadAdminToken(store, "abc")).toBeNull();
});

it("defaults the volume to full and round trips it", () => {
  const store = memoryStore();
  expect(loadVolume(store)).toBe(1);
  saveVolume(store, 0.4);
  expect(loadVolume(store)).toBe(0.4);
});

it("clamps and sanitises a stored volume", () => {
  expect(loadVolume(memoryStore({ "sharetimer:volume": "2" }))).toBe(1);
  expect(loadVolume(memoryStore({ "sharetimer:volume": "-3" }))).toBe(0);
  expect(loadVolume(memoryStore({ "sharetimer:volume": "loud" }))).toBe(1);
});

it("clamps the volume before saving it", () => {
  const store = memoryStore();
  saveVolume(store, 5);
  expect(loadVolume(store)).toBe(1);
  saveVolume(store, -1);
  expect(loadVolume(store)).toBe(0);
});
