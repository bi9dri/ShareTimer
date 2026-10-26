import { ALARM_SOUNDS, type AlarmSound } from "../worker/domain/constants";
import type { PublicState } from "../worker/domain/types";
import type { ConnectionStatus } from "./connection";
import { formatRemaining } from "./format";
import { parseDuration } from "./limits";

const STATUS_LABELS: Record<PublicState["status"], string> = {
  idle: "待機中",
  running: "動作中",
  paused: "一時停止中",
  expired: "終了",
};

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: "接続中",
  online: "同期済み",
  polling: "切断中",
  closed: "終了しました",
};

const ALARM_SOUND_LABELS: Record<AlarmSound, string> = {
  alarm: "アラーム",
  bell: "鐘",
  piano: "ピアノ",
  jingle: "ジングル",
};

/** Hold this long before the stepper starts repeating. */
const STEP_HOLD_DELAY_MS = 400;

/** Repeat interval once the hold delay has elapsed. */
const STEP_REPEAT_MS = 60;

const MESSAGE_TIMEOUT_MS = 4_000;

const icon = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">${path}</svg>`;

const stepIcon = (path: string): string => `<svg viewBox="0 0 20 20" aria-hidden="true">${path}</svg>`;

const MINUS_ICON = stepIcon(
  '<path d="M5.5 10h9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
);
const STEP_PLUS_ICON = stepIcon(
  '<path d="M10 5.5v9M5.5 10h9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
);

const PLAY_ICON = icon('<path d="M8 5v14l11-7z" fill="currentColor"/>');
const PAUSE_ICON = icon('<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>');
const EXTEND_ICON = icon(
  '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.8 3.2h4.4"/><circle cx="12" cy="13" r="7.4"/><path d="M12 9.7v6.6M8.7 13h6.6"/></g>',
);
const REPEAT_ICON = icon(
  '<path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>',
);
const COPY_ICON = icon(
  '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"/><path d="M3 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/></g>',
);
const VOLUME_ICON = icon(
  '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h3l4-3.5v13L7 15H4z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/></g>',
);

export interface SessionViewHandlers {
  onSetDuration(durationMs: number): void;
  onPause(): void;
  onResume(): void;
  onExtend(deltaMs: number): void;
  onSelectAlarmSound(sound: AlarmSound): void;
  onTestAlarm(): void;
  onVolumeChange(volume: number): void;
  onFirstInteraction(): void;
}

