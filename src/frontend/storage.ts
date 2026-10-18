export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "sharetimer:";

export const VOLUME_KEY = `${PREFIX}volume`;

export function adminTokenKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function loadAdminToken(store: KeyValueStore, sessionId: string): string | null {
  return store.getItem(adminTokenKey(sessionId));
}

export function saveAdminToken(store: KeyValueStore, sessionId: string, token: string): void {
  store.setItem(adminTokenKey(sessionId), token);
}

export function clearAdminToken(store: KeyValueStore, sessionId: string): void {
  store.removeItem(adminTokenKey(sessionId));
}

export function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

export function loadVolume(store: KeyValueStore): number {
  const raw = store.getItem(VOLUME_KEY);
  if (raw === null) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampVolume(parsed) : 1;
}

export function saveVolume(store: KeyValueStore, volume: number): void {
  store.setItem(VOLUME_KEY, String(clampVolume(volume)));
}

export function browserStore(): KeyValueStore {
  try {
    return window.localStorage;
  } catch {
    const entries = new Map<string, string>();
    return {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => void entries.set(key, value),
      removeItem: (key) => void entries.delete(key),
    };
  }
}
