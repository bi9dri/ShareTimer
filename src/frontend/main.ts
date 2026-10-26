import type { AlarmSound } from "../worker/domain/constants";
import { isValidSessionId } from "../worker/domain/id";
import type { OpRequest, PublicState } from "../worker/domain/types";
import {
  type AlarmGate,
  evaluateAlarm,
  initAlarmGate,
  scheduleOffsetSeconds,
  WebAudioAlarm,
} from "./alarm";
import { createSession, fetchState, sendOp } from "./api";
import { measureOffset, remainingMs, RESYNC_INTERVAL_MS } from "./clock";
import { connectSession } from "./connection";
import { MAX_DURATION_LABEL, wasExtendClamped } from "./limits";
import { browserStore, loadAdminToken, loadVolume, saveAdminToken, saveVolume } from "./storage";
import { SessionView, type SessionViewHandlers } from "./view";

const SESSION_ROUTE = /^\/s\/([^/]+)\/?$/;
const TICK_INTERVAL_MS = 100;
const RESYNC_NEAR_END_MS = 5_000;
const ALARM_RESET_MS = 6_000;

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) void start(root);

async function start(container: HTMLElement): Promise<void> {
  const match = SESSION_ROUTE.exec(location.pathname);
  if (match === null) {
    renderLanding(container);
    return;
  }

  const sessionId = match[1]!;
  if (!isValidSessionId(sessionId)) {
    renderNotFound(container);
    return;
  }
  await renderSession(container, sessionId);
}

function renderLanding(container: HTMLElement): void {
  container.innerHTML = `
    <main class="landing">
      <h1 class="brand landing__brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__word" aria-hidden="true"></span>
        <span class="sr-only">ShareTimer</span>
      </h1>
      <p class="landing__lead">
        複数の端末で同じカウントダウンを共有できます。アカウント登録は不要です。
      </p>
      <button id="create" class="button button--primary" type="button">セッションを作成</button>
      <p id="landing-message" class="message" hidden></p>
    </main>
  `;

  const button = container.querySelector<HTMLButtonElement>("#create")!;
  const message = container.querySelector<HTMLParagraphElement>("#landing-message")!;

  button.addEventListener("click", () => {
    button.disabled = true;
    createSession()
      .then(({ id, adminToken }) => {
        saveAdminToken(browserStore(), id, adminToken);
        location.assign(`/s/${id}`);
      })
      .catch((error: unknown) => {
        button.disabled = false;
        message.hidden = false;
        message.textContent = error instanceof Error ? error.message : "作成に失敗しました";
      });
  });
}

function renderNotFound(container: HTMLElement): void {
  container.innerHTML = `
    <main class="landing">
      <h1 class="brand landing__brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__word" aria-hidden="true"></span>
        <span class="sr-only">ShareTimer</span>
      </h1>
      <p class="landing__lead">セッションが見つかりません。URL を確認してください。</p>
      <a class="button button--primary" href="/">新しいセッションを作成</a>
    </main>
  `;
}

