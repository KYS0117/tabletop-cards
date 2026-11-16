// =====================================================================
// 서버 연결 (Socket.IO)
// - 연결이 끊기면 Socket.IO 가 자동으로 다시 연결하고, 다시 연결되면 저장해 둔 토큰으로
//   같은 방, 같은 플레이어(손패 포함)로 복원합니다.
// - 모바일에서 앱 전환 후 돌아오면 즉시 재연결을 시도합니다.
// =====================================================================
import { io, type Socket } from "socket.io-client";
import type { ClientRequests, HandCard, JoinResult, PubCard, PubObj, PubRoom, ServerEvents } from "../../shared/protocol";
import * as anim from "./anim";
import { recordNet } from "./perf";
import * as sound from "./sound";
import { getState, setServerNow, setState, showBanner, toast, type Session } from "./store";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || undefined; // 비어 있으면 현재 접속한 주소 사용

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
  timeout: 10_000,
});

// 탭마다 고유한 id (같은 브라우저에서 탭을 여러 개 열면 각각 다른 플레이어)
function getTabId(): string {
  try {
    let t = sessionStorage.getItem("tt-tab");
    if (!t) {
      t = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem("tt-tab", t);
    }
    return t;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}
export const tabId = getTabId();

function saveSession(s: Session | null) {
  try {
    if (s) {
      localStorage.setItem(`tt-session-${s.code}`, JSON.stringify({ token: s.token, nickname: s.nickname }));
      sessionStorage.setItem("tt-current", s.code);
    } else {
      sessionStorage.removeItem("tt-current");
    }
  } catch {
    /* 저장소를 쓸 수 없는 브라우저 */
  }
}

function savedToken(code: string): { token: string; nickname: string } | null {
  try {
    const raw = localStorage.getItem(`tt-session-${code}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function forgetSession(code: string) {
  try {
    localStorage.removeItem(`tt-session-${code}`);
    sessionStorage.removeItem("tt-current");
  } catch {
    /* 무시 */
  }
}

type Res<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

/** 서버에 요청하고 결과(ack)를 기다림. 응답이 없으면 실패로 처리 */
export function request<K extends keyof ClientRequests, T = Record<string, unknown>>(
  ev: K,
  data: ClientRequests[K],
  timeoutMs = 8000,
): Promise<Res<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: "서버에 연결되어 있지 않아요" });
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve({ ok: false, error: "서버 응답이 없어요" });
      }
    }, timeoutMs);
    recordNet("out", ev, data);
    socket.emit(ev, data, (r: Res<T>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r ?? { ok: false, error: "응답 오류" });
    });
  });
}

/** 결과가 필요 없는 요청. 실패하면 알림만 표시 */
export function act<K extends keyof ClientRequests>(ev: K, data: ClientRequests[K]) {
  request(ev, data).then((r) => {
    if (!r.ok) toast(r.error, "warn");
  });
}

/** 빈번한 이벤트(드래그, 커서). 연결이 끊긴 동안에는 버림 */
export function sendVolatile<K extends "obj:drag" | "cursor">(ev: K, data: ClientRequests[K]) {
  if (!socket.connected) return;
  recordNet("out", ev, data);
  socket.volatile.emit(ev, data);
}

export async function createRoom(nickname: string, roomName: string): Promise<string | null> {
  setState({ joining: true });
  const r = await request<"room:create", JoinResult>("room:create", { nickname, roomName, tabId });
  setState({ joining: false });
  if (!r.ok) return r.error;
  const s: Session = { code: r.code, playerId: r.playerId, token: r.token, nickname };
  saveSession(s);
  setState({ session: s });
  return null;
}

export async function joinRoom(code: string, nickname: string): Promise<string | null> {
  code = code.trim().toUpperCase();
  const saved = savedToken(code);
  setState({ joining: true });
  const r = await request<"room:join", JoinResult>("room:join", { code, nickname, token: saved?.token, tabId });
  setState({ joining: false });
  if (!r.ok) return r.error;
  const s: Session = { code: r.code, playerId: r.playerId, token: r.token, nickname };
  saveSession(s);
  setState({ session: s });
  return null;
}

export async function leaveRoom() {
  const s = getState().session;
  if (s) {
    await request("room:leave", {});
    forgetSession(s.code);
  }
  anim.clearAll();
  setState({ session: null, room: null, objects: new Map(), hand: [] });
  history.replaceState(null, "", location.pathname);
}

/** 새로고침 직후 이 탭이 들어가 있던 방 */
export function currentRoomCode(): string | null {
  try {
    return sessionStorage.getItem("tt-current");
  } catch {
    return null;
  }
}

async function rejoin() {
  const s = getState().session;
  const code = s?.code ?? currentRoomCode();
  if (!code) return;
  const saved = savedToken(code);
  if (!saved) return;
  setState({ joining: true });
  const r = await request<"room:join", JoinResult>("room:join", { code, nickname: saved.nickname, token: saved.token, tabId });
  setState({ joining: false });
  if (!r.ok) {
    toast(r.error, "warn");
    forgetSession(code);
    setState({ session: null, room: null, objects: new Map(), hand: [] });
    return;
  }
  const ns: Session = { code: r.code, playerId: r.playerId, token: r.token, nickname: saved.nickname };
  saveSession(ns);
  setState({ session: ns });
}

// ---------------- 연결 상태 ----------------
socket.on("connect", () => {
  setState({ status: "online" });
  rejoin();
});
socket.on("disconnect", () => setState({ status: "reconnecting" }));
socket.on("connect_error", () => setState({ status: getState().session ? "reconnecting" : "connecting" }));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !socket.connected) socket.connect();
});
window.addEventListener("online", () => {
  if (!socket.connected) socket.connect();
});

// ---------------- 서버 → 클라이언트 ----------------
function on<K extends keyof ServerEvents>(ev: K, fn: (d: ServerEvents[K]) => void) {
  socket.on(ev as string, (d: unknown) => {
    recordNet("in", ev, d);
    (fn as (d: unknown) => void)(d);
  });
}

on("state:full", (d) => {
  anim.clearAll();
  const objects = new Map<string, PubObj>();
  for (const o of d.objects) {
    objects.set(o.id, o);
    anim.setTarget(o.id, o.x, o.y, o.rot, true);
  }
  setServerNow(d.room.serverNow);
  setState({ room: d.room, objects, hand: d.hand, kicked: null });
  sound.setBgm(d.room.bgm?.track ?? null);
});

on("room:update", (d) => {
  setServerNow(d.room.serverNow);
  if (d.room.bgm?.track !== getState().room?.bgm?.track) sound.setBgm(d.room.bgm?.track ?? null);
  setState({ room: d.room });
});

on("obj:upsert", (d) => {
  const objects = new Map(getState().objects);
  const me = getState().session?.playerId;
  for (const o of d.objects) {
    const prev = objects.get(o.id);
    // 효과음: 뒤집기는 누구 것이든, 다른 사람이 집고 놓는 소리는 작게
    if (prev && prev.faceUp !== o.faceUp) sound.sfx("flip");
    else if (prev && prev.lockedBy !== o.lockedBy) {
      if (o.lockedBy && o.lockedBy !== me) sound.sfx("pick", 0.35);
      else if (!o.lockedBy && prev.lockedBy && prev.lockedBy !== me) sound.sfx("place", 0.4);
    } else if (prev && prev.kind === "stack" && o.kind === "stack" && o.count > prev.count) sound.sfx("place", 0.6);
    const isNew = !objects.has(o.id);
    objects.set(o.id, o);
    anim.setTarget(o.id, o.x, o.y, o.rot, isNew);
  }
  setState({ objects });
});

/** 흔들어 모으기: 빨려 들어가는 카드는 잠깐(연출 시간) 더 보여 준 뒤 지움 */
const gatheringUntil = new Map<string, number>();
const GATHER_FX_MS = 260;

on("fx:gather", (d) => {
  const objects = getState().objects;
  const now = performance.now();
  for (const id of d.ids) {
    const o = objects.get(id);
    anim.setTarget(id, d.x, d.y, o?.rot ?? 0);
    gatheringUntil.set(id, now + GATHER_FX_MS);
  }
  sound.sfx("shuffle", d.by === getState().session?.playerId ? 1 : 0.6);
});

function removeNow(ids: string[]) {
  const objects = new Map(getState().objects);
  for (const id of ids) {
    objects.delete(id);
    anim.forget(id);
  }
  setState({ objects });
}

on("obj:remove", (d) => {
  const now = performance.now();
  const later = d.ids.filter((id) => (gatheringUntil.get(id) ?? 0) > now);
  const nowIds = d.ids.filter((id) => !later.includes(id));
  if (nowIds.length) removeNow(nowIds);
  if (later.length) {
    window.setTimeout(() => {
      for (const id of later) gatheringUntil.delete(id);
      removeNow(later);
    }, GATHER_FX_MS);
  }
});

on("obj:moving", (d) => {
  const objects = getState().objects;
  for (const m of d.moves) {
    const o = objects.get(m.id);
    if (!o) continue;
    o.x = m.x; // React 를 다시 그리지 않고 위치만 갱신
    o.y = m.y;
    anim.setTarget(m.id, m.x, m.y, o.rot);
  }
});

on("peek", (d) => setState({ peek: d }));

// 우노 특수 카드 연출: 잠깐 보여 주고 사라짐 (규칙 처리는 서버가 이미 끝냄)
let unoFxKey = 0;
on("fx:uno", (d) => {
  const key = ++unoFxKey;
  setState({ unoFx: { ...d, key } });
  const me = getState().session?.playerId;
  if (d.effect === "draw") {
    sound.sfx("attack");
    if (d.target === me) navigator.vibrate?.([60, 40, 120]);
  } else if (d.effect === "skip") {
    sound.sfx("skip");
    if (d.target === me) navigator.vibrate?.(80);
  } else sound.sfx(d.effect);
  window.setTimeout(() => {
    if (getState().unoFx?.key === key) setState({ unoFx: null });
  }, 1700);
});

on("hand:update", (d) => {
  if (d.hand.length > getState().hand.length) sound.sfx("draw");
  setState({ hand: d.hand as HandCard[] });
});

on("notice", (d) => {
  // 승리·패배는 큰 배너로만, 바퀴벌레 포커 선언은 화면 위 진행 표시줄에 이미 보이므로 알림 생략
  const roachClaim = d.kind === "claim" && d.text.startsWith("📣") && getState().room?.game?.kind === "roach";
  if (d.kind !== "win" && d.kind !== "lose" && !roachClaim) toast(d.text, d.kind ?? "info");
  if (d.kind === "shuffle") sound.sfx("shuffle");
  else if (d.kind === "deal") sound.sfx("deal");
  else if (d.kind === "ring") sound.sfx("ring");
  else if (d.kind === "join") sound.sfx("join");
  else if (d.kind === "uno") {
    sound.sfx("uno");
    showBanner(d.text, "uno", 2200);
  } else if (d.kind === "claim") sound.sfx("claim");
  else if (d.kind === "peek") sound.sfx("peek", 0.6);
  else if (d.kind === "win") {
    sound.sfx("win");
    showBanner(d.text, "win");
  } else if (d.kind === "lose") {
    sound.sfx("alarm");
    showBanner(d.text, "lose", 4000);
  }
  if (d.kind === "shuffle" && d.stackId) {
    const el = document.querySelector(`[data-oid="${CSS.escape(d.stackId)}"]`);
    el?.classList.remove("shuffling");
    void (el as HTMLElement | null)?.offsetWidth;
    el?.classList.add("shuffling");
  }
});

on("kicked", (d) => {
  const s = getState().session;
  if (s) forgetSession(s.code);
  anim.clearAll();
  setState({ session: null, room: null, objects: new Map(), hand: [], kicked: d.reason });
});

export type CursorListener = (by: string, x: number, y: number) => void;
const cursorListeners = new Set<CursorListener>();
export function onCursor(fn: CursorListener) {
  cursorListeners.add(fn);
  return () => {
    cursorListeners.delete(fn);
  };
}
on("cursor", (d) => cursorListeners.forEach((f) => f(d.by, d.x, d.y)));

/** 서버 응답으로 받은 카드를 바로 상태에 반영 (obj:upsert 보다 응답이 먼저 와도 안전하도록) */
export function ensureObject(c: PubCard) {
  const objects = getState().objects;
  if (!objects.has(c.id)) {
    const next = new Map(objects);
    next.set(c.id, c);
    anim.setTarget(c.id, c.x, c.y, c.rot, true);
    setState({ objects: next });
  }
}

export type { PubRoom };
