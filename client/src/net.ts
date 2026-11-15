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
import { getState, setState, toast, type Session } from "./store";

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
  setState({ room: d.room, objects, hand: d.hand, kicked: null });
});

on("room:update", (d) => setState({ room: d.room }));

on("obj:upsert", (d) => {
  const objects = new Map(getState().objects);
  for (const o of d.objects) {
    const isNew = !objects.has(o.id);
    objects.set(o.id, o);
    anim.setTarget(o.id, o.x, o.y, o.rot, isNew);
  }
  setState({ objects });
});

on("obj:remove", (d) => {
  const objects = new Map(getState().objects);
  for (const id of d.ids) {
    objects.delete(id);
    anim.forget(id);
  }
  setState({ objects });
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

on("hand:update", (d) => setState({ hand: d.hand as HandCard[] }));

on("notice", (d) => {
  toast(d.text, d.kind ?? "info");
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
