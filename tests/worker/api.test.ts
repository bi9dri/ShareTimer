import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { expect, it } from "vite-plus/test";

import { hashToken } from "../../src/worker/domain/token";
import type { Session } from "../../src/worker/domain/types";

const ORIGIN = "https://example.com";

async function createSession(): Promise<{ id: string; adminToken: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/sessions`, { method: "POST" });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; adminToken: string };
}

async function postOp(id: string, body: unknown, token?: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/sessions/${id}/ops`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readState(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as { state: Record<string, unknown> };
  return body.state;
}

it("creates a session and returns the admin token exactly once", async () => {
  const res = await SELF.fetch(`${ORIGIN}/api/sessions`, { method: "POST" });
  expect(res.status).toBe(201);

  const body = (await res.json()) as { id: string; adminToken: string };
  expect(body.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  expect(body.adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Object.keys(body).sort()).toEqual(["adminToken", "id"]);
});

it("returns the current time and echoes t0", async () => {
  const before = Date.now();
  const res = await SELF.fetch(`${ORIGIN}/api/time?t0=1700000004998`);
  expect(res.status).toBe(200);

  const body = (await res.json()) as { serverTime: number; t0: number };
  expect(body.t0).toBe(1700000004998);
  expect(body.serverTime).toBeGreaterThanOrEqual(before);
  expect(body.serverTime).toBeLessThanOrEqual(Date.now());
});

it("rejects a time request without a valid t0", async () => {
  expect((await SELF.fetch(`${ORIGIN}/api/time`)).status).toBe(422);
  expect((await SELF.fetch(`${ORIGIN}/api/time?t0=abc`)).status).toBe(422);
});

it("returns a not-found snapshot for unknown or malformed ids", async () => {
  const created = await createSession();
  expect((await SELF.fetch(`${ORIGIN}/api/sessions/${created.id}`)).status).toBe(200);
  expect((await SELF.fetch(`${ORIGIN}/api/sessions/nope`)).status).toBe(404);
  expect((await SELF.fetch(`${ORIGIN}/api/sessions/${"a".repeat(21)}`)).status).toBe(404);
});

it("returns an idle snapshot straight after creation", async () => {
  const { id } = await createSession();
  const state = await readState(await SELF.fetch(`${ORIGIN}/api/sessions/${id}`));
  expect(state).toMatchObject({
    id,
    status: "idle",
    endsAt: null,
    remainingMs: null,
    alarmSound: "beep",
  });
  expect(state["serverTime"]).toBeTypeOf("number");
  expect(state).not.toHaveProperty("adminTokenHash");
  expect(state).not.toHaveProperty("lastAdminOpAt");
});

it("starts a timer for the administrator", async () => {
  const { id, adminToken } = await createSession();
  const before = Date.now();
  const res = await postOp(id, { type: "set", durationMs: 60_000 }, adminToken);
  expect(res.status).toBe(200);

  const state = await readState(res);
  expect(state["status"]).toBe("running");
  expect(state["durationMs"]).toBe(60_000);
  expect(state["endsAt"]).toBeGreaterThanOrEqual(before + 60_000);
  expect(state["endsAt"]).toBeLessThanOrEqual(Date.now() + 60_000);
});

it("requires a valid admin token for operations", async () => {
  const { id } = await createSession();
  expect((await postOp(id, { type: "set", durationMs: 1_000 })).status).toBe(401);
  expect((await postOp(id, { type: "set", durationMs: 1_000 }, "wrong-token")).status).toBe(401);
});

it("returns 404 for operations on an unknown session", async () => {
  const res = await postOp("a".repeat(21), { type: "set", durationMs: 1_000 }, "token");
  expect(res.status).toBe(404);
});

it("rejects malformed json with 400", async () => {
  const { id, adminToken } = await createSession();
  expect((await postOp(id, "{not json", adminToken)).status).toBe(400);
});

it("rejects invalid op payloads with 422", async () => {
  const { id, adminToken } = await createSession();
  expect((await postOp(id, { type: "set", durationMs: 0 }, adminToken)).status).toBe(422);
  expect((await postOp(id, { type: "nope" }, adminToken)).status).toBe(422);
});

it("rejects operations that violate the current state with 409", async () => {
  const { id, adminToken } = await createSession();
  expect((await postOp(id, { type: "pause" }, adminToken)).status).toBe(409);
  expect((await postOp(id, { type: "resume" }, adminToken)).status).toBe(409);
  expect((await postOp(id, { type: "extend", deltaMs: 1_000 }, adminToken)).status).toBe(409);
});

it("pauses and resumes through the api", async () => {
  const { id, adminToken } = await createSession();
  await postOp(id, { type: "set", durationMs: 60_000 }, adminToken);

  const paused = await readState(await postOp(id, { type: "pause" }, adminToken));
  expect(paused["status"]).toBe("paused");
  expect(paused["endsAt"]).toBeNull();
  expect(paused["remainingMs"]).toBeGreaterThan(0);

  const resumed = await readState(await postOp(id, { type: "resume" }, adminToken));
  expect(resumed["status"]).toBe("running");
  expect(resumed["remainingMs"]).toBeNull();
});

it("changes the alarm sound", async () => {
  const { id, adminToken } = await createSession();
  const state = await readState(await postOp(id, { type: "setAlarmSound", alarmSound: "bell" }, adminToken));
  expect(state["alarmSound"]).toBe("bell");
});

it("refuses oversized request bodies", async () => {
  const { id, adminToken } = await createSession();
  const res = await postOp(id, { type: "set", durationMs: 1_000, pad: "x".repeat(9_000) }, adminToken);
  expect(res.status).toBe(413);
});

it("serves a websocket that starts with hello then the current state", async () => {
  const { id } = await createSession();
  const res = await SELF.fetch(`${ORIGIN}/api/sessions/${id}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);

  const ws = res.webSocket;
  expect(ws).not.toBeNull();
  ws!.accept();

  const messages: unknown[] = [];
  const received = new Promise<void>((resolve) => {
    ws!.addEventListener("message", (event) => {
      messages.push(JSON.parse(event.data as string));
      if (messages.length === 2) resolve();
    });
  });
  await received;

  expect(messages[0]).toMatchObject({ type: "hello", data: { retryMs: 1_000 } });
  expect(messages[1]).toMatchObject({ type: "state", data: { id, status: "idle" } });
  ws!.close();
});

it("broadcasts state changes to connected clients", async () => {
  const { id, adminToken } = await createSession();
  const res = await SELF.fetch(`${ORIGIN}/api/sessions/${id}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = res.webSocket!;
  ws.accept();

  const broadcast = new Promise<{ type: string; data: { status: string } }>((resolve) => {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string);
      if (message.type === "state" && message.data.status === "running") resolve(message);
    });
  });

  await postOp(id, { type: "set", durationMs: 60_000 }, adminToken);
  expect((await broadcast).data.status).toBe("running");
  ws.close();
});

