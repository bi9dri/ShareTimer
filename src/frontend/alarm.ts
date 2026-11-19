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

export function scheduleOffsetSeconds(remaining: number): number {
  return Math.max(0, remaining) / 1000;
}

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
  private readonly loads = new Map<AlarmSound, Promise<AudioBuffer | null>>();
  private volume: number;

  constructor(volume: number) {
    this.volume = volume;
  }

  private ensureContext(): AudioContext | null {
    if (this.context !== null) return this.context;
    const Constructor = audioContextConstructor();
    if (Constructor === null) return null;
    let context: AudioContext;
    try {
      context = new Constructor();
    } catch {
      return null;
    }
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

  async preload(): Promise<void> {
    await Promise.all(ALARM_SOUNDS.map((sound) => this.load(sound)));
  }

  private load(sound: AlarmSound): Promise<AudioBuffer | null> {
    const ready = this.buffers.get(sound);
    if (ready !== undefined) return Promise.resolve(ready);

    const inFlight = this.loads.get(sound);
    if (inFlight !== undefined) return inFlight;

    const context = this.ensureContext();
    if (context === null) return Promise.resolve(null);

    const pending = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(ALARM_SOURCES[sound]);
        if (!response.ok) return null;
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(sound, buffer);
        return buffer;
      } catch {
        return null;
      } finally {
        this.loads.delete(sound);
      }
    })();

    this.loads.set(sound, pending);
    return pending;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master !== null) this.master.gain.value = volume;
  }

  play(sound: AlarmSound, offsetSeconds: number): void {
    const context = this.ensureContext();
    if (context === null || this.master === null) return;

    if (this.buffers.has(sound)) {
      this.start(sound, offsetSeconds);
      return;
    }
    void this.load(sound).then((buffer) => {
      if (buffer !== null) this.start(sound, 0);
    });
  }

  private start(sound: AlarmSound, offsetSeconds: number): void {
    const context = this.context;
    const master = this.master;
    const buffer = this.buffers.get(sound);
    if (context === null || master === null || buffer === undefined) return;
    if (context.state === "suspended") void context.resume();

    this.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start(context.currentTime + Math.max(0, offsetSeconds));
    this.active.push(source);
  }

  stop(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {}
    }
    this.active = [];
  }
}
