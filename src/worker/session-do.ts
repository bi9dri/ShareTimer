import { DurableObject } from "cloudflare:workers";

import {
  applyOp,
  createSession,
  expireIfDue,
  isDeletedByTtl,
  nextAlarmAt,
  toPublicState,
} from "./domain/session";
import { verifyToken } from "./domain/token";
import type { OpRequest, PublicState, Session } from "./domain/types";
import { encodeMessage, RETRY_MS } from "./protocol";

const SESSION_KEY = "session";

export type SnapshotResult = { found: false } | { found: true; state: PublicState };

export type AdminOpResult =
  | { status: 200; state: PublicState }
  | { status: 401 }
  | { status: 404 }
  | { status: 409; message: string };

export class SessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const session = await this.load();
      if (session !== null && (await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(nextAlarmAt(session));
      }
    });
  }

  async initialize(args: { id: string; adminTokenHash: string }): Promise<void> {
    const now = Date.now();
    const session = createSession({ id: args.id, adminTokenHash: args.adminTokenHash, now });
    await this.save(session);
    await this.ctx.storage.setAlarm(nextAlarmAt(session));
  }

  async snapshot(): Promise<SnapshotResult> {
    const session = await this.load();
    if (session === null) return { found: false };
    return { found: true, state: toPublicState(session, Date.now()) };
  }

  async applyAdminOp(token: string, op: OpRequest): Promise<AdminOpResult> {
    const session = await this.load();
    if (session === null) return { status: 404 };
    if (!(await verifyToken(token, session.adminTokenHash))) return { status: 401 };

    const now = Date.now();
    const outcome = applyOp(session, op, now);
    if (!outcome.ok) return { status: 409, message: outcome.message };

    await this.save(outcome.session);
    await this.ctx.storage.setAlarm(nextAlarmAt(outcome.session));

    const state = toPublicState(outcome.session, now);
    this.broadcast({ type: "state", data: state });
    return { status: 200, state };
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }

    const session = await this.load();
    if (session === null) return new Response("session not found", { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.send(encodeMessage({ type: "hello", data: { retryMs: RETRY_MS } }));
    server.send(encodeMessage({ type: "state", data: toPublicState(session, Date.now()) }));

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") return;
    this.closeQuietly(ws, 1003, "unsupported message");
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.closeQuietly(ws, 1000, "closed");
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.closeQuietly(ws, 1011, "error");
  }

  override async alarm(): Promise<void> {
    const session = await this.load();
    if (session === null) return;

    const now = Date.now();
    if (isDeletedByTtl(session, now)) {
      await this.ctx.storage.deleteAll();
      this.announceClosed();
      return;
    }

    const current = expireIfDue(session, now);
    if (current !== session) {
      await this.save(current);
      this.broadcast({ type: "state", data: toPublicState(current, now) });
    }
    await this.ctx.storage.setAlarm(nextAlarmAt(current));
  }

  private async load(): Promise<Session | null> {
    return (await this.ctx.storage.get<Session>(SESSION_KEY)) ?? null;
  }

  private async save(session: Session): Promise<void> {
    await this.ctx.storage.put(SESSION_KEY, session);
  }

  private broadcast(message: { type: "state"; data: PublicState }): void {
    const payload = encodeMessage(message);
    for (const ws of this.ctx.getWebSockets()) {
      this.sendQuietly(ws, payload);
    }
  }

  private announceClosed(): void {
    const payload = encodeMessage({ type: "closed", data: {} });
    for (const ws of this.ctx.getWebSockets()) {
      this.sendQuietly(ws, payload);
      this.closeQuietly(ws, 1000, "session closed");
    }
  }

  private sendQuietly(ws: WebSocket, payload: string): void {
    try {
      ws.send(payload);
    } catch {
      // The socket is already gone; nothing to do.
    }
  }

  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // The socket is already gone; nothing to do.
    }
  }
}