it("rejects a plain request to the websocket route", async () => {
  const { id } = await createSession();
  const res = await SELF.fetch(`${ORIGIN}/api/sessions/${id}/ws`);
  expect(res.status).toBe(426);
});

it("expires a running session when the alarm fires", async () => {
  const { id, adminToken } = await createSession();
  const stub = env.SESSION.get(env.SESSION.idFromName(id));
  await stub.applyAdminOp(adminToken, { type: "set", durationMs: 60_000 });

  await runInDurableObject(stub, async (_instance, state) => {
    const session = await state.storage.get<Session>("session");
    await state.storage.put("session", { ...session!, endsAt: Date.now() - 1 });
  });

  expect(await runDurableObjectAlarm(stub)).toBe(true);
  const snapshot = await stub.snapshot();
  expect(snapshot).toMatchObject({ found: true, state: { status: "expired" } });
});

it("deletes the session and announces closed once the ttl passes", async () => {
  const { id, adminToken } = await createSession();
  const stub = env.SESSION.get(env.SESSION.idFromName(id));
  await stub.applyAdminOp(adminToken, { type: "set", durationMs: 1_000 });

  const res = await SELF.fetch(`${ORIGIN}/api/sessions/${id}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = res.webSocket!;
  ws.accept();

  const closed = new Promise<unknown>((resolve) => {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string);
      if (message.type === "closed") resolve(message);
    });
  });

  await runInDurableObject(stub, async (_instance, state) => {
    const session = await state.storage.get<Session>("session");
    await state.storage.put("session", { ...session!, lastAdminOpAt: Date.now() - 2 * 24 * 60 * 60 * 1000 });
  });

  await runDurableObjectAlarm(stub);
  expect(await closed).toEqual({ type: "closed", data: {} });
  expect(await stub.snapshot()).toEqual({ found: false });
});

it("stores only the hash of the admin token", async () => {
  const { id, adminToken } = await createSession();
  const stub = env.SESSION.get(env.SESSION.idFromName(id));

  const stored = await runInDurableObject(stub, async (_instance, state) =>
    state.storage.get<Session>("session"),
  );
  expect(stored!.adminTokenHash).toBe(await hashToken(adminToken));
  expect(stored!.adminTokenHash).not.toBe(adminToken);
});
