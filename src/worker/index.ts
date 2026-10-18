import { MAX_BODY_BYTES } from "./domain/constants";
import { generateSessionId, isValidSessionId } from "./domain/id";
import { generateAdminToken, hashToken } from "./domain/token";
import { parseOp } from "./domain/validation";
import { SessionDurableObject, type SnapshotResult } from "./session-do";

export { SessionDurableObject };

const SESSION_PATH = /^\/api\/sessions\/([^/]+)(\/ws|\/ops)?$/;

type SessionStub = DurableObjectStub<SessionDurableObject>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function createSession(env: Env): Promise<Response> {
  const id = generateSessionId();
  const adminToken = generateAdminToken();
  const stub = env.SESSION.get(env.SESSION.idFromName(id));
  await stub.initialize({ id, adminTokenHash: await hashToken(adminToken) });
  return json({ id, adminToken }, 201);
}

function serverTime(url: URL): Response {
  const raw = url.searchParams.get("t0");
  const t0 = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(t0)) return json({ error: "t0 must be a number" }, 422);
  return json({ serverTime: Date.now(), t0 });
}

async function snapshot(stub: SessionStub): Promise<Response> {
  const result: SnapshotResult = await stub.snapshot();
  if (!result.found) return json({ error: "not found" }, 404);
  return json({ state: result.state });
}

async function readOpBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return TOO_LARGE;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return TOO_LARGE;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

const TOO_LARGE = Symbol("too-large");
const INVALID_JSON = Symbol("invalid-json");

async function applyOpRequest(request: Request, stub: SessionStub): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";

  const body = await readOpBody(request);
  if (body === TOO_LARGE) return json({ error: "request body too large" }, 413);
  if (body === INVALID_JSON) return json({ error: "invalid json body" }, 400);

  const parsed = parseOp(body);
  if (!parsed.ok) return json({ error: parsed.message }, parsed.status);

  const result = await stub.applyAdminOp(token, parsed.op);
  switch (result.status) {
    case 200:
      return json({ state: result.state });
    case 409:
      return json({ error: result.message }, 409);
    case 401:
      return json({ error: "unauthorized" }, 401);
    default:
      return json({ error: "not found" }, 404);
  }
}

async function serveAssets(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;

  const url = new URL(request.url);
  url.pathname = "/";
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveAssets(request, env);

    if (url.pathname === "/api/sessions" && request.method === "POST") {
      return createSession(env);
    }
    if (url.pathname === "/api/time" && request.method === "GET") {
      return serverTime(url);
    }

    const match = SESSION_PATH.exec(url.pathname);
    if (match === null) return json({ error: "not found" }, 404);

    const id = match[1]!;
    const suffix = match[2];
    if (!isValidSessionId(id)) return json({ error: "not found" }, 404);

    const stub = env.SESSION.get(env.SESSION.idFromName(id));
    if (suffix === "/ws" && request.method === "GET") return stub.fetch(request);
    if (suffix === "/ops" && request.method === "POST") return applyOpRequest(request, stub);
    if (suffix === undefined && request.method === "GET") return snapshot(stub);

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
