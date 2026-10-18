export interface TimeSample {
  offset: number;
  rtt: number;
}

export const SYNC_SAMPLES = 5;

export const RESYNC_INTERVAL_MS = 30_000;

export function computeSample(args: {
  t0: number;
  t1: number;
  serverTime: number;
}): TimeSample {
  return { offset: args.serverTime - (args.t0 + args.t1) / 2, rtt: args.t1 - args.t0 };
}

export function selectBestSample(samples: readonly TimeSample[]): TimeSample | null {
  let best: TimeSample | null = null;
  for (const sample of samples) {
    if (best === null || sample.rtt < best.rtt) best = sample;
  }
  return best;
}

export function remainingMs(endsAt: number, now: number, offset: number): number {
  return endsAt - (now + offset);
}

async function measureOnce(): Promise<TimeSample | null> {
  const t0 = Date.now();
  try {
    const response = await fetch(`/api/time?t0=${t0}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { serverTime: number };
    return computeSample({ t0, t1: Date.now(), serverTime: body.serverTime });
  } catch {
    return null;
  }
}

export async function measureOffset(samples: number = SYNC_SAMPLES): Promise<TimeSample | null> {
  const results: TimeSample[] = [];
  for (let i = 0; i < samples; i++) {
    const sample = await measureOnce();
    if (sample !== null) results.push(sample);
  }
  return selectBestSample(results);
}
