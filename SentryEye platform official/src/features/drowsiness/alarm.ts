// Wake-up alarm for microsleep events.
//
// Pure WebAudio — no audio assets to download, works offline, and starts in
// milliseconds. Escalates: a short double beep for a microsleep, a continuous
// urgent siren while a critical microsleep is active. Browser autoplay rules
// require a user gesture first; the live/video pages already start behind a
// click, and `unlock()` resumes the context on any interaction.

export type AlarmLevel = "microsleep" | "critical";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sirenStop: (() => void) | null = null;
let enabled = true;
let lastBeepAt = 0;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Call from a user gesture (start button) so the alarm can sound later. */
export function unlockAlarm() {
  const a = audio();
  if (a && a.state === "suspended") void a.resume();
}

export function setAlarmEnabled(next: boolean) {
  enabled = next;
  if (!next) stopAlarm();
}

export function isAlarmEnabled() {
  return enabled;
}

function tone(freq: number, startAt: number, durationSec: number) {
  const a = audio();
  if (!a || !master) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(1, startAt + 0.01);
  gain.gain.setValueAtTime(1, startAt + durationSec - 0.02);
  gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
  osc.connect(gain);
  gain.connect(master);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

/** Short escalating alert. Throttled so repeated frames can't machine-gun it. */
export function playAlarm(level: AlarmLevel) {
  if (!enabled) return;
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume();

  if (level === "critical") {
    startSiren();
    return;
  }
  const now = performance.now();
  if (now - lastBeepAt < 900) return;
  lastBeepAt = now;
  const t = a.currentTime;
  tone(880, t, 0.16);
  tone(1180, t + 0.2, 0.16);
  vibrate([180, 90, 180]);
}

/** Continuous two-tone siren; safe to call repeatedly while still active. */
export function startSiren() {
  if (!enabled || sirenStop) return;
  const a = audio();
  if (!a || !master) return;
  if (a.state === "suspended") void a.resume();

  const osc = a.createOscillator();
  const gain = a.createGain();
  const lfo = a.createOscillator();
  const lfoGain = a.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = 760;
  lfo.frequency.value = 4;
  lfoGain.gain.value = 260;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  gain.gain.value = 0.9;
  osc.connect(gain);
  gain.connect(master);
  osc.start();
  lfo.start();
  vibrate([400, 120, 400, 120, 400]);

  sirenStop = () => {
    try {
      gain.gain.setTargetAtTime(0, a.currentTime, 0.03);
      osc.stop(a.currentTime + 0.15);
      lfo.stop(a.currentTime + 0.15);
    } catch {
      /* already stopped */
    }
  };
}

export function stopAlarm() {
  sirenStop?.();
  sirenStop = null;
}

function vibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
