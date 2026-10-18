import { type AlarmSound } from "../worker/domain/constants";
import type { PublicState } from "../worker/domain/types";

export const SCHEDULE_LEAD_MS = 1_500;

export interface AlarmGate {
  generation: number | null;
  scheduled: boolean;
}

export interface AlarmDecision {
  gate: AlarmGate;
  fire: boolean;
}

export function initAlarmGate(): AlarmGate {
  return { generation: null, scheduled: false };
}

export function evaluateAlarm(
  gate: AlarmGate,
  state: PublicState,
  remaining: number,
  leadMs: number = SCHEDULE_LEAD_MS,
): AlarmDecision {
  const generation = state.status === "running" && state.endsAt !== null ? state.endsAt : null;
  const scheduled = generation !== null && generation === gate.generation ? gate.scheduled : false;

  if (generation !== null && !scheduled && remaining <= leadMs) {
    return { gate: { generation, scheduled: true }, fire: true };
  }
  return { gate: { generation, scheduled }, fire: false };
}

export function scheduleOffsetSeconds(remaining: number, outputLatencyMs: number): number {
  return Math.max(0, remaining - outputLatencyMs) / 1000;
}

export interface ToneSpec {
  wave: OscillatorType;
  frequency: number;
  durationMs: number;
  gain: number;
  startMs: number;
}

function tones(spec: Omit<ToneSpec, "startMs">, count: number, gapMs: number): ToneSpec[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ...spec,
    startMs: index * gapMs,
  }));
}

export const ALARM_PRESETS: Record<AlarmSound, ToneSpec[]> = {
  beep: tones({ wave: "square", frequency: 880, durationMs: 150, gain: 0.35 }, 3, 250),
  chime: [
    { wave: "sine", frequency: 784, durationMs: 700, gain: 0.35, startMs: 0 },
    { wave: "sine", frequency: 988, durationMs: 700, gain: 0.3, startMs: 220 },
    { wave: "sine", frequency: 1_319, durationMs: 900, gain: 0.25, startMs: 440 },
  ],
  bell: [
    { wave: "triangle", frequency: 660, durationMs: 1_400, gain: 0.4, startMs: 0 },
    { wave: "sine", frequency: 1_320, durationMs: 1_200, gain: 0.15, startMs: 0 },
  ],
};

export interface AlarmPlayer {
  unlock(): Promise<boolean>;
  isUnlocked(): boolean;
  outputLatencyMs(): number;
  play(sound: AlarmSound, offsetSeconds: number): void;
  stop(): void;
  setVolume(volume: number): void;
}

interface AudioContextConstructor {
  new (): AudioContext;
}

function audioContextConstructor(): AudioContextConstructor | null {
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class WebAudioAlarm implements AlarmPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: OscillatorNode[] = [];
  private volume: number;

  constructor(volume: number) {
    this.volume = volume;
  }

  private ensureContext(): AudioContext | null {
    if (this.context !== null) return this.context;
    const Constructor = audioContextConstructor();
    if (Constructor === null) return null;
    const context = new Constructor();
    const master = context.createGain();
    master.gain.value = this.volume;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    return context;
  }

  async unlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (context === null) return false;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    return context.state === "running";
  }

  isUnlocked(): boolean {
    return this.context !== null && this.context.state === "running";
  }

  outputLatencyMs(): number {
    const context = this.context;
    if (context === null) return 0;
    const latency = context.outputLatency || context.baseLatency || 0;
    return Number.isFinite(latency) ? latency * 1_000 : 0;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master !== null) this.master.gain.value = volume;
  }

  play(sound: AlarmSound, offsetSeconds: number): void {
    const context = this.ensureContext();
    if (context === null || this.master === null) return;
    if (context.state === "suspended") void context.resume();

    this.stop();
    const startAt = context.currentTime + Math.max(0, offsetSeconds);

    for (const tone of ALARM_PRESETS[sound]) {
      const toneStart = startAt + tone.startMs / 1000;
      const toneEnd = toneStart + tone.durationMs / 1000;
      const holdUntil = Math.max(toneStart, toneEnd - 0.03);

      const oscillator = context.createOscillator();
      oscillator.type = tone.wave;
      oscillator.frequency.value = tone.frequency;

      const gain = context.createGain();
      gain.gain.setValueAtTime(0, toneStart);
      gain.gain.linearRampToValueAtTime(tone.gain, toneStart + 0.01);
      gain.gain.setValueAtTime(tone.gain, holdUntil);
      gain.gain.linearRampToValueAtTime(0, toneEnd);

      oscillator.connect(gain);
      gain.connect(this.master);

      oscillator.start(toneStart);
      oscillator.stop(toneEnd);
      this.active.push(oscillator);
    }
  }

  stop(): void {
    for (const oscillator of this.active) {
      try {
        oscillator.stop();
      } catch {
        // Already stopped.
      }
    }
    this.active = [];
  }
}
