import { ALARM_SOUNDS, type AlarmSound } from "../worker/domain/constants";
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

/** Seconds from now until the deadline. The sound starts on the boundary itself. */
export function scheduleOffsetSeconds(remaining: number): number {
  return Math.max(0, remaining) / 1000;
}

/**
 * Bundled preset files. Every preset is decoded up front so a scheduled start
 * is never delayed by a fetch (ADR 0003).
 */
export const ALARM_SOURCES: Record<AlarmSound, string> = {
  alarm: "/alarm/alarm.wav",
  bell: "/alarm/bell.wav",
  piano: "/alarm/piano.wav",
  jingle: "/alarm/jingle.wav",
};

export interface AlarmPlayer {
  unlock(): Promise<boolean>;
  isUnlocked(): boolean;
  preload(): Promise<void>;
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
  private active: AudioBufferSourceNode[] = [];
  private readonly buffers = new Map<AlarmSound, AudioBuffer>();
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

  /**
   * Fetches and decodes every preset. Decoding needs no user gesture, so this
   * runs at startup: the deadline is never spent waiting on a download.
   */
  async preload(): Promise<void> {
    const context = this.ensureContext();
    if (context === null) return;
    await Promise.all(
      ALARM_SOUNDS.map(async (sound) => {
        if (this.buffers.has(sound)) return;
        try {
          const response = await fetch(ALARM_SOURCES[sound]);
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(sound, buffer);
        } catch {
          // Undecoded presets stay silent rather than breaking the alarm path.
        }
      }),
    );
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master !== null) this.master.gain.value = volume;
  }

  play(sound: AlarmSound, offsetSeconds: number): void {
    const context = this.ensureContext();
    const buffer = this.buffers.get(sound);
    if (context === null || this.master === null || buffer === undefined) return;
    if (context.state === "suspended") void context.resume();

    this.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    // Scheduled on the audio clock, so the deadline is hit regardless of timer jitter.
    source.start(context.currentTime + Math.max(0, offsetSeconds));
    this.active.push(source);
  }

  stop(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.active = [];
  }
}
