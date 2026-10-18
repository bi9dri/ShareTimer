import type { OpRequest, PublicState } from "../worker/domain/types";

export interface SessionCredentials {
  id: string;
  adminToken: string;
}

export type OpOutcome =
  | { ok: true; state: PublicState }
  | { ok: false; status: number; message: string };

export async function createSession(): Promise<SessionCredentials> {
  const response = await fetch("/api/sessions", { method: "POST" });
  if (!response.ok) throw new Error(`セッションを作成できませんでした (${response.status})`);
  return (await response.json()) as SessionCredentials;
}

export async function fetchState(id: string): Promise<PublicState | null> {
  const response = await fetch(`/api/sessions/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`状態を取得できませんでした (${response.status})`);
  const body = (await response.json()) as { state: PublicState };
  return body.state;
}

export async function sendOp(id: string, token: string, op: OpRequest): Promise<OpOutcome> {
  const response = await fetch(`/api/sessions/${id}/ops`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(op),
  });

  const body = (await response.json().catch(() => null)) as { state?: PublicState; error?: string } | null;
  if (response.ok && body?.state !== undefined) return { ok: true, state: body.state };
  return {
    ok: false,
    status: response.status,
    message: body?.error ?? `操作に失敗しました (${response.status})`,
  };
}
