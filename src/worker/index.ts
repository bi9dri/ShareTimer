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

const ORIGIN_PLACEHOLDER = "{{ORIGIN}}";
const PATH_PLACEHOLDER = "{{PATH}}";
const QUERY_PLACEHOLDER = "{{QUERY}}";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header.split(",").some((candidate) => {
    const tag = candidate.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

/**
 * OGP and canonical URLs must be absolute, but the deployment host is not known
 * at build time, so the placeholders are filled per request instead of pinning
 * a domain. The query stays separate: it names no distinct page here, so
 * canonical drops it while og:url keeps the URL that was actually shared.
 */
async function withSiteMeta(request: Request, response: Response, url: URL): Promise<Response> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) return response;

  // A HEAD carries no body to rewrite, and the asset's validator would not
  // describe the GET representation, so it is dropped rather than reused.
  if (request.method === "HEAD") {
    const headers = new Headers(response.headers);
    headers.delete("etag");
    return new Response(null, { status: response.status, headers });
  }

  // A replacer function keeps `$&` and friends in the URL from being read as
  // replacement patterns, which would leave the placeholder in the page.
  const html = (await response.text())
    .replaceAll(ORIGIN_PLACEHOLDER, () => escapeAttribute(url.origin))
    .replaceAll(PATH_PLACEHOLDER, () => escapeAttribute(url.pathname))
    .replaceAll(QUERY_PLACEHOLDER, () => escapeAttribute(url.search));

  // The etag identifies the bytes sent, so it is derived from the rewritten
  // HTML rather than inherited from the asset it came from.
  const etag = `"${await sha256(html)}"`;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("etag", etag);

  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(html, { status: response.status, headers });
}

async function serveAssets(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return withSiteMeta(request, response, url);

  // Client-side routes such as /s/:id are not files; serve the app shell.
  const shell = new URL(url);
  shell.pathname = "/";
  return withSiteMeta(request, await env.ASSETS.fetch(new Request(shell, request)), url);
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