async function renderSession(container: HTMLElement, sessionId: string): Promise<void> {
  const initial = await fetchState(sessionId);
  if (initial === null) {
    renderNotFound(container);
    return;
  }

  const store = browserStore();
  const adminToken = loadAdminToken(store, sessionId);
  const alarm = new WebAudioAlarm(loadVolume(store));
  void alarm.preload();

  let state: PublicState = initial;
  let offset = 0;
  let gate: AlarmGate = initAlarmGate();
  let resyncedGeneration: number | null = null;
  let alarmShown = false;
  let alarmResetTimer: number | null = null;
  let frame = 0;

  const viewRef: { current: SessionView | null } = { current: null };
  const view = (): SessionView => {
    if (viewRef.current === null) throw new Error("view is not ready");
    return viewRef.current;
  };

  async function operate(op: OpRequest): Promise<void> {
    if (adminToken === null) return;
    const result = await sendOp(sessionId, adminToken, op);
    if (!result.ok) {
      view().showMessage(result.message);
      return;
    }
    view().clearMessage();
    applyState(result.state);
  }

  async function extendBy(deltaMs: number): Promise<void> {
    if (adminToken === null) return;
    const previousEndsAt = state.endsAt;
    const result = await sendOp(sessionId, adminToken, { type: "extend", deltaMs });
    if (!result.ok) {
      view().showMessage(result.message);
      return;
    }
    if (wasExtendClamped(previousEndsAt, deltaMs, result.state.endsAt)) {
      view().showMessage(`延長できるのは最大 ${MAX_DURATION_LABEL}までです。これ以上は延長されません。`);
    } else {
      view().clearMessage();
    }
    applyState(result.state);
  }

  const handlers: SessionViewHandlers = {
    onSetDuration: (durationMs) => void operate({ type: "set", durationMs, alarmSound: state.alarmSound }),
    onPause: () => void operate({ type: "pause" }),
    onResume: () => void operate({ type: "resume" }),
    onExtend: (deltaMs) => void extendBy(deltaMs),
    onSelectAlarmSound: (alarmSound: AlarmSound) => void operate({ type: "setAlarmSound", alarmSound }),
    onTestAlarm: () => {
      void alarm.unlock().then(() => alarm.play(state.alarmSound, 0));
    },
    onVolumeChange: (volume) => {
      alarm.setVolume(volume);
      saveVolume(store, volume);
    },
    onFirstInteraction: () => {
      void alarm.unlock();
      void refreshOffset();
    },
  };

  viewRef.current = new SessionView(container, handlers, {
    isAdmin: adminToken !== null,
    volume: loadVolume(store),
    alarmSound: initial.alarmSound,
  });

  function computeRemaining(current: PublicState): number {
    if (current.status === "running" && current.endsAt !== null) {
      return remainingMs(current.endsAt, Date.now(), offset);
    }
    if (current.status === "paused" && current.remainingMs !== null) return current.remainingMs;
    return 0;
  }

  function clearAlarming(): void {
    alarmShown = false;
    if (alarmResetTimer !== null) {
      window.clearTimeout(alarmResetTimer);
      alarmResetTimer = null;
    }
    view().setAlarming(false);
  }

  /** Schedules the sound so it lands on the boundary; it does not touch the display. */
  function armAlarm(remaining: number): void {
    alarm.play(state.alarmSound, scheduleOffsetSeconds(remaining));
  }

  /** Flips the alarm display, exactly when the clock reads zero. */
  function showAlarm(): void {
    if (alarmShown) return;
    alarmShown = true;
    view().setAlarming(true);
    if (alarmResetTimer !== null) window.clearTimeout(alarmResetTimer);
    alarmResetTimer = window.setTimeout(() => {
      alarmResetTimer = null;
      view().setAlarming(false);
    }, ALARM_RESET_MS);
  }

  function maybeResync(remaining: number, current: PublicState): void {
    if (current.endsAt === null || remaining > RESYNC_NEAR_END_MS) return;
    if (resyncedGeneration === current.endsAt) return;
    resyncedGeneration = current.endsAt;
    void refreshOffset();
  }

  function tick(): void {
    if (state.status === "idle") {
      view().setRemaining(null);
      return;
    }

    const remaining = computeRemaining(state);
    view().setRemaining(remaining);

    // An expiring timer may reach the client before this tick sees zero. Only a
    // client that armed the alarm watches the run, so a late joiner stays silent.
    if (state.status === "expired") {
      if (gate.scheduled) showAlarm();
      return;
    }
    if (state.status !== "running") return;

    const decision = evaluateAlarm(gate, state, remaining);
    gate = decision.gate;
    if (decision.fire) armAlarm(remaining);
    // The frame loop paints the display; this covers a hidden tab, where rAF stops.
    if (remaining <= 0) showAlarm();
    maybeResync(remaining, state);
  }

  function applyState(next: PublicState): void {
    const previousEndsAt = state.endsAt;
    state = next;
    // A pause leaves the scheduled source running until its old deadline, and a
    // reschedule replaces it. Expiry must not stop it: that state arrives as the
    // alarm starts.
    const paused = next.status === "paused";
    const rescheduled = next.status === "running" && next.endsAt !== previousEndsAt;
    if (paused || rescheduled) {
      alarm.stop();
      clearAlarming();
    }
    view().setState(next);
    tick();
    startPainting();
  }

  async function refreshOffset(): Promise<void> {
    const sample = await measureOffset();
    if (sample !== null) offset = sample.offset;
  }

  view().setState(initial);
  tick();

  // Painting runs at frame rate so the progress line moves smoothly while a
  // countdown is live. Arming the alarm stays on the interval below: rAF stops
  // in a hidden tab.
  const paint = (): void => {
    frame = 0;
    if (state.status !== "running") return;
    const remaining = computeRemaining(state);
    view().setRemaining(remaining);
    if (remaining <= 0) {
      showAlarm();
      return;
    }
    frame = window.requestAnimationFrame(paint);
  };
  const startPainting = (): void => {
    if (frame === 0 && state.status === "running") frame = window.requestAnimationFrame(paint);
  };
  startPainting();

  const disconnect = connectSession(sessionId, {
    onState: applyState,
    onStatus: (status) => {
      view().setConnection(status);
      if (status === "closed") view().showMessage("このセッションは終了しました");
    },
  });

  const tickTimer = window.setInterval(tick, TICK_INTERVAL_MS);
  const resyncTimer = window.setInterval(() => void refreshOffset(), RESYNC_INTERVAL_MS);

  window.addEventListener("pagehide", () => {
    window.clearInterval(tickTimer);
    window.clearInterval(resyncTimer);
    window.cancelAnimationFrame(frame);
    if (alarmResetTimer !== null) window.clearTimeout(alarmResetTimer);
    disconnect();
    alarm.stop();
  });

  window.addEventListener("pageshow", (event) => {
    // A bfcache restore brings back dead timers and sockets; reload to rejoin.
    if (event.persisted) location.reload();
  });

  void refreshOffset();
}
