import type { PublicState } from "../worker/domain/types";

export const PING_INTERVAL_MS = 25_000;

export const PONG_TIMEOUT_MS = 45_000;

export const MAX_BACKOFF_MS = 30_000;

export const DEFAULT_RETRY_MS = 1_000;

export const POLL_INTERVAL_MS = 5_000;

export const MAX_WS_FAILURES = 3;

export type ConnectionStatus = "connecting" | "online" | "polling" | "closed";

export function backoffDelay(
  attempt: number,
  baseMs: number,
  random: () => number = Math.random,
): number {
  const capped = Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
  return capped / 2 + random() * (capped / 2);
}

export function isPongOverdue(
  lastPongAt: number,
  now: number,
  timeoutMs: number = PONG_TIMEOUT_MS,
): boolean {
  return now - lastPongAt > timeoutMs;
}

export interface ConnectionEvents {
  onState(state: PublicState): void;
  onStatus(status: ConnectionStatus): void;
}

type ServerMessage = { type: string; data: unknown };

function parseMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const message = parsed as { type?: unknown; data?: unknown };
    if (typeof message.type !== "string") return null;
    return { type: message.type, data: message.data };
  } catch {
    return null;
  }
}

export function connectSession(sessionId: string, events: ConnectionEvents): () => void {
  const socketUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/sessions/${sessionId}/ws`;

  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let failures = 0;
  let retryMs = DEFAULT_RETRY_MS;
  let lastPongAt = Date.now();
  let reconnectTimer: number | null = null;
  let pingTimer: number | null = null;
  let pollTimer: number | null = null;
  let pollTicks = 0;

  function clearReconnect(): void {
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function stopPinging(): void {
    if (pingTimer !== null) window.clearInterval(pingTimer);
    pingTimer = null;
  }

  function stopPolling(): void {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    pollTimer = null;
    pollTicks = 0;
  }

  function startPinging(): void {
    stopPinging();
    pingTimer = window.setInterval(() => {
      if (socket === null || socket.readyState !== WebSocket.OPEN) return;
      if (isPongOverdue(lastPongAt, Date.now())) {
        socket.close(4000, "pong timeout");
        return;
      }
      socket.send("ping");
    }, PING_INTERVAL_MS);
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    clearReconnect();
    if (failures >= MAX_WS_FAILURES) {
      startPolling();
      return;
    }
    events.onStatus("connecting");
    const delay = backoffDelay(attempt, retryMs);
    attempt += 1;
    reconnectTimer = window.setTimeout(open, delay);
  }

  function open(): void {
    if (stopped) return;
    clearReconnect();
    events.onStatus("connecting");

    let next: WebSocket;
    try {
      next = new WebSocket(socketUrl);
    } catch {
      failures += 1;
      scheduleReconnect();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      attempt = 0;
      failures = 0;
      lastPongAt = Date.now();
      stopPolling();
      events.onStatus("online");
      startPinging();
    });

    next.addEventListener("message", (event) => {
      if (event.data === "pong") {
        lastPongAt = Date.now();
        return;
      }
      const message = parseMessage(event.data);
      if (message === null) return;

      switch (message.type) {
        case "hello":
          retryMs = (message.data as { retryMs?: number }).retryMs ?? retryMs;
          break;
        case "state":
          events.onState(message.data as PublicState);
          break;
        case "closed":
          shutdown();
          events.onStatus("closed");
          break;
        case "time":
          break;
        default:
          break;
      }
    });

    next.addEventListener("close", () => {
      if (stopped) return;
      socket = null;
      stopPinging();
      failures += 1;
      scheduleReconnect();
    });

    next.addEventListener("error", () => {
      // The close event that follows drives the reconnect.
    });
  }

  async function poll(): Promise<void> {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`);
      if (response.status === 404) {
        shutdown();
        events.onStatus("closed");
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as { state: PublicState };
      events.onState(body.state);
    } catch {
      // Transient network failure; the next tick retries.
    }
  }

  function startPolling(): void {
    clearReconnect();
    stopPinging();
    if (pollTimer !== null) return;
    events.onStatus("polling");
    pollTicks = 0;
    pollTimer = window.setInterval(() => {
      pollTicks += 1;
      if (pollTicks % 6 === 0 && socket === null) {
        failures = 0;
        open();
        return;
      }
      void poll();
    }, POLL_INTERVAL_MS);
    void poll();
  }

  function shutdown(): void {
    stopped = true;
    clearReconnect();
    stopPinging();
    stopPolling();
    const current = socket;
    socket = null;
    if (current !== null) {
      try {
        current.close();
      } catch {
        // Already closed.
      }
    }
  }

  function wake(): void {
    if (stopped) return;
    if (socket !== null && socket.readyState === WebSocket.OPEN) return;
    attempt = 0;
    failures = 0;
    stopPolling();
    open();
  }

  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
  });

  open();

  return () => {
    window.removeEventListener("online", wake);
    shutdown();
  };
}
