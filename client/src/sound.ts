// =====================================================================
// 사운드 (효과음 + 배경음악)
// - 음원 파일 없이 Web Audio 로 브라우저가 직접 소리를 만들어 냅니다.
//   → 저작권 문제가 없고, 내려받을 파일도 없어 가볍습니다.
// - 볼륨: 전체 / 배경음악 / 효과음 / 알림(타이머·반지·입장) — 각자 기기에만 저장
// - 브라우저 정책상 사용자가 화면을 한 번 누른 뒤에만 소리가 납니다 (unlock).
// =====================================================================
import type { BgmTrack } from "../../shared/protocol";
import { getPrefs, onPrefsSound } from "./prefs";

type Channel = "sfx" | "alert";

let ctx: AudioContext | null = null;
let master: GainNode;
let bgmBus: GainNode;
let sfxBus: GainNode;
let alertBus: GainNode;
let noiseBuf: AudioBuffer | null = null;
const listeners = new Set<() => void>();

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.connect(comp);
  bgmBus = ctx.createGain();
  sfxBus = ctx.createGain();
  alertBus = ctx.createGain();
  bgmBus.connect(master);
  sfxBus.connect(master);
  alertBus.connect(master);
  applyVolumes();
  ctx.onstatechange = () => listeners.forEach((f) => f());
  return ctx;
}

/** 볼륨 설정 반영 (설정이 바뀔 때 호출) */
export function applyVolumes() {
  if (!ctx) return;
  const p = getPrefs();
  const t = ctx.currentTime;
  const v = (x: number) => Math.max(0, Math.min(1, x / 100));
  master.gain.setTargetAtTime(p.muted ? 0 : v(p.volMaster), t, 0.03);
  bgmBus.gain.setTargetAtTime(v(p.volBgm) * 0.55, t, 0.05);
  sfxBus.gain.setTargetAtTime(v(p.volSfx), t, 0.03);
  alertBus.gain.setTargetAtTime(v(p.volAlert), t, 0.03);
}

/** 사용자 터치/클릭 뒤 호출 → 소리 사용 가능 */
export function unlock() {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") c.resume().then(() => listeners.forEach((f) => f())).catch(() => {});
  if (wantedTrack && !bgm) startBgm(wantedTrack);
  listeners.forEach((f) => f());
}

export function soundReady(): boolean {
  return !!ctx && ctx.state === "running";
}

export function onSoundState(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// 첫 터치/클릭/키 입력 때 자동으로 소리 켜기
for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, () => unlock(), { capture: true, passive: true });

// ---------------------------------------------------------------------
// 소리 재료
// ---------------------------------------------------------------------
function noise(): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const c = ctx!;
  noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

interface ToneOpt {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  to?: number;
  filter?: number;
}

function tone(freq: number, when: number, dur: number, dest: AudioNode, o: ToneOpt = {}) {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(freq, when);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, when + dur);
  const a = o.attack ?? 0.005;
  const r = o.release ?? dur;
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + a);
  g.gain.exponentialRampToValueAtTime(0.0001, when + a + r);
  let node: AudioNode = osc;
  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.filter;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + a + r + 0.05);
}

interface NoiseOpt {
  type?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
  gain?: number;
  attack?: number;
}

function burst(when: number, dur: number, dest: AudioNode, o: NoiseOpt = {}) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noise();
  const f = c.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.frequency.setValueAtTime(o.freq ?? 2000, when);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, when + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, when + a);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(when, Math.random() * 0.5);
  src.stop(when + dur + 0.02);
}

// ---------------------------------------------------------------------
// 효과음
// ---------------------------------------------------------------------
export type Sfx = "pick" | "place" | "flip" | "shuffle" | "draw" | "deal" | "ring" | "win" | "alarm" | "tick" | "join" | "uno" | "claim" | "peek";