function element<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing element: ${selector}`);
  return found;
}

export class SessionView {
  private readonly root: HTMLElement;
  private readonly remaining: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly connection: HTMLElement;
  private readonly connectionLabel: HTMLElement;
  private readonly admin: HTMLElement;
  private readonly message: HTMLElement;
  private readonly shareUrl: HTMLInputElement;
  private readonly alarmSound: HTMLSelectElement;
  private readonly volume: HTMLInputElement;
  private readonly minutes: HTMLInputElement;
  private readonly seconds: HTMLInputElement;
  private readonly start: HTMLButtonElement;
  private readonly startIcon: HTMLElement;
  private readonly startLabel: HTMLElement;
  private readonly repeatIcon: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly extend: HTMLButtonElement;
  private status: PublicState["status"] = "idle";
  private started = false;
  private durationMs = 0;
  private messageTimer: number | null = null;

  constructor(
    container: HTMLElement,
    private readonly handlers: SessionViewHandlers,
    options: { isAdmin: boolean; volume: number; alarmSound: AlarmSound },
  ) {
    container.innerHTML = `
      <main id="session" class="session" data-status="idle" data-alarming="false">
        <header class="bar">
          <h1 class="brand bar__brand">
            <span class="brand__mark" aria-hidden="true"></span>
            <span class="brand__word" aria-hidden="true"></span>
            <span class="sr-only">ShareTimer</span>
          </h1>
          <p id="status-label" class="status-label">待機中</p>
          <span id="connection" class="conn" data-status="connecting">
            <span class="conn__dot" aria-hidden="true"></span>
            <span id="connection-label" class="conn__tip">接続中</span>
          </span>
        </header>

        <section class="stage">
          <p id="remaining" class="stage__time" aria-live="off">--:--</p>
          <div class="progress" aria-hidden="true"><span id="progress" class="progress__fill"></span></div>
        </section>

        <section class="share">
          <input id="share-url" class="share__url" type="text" readonly aria-label="共有 URL" />
          <button id="copy-link" class="icon-button" type="button" aria-label="URL をコピー" title="URL をコピー">
            ${COPY_ICON}
          </button>
        </section>

        <section id="admin" class="admin" hidden>
          <div class="admin__row">
            <span class="num">
              <span class="field">
                <button class="step" type="button" data-step="-1" aria-label="分を1つ減らす" title="分を1つ減らす">${MINUS_ICON}</button>
                <input id="duration-minutes" class="field__input" type="number" min="0" max="1440" step="1" inputmode="numeric" value="5" aria-label="分" />
                <button class="step" type="button" data-step="1" aria-label="分を1つ増やす" title="分を1つ増やす">${STEP_PLUS_ICON}</button>
              </span>
              <span class="field__unit">分</span>
            </span>
            <span class="num">
              <span class="field">
                <button class="step" type="button" data-step="-1" aria-label="秒を1つ減らす" title="秒を1つ減らす">${MINUS_ICON}</button>
                <input id="duration-seconds" class="field__input" type="number" min="0" max="59" step="1" inputmode="numeric" value="0" aria-label="秒" />
                <button class="step" type="button" data-step="1" aria-label="秒を1つ増やす" title="秒を1つ増やす">${STEP_PLUS_ICON}</button>
              </span>
              <span class="field__unit">秒</span>
            </span>
            <button id="start" class="button button--primary" type="button" aria-label="スタート" title="スタート">
              <span id="start-icon">${PLAY_ICON}</span>
              <span id="repeat-icon" hidden>${REPEAT_ICON}</span>
              <span id="start-label">スタート</span>
            </button>
            <button id="toggle" class="icon-button icon-button--wide" type="button" aria-label="一時停止" title="一時停止" disabled>
              <span id="toggle-play-icon" class="toggle-glyph">${PLAY_ICON}</span>
              <span class="toggle-sep" aria-hidden="true">/</span>
              <span id="toggle-pause-icon" class="toggle-glyph">${PAUSE_ICON}</span>
            </button>
            <button id="extend" class="icon-button" type="button" aria-label="延長" title="延長" disabled>
              ${EXTEND_ICON}
            </button>
          </div>

          <div class="admin__row">
            <select id="alarm-sound" class="select" aria-label="アラーム音"></select>
            <button id="test-alarm" class="button button--ghost" type="button">試聴</button>
          </div>

          <div class="admin__row">
            <span class="volume">
              <span class="volume__icon" aria-hidden="true">${VOLUME_ICON}</span>
              <input id="volume" class="volume__slider" type="range" min="0" max="100" step="1" aria-label="音量" />
            </span>
          </div>
        </section>

        <p id="message" class="message" hidden></p>
      </main>
    `;

    this.root = element(container, "#session");
    this.remaining = element(container, "#remaining");
    this.statusLabel = element(container, "#status-label");
    this.progress = element(container, "#progress");
    this.connection = element(container, "#connection");
    this.connectionLabel = element(container, "#connection-label");
    this.admin = element(container, "#admin");
    this.message = element(container, "#message");
    this.shareUrl = element(container, "#share-url");
    this.alarmSound = element(container, "#alarm-sound");
    this.volume = element(container, "#volume");
    this.minutes = element(container, "#duration-minutes");
    this.seconds = element(container, "#duration-seconds");
    this.start = element(container, "#start");
    this.startIcon = element(container, "#start-icon");
    this.startLabel = element(container, "#start-label");
    this.repeatIcon = element(container, "#repeat-icon");
    this.toggle = element(container, "#toggle");
    this.extend = element(container, "#extend");

    this.shareUrl.value = location.href;

    for (const sound of ALARM_SOUNDS) {
      const option = document.createElement("option");
      option.value = sound;
      option.textContent = ALARM_SOUND_LABELS[sound];
      this.alarmSound.append(option);
    }
    this.alarmSound.value = options.alarmSound;

    this.volume.value = String(Math.round(options.volume * 100));
    this.paintVolume();
    this.admin.hidden = !options.isAdmin;

    this.start.addEventListener("click", () => {
      const duration = this.readDuration();
      if (duration !== null) handlers.onSetDuration(duration);
    });

    this.extend.addEventListener("click", () => {
      const duration = this.readDuration();
      if (duration !== null) handlers.onExtend(duration);
    });

    this.toggle.addEventListener("click", () => {
      if (this.status === "running") handlers.onPause();
      else if (this.status === "paused") handlers.onResume();
    });

    element(container, "#test-alarm").addEventListener("click", () => handlers.onTestAlarm());
    element(container, "#copy-link").addEventListener("click", () => void this.copyLink());

    this.wireSteppers(container);

    this.alarmSound.addEventListener("change", () => {
      handlers.onSelectAlarmSound(this.alarmSound.value as AlarmSound);
    });

    this.volume.addEventListener("input", () => {
      this.paintVolume();
      handlers.onVolumeChange(Number(this.volume.value) / 100);
    });

    const interact = (): void => handlers.onFirstInteraction();
    container.addEventListener("pointerdown", interact, { once: true });
    container.addEventListener("keydown", interact, { once: true });

    this.applyActionAvailability();
  }

  setState(state: PublicState): void {
    const previousDurationMs = this.durationMs;
    this.status = state.status;
    this.started = state.durationMs > 0;
    this.durationMs = state.durationMs;
    this.root.dataset["status"] = state.status;
    this.statusLabel.textContent = STATUS_LABELS[state.status];
    this.alarmSound.value = state.alarmSound;
    // The form mirrors the session, so restarting reproduces what is on screen.
    if (state.durationMs > 0 && state.durationMs !== previousDurationMs) {
      this.writeDuration(state.durationMs);
    }
    this.applyActionAvailability();
  }

  setRemaining(milliseconds: number | null): void {
    const formatted = milliseconds === null ? "--:--" : formatRemaining(milliseconds);
    if (this.remaining.textContent !== formatted) this.remaining.textContent = formatted;

    const ratio =
      milliseconds === null || this.durationMs <= 0
        ? 0
        : Math.min(1, Math.max(0, milliseconds / this.durationMs));
    const width = `${(ratio * 100).toFixed(1)}%`;
    if (this.progress.style.width !== width) this.progress.style.width = width;
  }

  setConnection(status: ConnectionStatus): void {
    this.connection.dataset["status"] = status;
    this.connectionLabel.textContent = CONNECTION_LABELS[status];
  }

  setAlarming(alarming: boolean): void {
    this.root.dataset["alarming"] = String(alarming);
  }

  showMessage(text: string): void {
    this.message.textContent = text;
    this.message.hidden = false;
    if (this.messageTimer !== null) window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => this.clearMessage(), MESSAGE_TIMEOUT_MS);
  }

  clearMessage(): void {
    if (this.messageTimer !== null) {
      window.clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    this.message.hidden = true;
    this.message.textContent = "";
  }

  private paintVolume(): void {
    this.volume.style.setProperty("--fill", `${this.volume.value}%`);
  }

  /** Steps once on press, then repeats while the button is held. */
  private wireSteppers(container: HTMLElement): void {
    for (const step of container.querySelectorAll<HTMLButtonElement>(".step")) {
      let holdTimer: number | null = null;
      let repeatTimer: number | null = null;

      const stop = (): void => {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        if (repeatTimer !== null) window.clearInterval(repeatTimer);
        holdTimer = null;
        repeatTimer = null;
      };

      step.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        this.stepBy(step);
        stop();
        holdTimer = window.setTimeout(() => {
          repeatTimer = window.setInterval(() => this.stepBy(step), STEP_REPEAT_MS);
        }, STEP_HOLD_DELAY_MS);
      });

      // A click with detail 0 was produced by the keyboard, not by the pointer press above.
      step.addEventListener("click", (event) => {
        if (event.detail === 0) this.stepBy(step);
      });

      step.addEventListener("pointerup", stop);
      step.addEventListener("pointercancel", stop);
      step.addEventListener("pointerleave", stop);
      step.addEventListener("blur", stop);
    }
  }

  private stepBy(button: HTMLButtonElement): void {
    const delta = Number(button.dataset["step"]);
    const input = button.closest(".field")?.querySelector<HTMLInputElement>(".field__input") ?? null;
    if (input === null || !Number.isFinite(delta) || delta === 0) return;

    if (input === this.seconds) this.stepSeconds(input, delta);
    else this.setValue(input, this.readValue(input) + delta);
  }

  /** Seconds wrap into the minutes field instead of clamping at its own bounds. */
  private stepSeconds(input: HTMLInputElement, delta: number): void {
    const secondsMax = Number(input.max || "59");
    const minutesMin = Number(this.minutes.min || "0");
    const minutesMax = Number(this.minutes.max || "0");

    let minutes = this.readValue(this.minutes);
    let seconds = this.readValue(input) + delta;

    if (seconds > secondsMax) {
      if (minutes < minutesMax) {
        minutes += 1;
        seconds = 0;
      } else {
        seconds = secondsMax;
      }
    } else if (seconds < 0) {
      if (minutes > minutesMin) {
        minutes -= 1;
        seconds = secondsMax;
      } else {
        seconds = 0;
      }
    }

    this.setValue(this.minutes, minutes);
    this.setValue(input, seconds);
  }

  private writeDuration(durationMs: number): void {
    const totalSeconds = Math.round(durationMs / 1_000);
    this.minutes.value = String(Math.floor(totalSeconds / 60));
    this.seconds.value = String(totalSeconds % 60);
  }

  private readValue(input: HTMLInputElement): number {
    const raw = Number(input.value);
    return Number.isFinite(raw) ? raw : Number(input.min || "0");
  }

  private setValue(input: HTMLInputElement, value: number): void {
    const min = Number(input.min || "0");
    const max = Number(input.max || "0");
    input.value = String(Math.min(max, Math.max(min, value)));
  }

  private applyActionAvailability(): void {
    const running = this.status === "running";
    const resumable = this.status === "paused";

    this.startIcon.hidden = this.started;
    this.repeatIcon.hidden = !this.started;
    const startLabel = this.started ? "タイマーをリセットする" : "スタート";
    this.startLabel.textContent = startLabel;
    this.startLabel.hidden = this.started;
    this.start.setAttribute("aria-label", startLabel);
    this.start.title = startLabel;

    this.toggle.disabled = !running && !resumable;
    const toggleLabel = resumable ? "再開" : "一時停止";
    this.toggle.setAttribute("aria-label", toggleLabel);
    this.toggle.title = toggleLabel;

    this.extend.disabled = !running;
  }

  private readDuration(): number | null {
    const parsed = parseDuration({ minutes: this.minutes.value, seconds: this.seconds.value });
    if (!parsed.ok) {
      this.showMessage(parsed.message);
      return null;
    }
    return parsed.durationMs;
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl.value);
      this.showMessage("URL をコピーしました");
    } catch {
      this.shareUrl.select();
      this.showMessage("URL を選択しました");
    }
  }
}