const CHANNEL: Record<Sfx, Channel> = {
  pick: "sfx",
  place: "sfx",
  flip: "sfx",
  shuffle: "sfx",
  draw: "sfx",
  deal: "sfx",
  ring: "alert",
  win: "alert",
  alarm: "alert",
  tick: "alert",
  join: "alert",
  uno: "alert",
  claim: "alert",
  peek: "sfx",
};

const lastPlayed = new Map<Sfx, number>();

/** 효과음 재생. volume: 0~1 (다른 사람 동작은 작게) */
export function sfx(name: Sfx, volume = 1) {
  if (!getPrefs().sfxOn && CHANNEL[name] === "sfx") return;
  const c = ctx;
  if (!c || c.state !== "running") return;
  const now = c.currentTime;
  const last = lastPlayed.get(name) ?? 0;
  if (now - last < 0.04) return; // 같은 소리가 겹쳐서 시끄러워지지 않게
  lastPlayed.set(name, now);
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(CHANNEL[name] === "sfx" ? sfxBus : alertBus);
  const t = now + 0.005;
  switch (name) {
    case "pick":
      burst(t, 0.05, out, { type: "highpass", freq: 2500, gain: 0.22 });
      tone(900, t, 0.04, out, { to: 1300, gain: 0.05 });
      break;
    case "place":
      burst(t, 0.07, out, { type: "lowpass", freq: 1200, gain: 0.45 });
      tone(170, t, 0.09, out, { to: 80, gain: 0.25 });
      break;
    case "flip":
      burst(t, 0.13, out, { freq: 1600, to: 4500, q: 1.3, gain: 0.32, attack: 0.02 });
      break;
    case "shuffle":
      for (let i = 0; i < 16; i++) burst(t + i * 0.032 + Math.random() * 0.01, 0.03, out, { freq: 2600 + Math.random() * 1500, q: 2, gain: 0.18 });
      break;
    case "draw":
      burst(t, 0.18, out, { freq: 2800, to: 1100, q: 1, gain: 0.25, attack: 0.03 });
      break;
    case "deal":
      for (let i = 0; i < 5; i++) burst(t + i * 0.07, 0.06, out, { freq: 2400, to: 4200, q: 1.5, gain: 0.22 });
      break;
    case "ring":
      tone(1568, t, 0.9, out, { gain: 0.18, release: 0.9 });
      tone(2349, t + 0.02, 0.7, out, { gain: 0.1, release: 0.7 });
      tone(3136, t + 0.04, 0.5, out, { gain: 0.05, release: 0.5 });
      break;
    case "win": {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => tone(f, t + i * 0.13, 0.25, out, { type: "triangle", gain: 0.22, release: 0.25 }));
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, t + 0.55, 1.2, out, { type: "triangle", gain: 0.12, release: 1.2 }));
      break;
    }
    case "alarm":
      for (let i = 0; i < 3; i++) tone(880, t + i * 0.22, 0.14, out, { type: "square", gain: 0.12, release: 0.14, filter: 3000 });
      break;
    case "tick":
      tone(1250, t, 0.04, out, { gain: 0.12, release: 0.04 });
      break;
    case "uno":
      // 경쾌한 "우-노!" 두 음 + 반짝임
      tone(659.25, t, 0.16, out, { type: "square", gain: 0.12, release: 0.16, filter: 2800 });
      tone(987.77, t + 0.16, 0.34, out, { type: "square", gain: 0.14, release: 0.34, filter: 3200 });
      tone(1975.5, t + 0.2, 0.4, out, { gain: 0.06, release: 0.4 });
      burst(t + 0.16, 0.12, out, { type: "highpass", freq: 6000, gain: 0.08 });
      break;
    case "claim":
      tone(523.25, t, 0.1, out, { type: "triangle", gain: 0.14 });
      tone(783.99, t + 0.09, 0.18, out, { type: "triangle", gain: 0.14 });
      break;
    case "peek":
      burst(t, 0.22, out, { freq: 900, to: 2600, q: 2, gain: 0.12, attack: 0.08 });
      break;
    case "join":
      tone(660, t, 0.14, out, { type: "triangle", gain: 0.14 });
      tone(990, t + 0.12, 0.2, out, { type: "triangle", gain: 0.14 });
      break;
  }
}

// ---------------------------------------------------------------------
// 배경음악 — 분위기별 설정으로 코드 진행·아르페지오·멜로디·드럼을 실시간으로 연주
// ---------------------------------------------------------------------
interface TrackDef {
  name: string;
  bpm: number;
  root: number; // MIDI 번호
  scale: number[];
  chords: number[][]; // 음계 단계 (0부터)
  pad: OscillatorType;
  padCut: number;
  arp: OscillatorType | null;
  arpRate: 2 | 4; // 박당 음 개수
  bass: "none" | "root" | "pulse";
  drums: "none" | "soft" | "party" | "tick";
  melody: number; // 0~1, 8분음표마다 멜로디가 나올 확률
  lead: OscillatorType;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

export const TRACKS: Record<BgmTrack, TrackDef> = {
  calm: { name: "편안한", bpm: 72, root: 60, scale: MAJOR, chords: [[0, 2, 4, 6], [5, 0, 2, 4], [3, 5, 0, 2], [4, 6, 1, 3]], pad: "sine", padCut: 1400, arp: "triangle", arpRate: 2, bass: "root", drums: "none", melody: 0.25, lead: "sine" },
  party: { name: "신나는 파티", bpm: 118, root: 65, scale: MAJOR, chords: [[0, 2, 4], [4, 6, 1], [5, 0, 2], [3, 5, 0]], pad: "triangle", padCut: 2000, arp: "square", arpRate: 4, bass: "pulse", drums: "party", melody: 0.35, lead: "square" },
  mystery: { name: "미스터리", bpm: 78, root: 57, scale: MINOR, chords: [[0, 2, 4], [3, 5, 0], [0, 2, 4], [4, 6, 1]], pad: "sawtooth", padCut: 700, arp: null, arpRate: 2, bass: "root", drums: "tick", melody: 0.18, lead: "sine" },
  fantasy: { name: "판타지", bpm: 92, root: 62, scale: LYDIAN, chords: [[0, 2, 4], [1, 3, 5], [5, 0, 2], [4, 6, 1]], pad: "triangle", padCut: 2400, arp: "triangle", arpRate: 4, bass: "root", drums: "soft", melody: 0.3, lead: "triangle" },
  tension: { name: "긴장감", bpm: 104, root: 52, scale: MINOR, chords: [[0, 2, 4], [0, 2, 4], [1, 3, 5], [0, 2, 4]], pad: "sawtooth", padCut: 600, arp: "sawtooth", arpRate: 4, bass: "pulse", drums: "tick", melody: 0.12, lead: "square" },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface BgmState {
  track: BgmTrack;
  def: TrackDef;
  timer: number;
  next: number;
  step: number;
  bus: GainNode;
}

let bgm: BgmState | null = null;
let wantedTrack: BgmTrack | null = null;

function noteOf(def: TrackDef, degree: number, octave = 0) {
  const s = def.scale;
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return def.root + s[idx] + 12 * (oct + octave);
}

function scheduleStep(b: BgmState, when: number) {
  const { def } = b;
  const stepsPerBar = 8; // 8분음표 단위
  const stepDur = 60 / def.bpm / 2;
  const barIdx = Math.floor(b.step / stepsPerBar);
  const inBar = b.step % stepsPerBar;
  const chord = def.chords[barIdx % def.chords.length];
  const out = b.bus;
  // 패드: 마디 시작에 화음
  if (inBar === 0) {
    for (const d of chord.slice(0, 3)) tone(midi(noteOf(def, d)), when, stepDur * 8, out, { type: def.pad, gain: 0.05, attack: 0.4, release: stepDur * 8, filter: def.padCut });
  }
  // 베이스
  if (def.bass === "root" && (inBar === 0 || inBar === 4)) tone(midi(noteOf(def, chord[0], -2)), when, stepDur * 3, out, { type: "sine", gain: 0.14, release: stepDur * 3 });
  if (def.bass === "pulse") tone(midi(noteOf(def, chord[0], -2)), when, stepDur * 0.9, out, { type: "triangle", gain: 0.11, release: stepDur * 0.8, filter: 900 });
  // 아르페지오
  if (def.arp) {
    const sub = def.arpRate === 4 ? 2 : 1;
    for (let k = 0; k < sub; k++) {
      const i = inBar * sub + k;
      const d = chord[i % chord.length] + (i % (chord.length * 2) >= chord.length ? 7 : 0);
      tone(midi(noteOf(def, d, 1)), when + (k * stepDur) / sub, stepDur / sub, out, { type: def.arp, gain: 0.035, release: (stepDur / sub) * 0.9, filter: 2600 });
    }
  }
  // 멜로디 (확률적으로)
  if (Math.random() < def.melody) {
    const d = chord[Math.floor(Math.random() * chord.length)] + (Math.random() < 0.3 ? 1 : 0);
    tone(midi(noteOf(def, d, 2)), when, stepDur * 1.6, out, { type: def.lead, gain: 0.045, attack: 0.02, release: stepDur * 1.5, filter: 3200 });
  }
  // 드럼
  if (def.drums === "party") {
    if (inBar % 2 === 0) tone(120, when, 0.18, out, { to: 45, gain: 0.35, release: 0.18 });
    if (inBar % 2 === 1) burst(when, 0.04, out, { type: "highpass", freq: 7000, gain: 0.08 });
    if (inBar === 2 || inBar === 6) burst(when, 0.12, out, { freq: 1800, q: 0.8, gain: 0.12 });
  } else if (def.drums === "soft") {
    if (inBar === 0) tone(100, when, 0.2, out, { to: 45, gain: 0.2, release: 0.2 });
    if (inBar % 2 === 1) burst(when, 0.03, out, { type: "highpass", freq: 8000, gain: 0.04 });
  } else if (def.drums === "tick") {
    if (inBar % 2 === 0) burst(when, 0.025, out, { type: "highpass", freq: 6000, gain: 0.05 });
  }
  b.step++;
}

function startBgm(track: BgmTrack) {
  const c = ensure();
  if (!c) return;
  stopBgm();
  const bus = c.createGain();
  bus.gain.value = 0.0001;
  bus.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.5);
  bus.connect(bgmBus);
  const b: BgmState = { track, def: TRACKS[track], timer: 0, next: c.currentTime + 0.1, step: 0, bus };
  b.timer = window.setInterval(() => {
    if (!ctx || ctx.state !== "running" || document.hidden) return;
    const stepDur = 60 / b.def.bpm / 2;
    if (b.next < ctx.currentTime) b.next = ctx.currentTime + 0.05; // 화면이 꺼졌다 돌아오면 이어서
    while (b.next < ctx.currentTime + 0.25) {
      scheduleStep(b, b.next);
      b.next += stepDur;
    }
  }, 60);
  bgm = b;
}

function stopBgm() {
  if (!bgm || !ctx) return;
  const b = bgm;
  bgm = null;
  clearInterval(b.timer);
  b.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
  setTimeout(() => b.bus.disconnect(), 1500);
}

/** 방의 배경음악 상태 반영 (서버가 정한 곡, 소리 켜기 전이면 켜질 때 시작) */
export function setBgm(track: BgmTrack | null) {
  wantedTrack = track;
  if (!track || !getPrefs().bgmOn) {
    stopBgm();
    return;
  }
  if (bgm?.track === track) return;
  if (soundReady()) startBgm(track);
}

/** 개인 설정에서 배경음악 켜고 끄기 */
export function refreshBgm() {
  const t = wantedTrack;
  if (!t || !getPrefs().bgmOn) stopBgm();
  else if (soundReady() && bgm?.track !== t) startBgm(t);
}

// 설정이 바뀌면 볼륨·배경음악 켜짐 상태 반영
onPrefsSound(() => {
  applyVolumes();
  refreshBgm();
});
