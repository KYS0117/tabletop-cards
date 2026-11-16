// =====================================================================
// 클라이언트 상태 저장소 (서버가 보내 준 상태의 사본)
// - React 컴포넌트는 useStore()로 구독합니다.
// - 다른 사람이 카드를 끌고 있을 때의 잦은 위치 변화(obj:moving)는 React를 다시 그리지 않고
//   anim.ts 가 직접 화면 위치만 바꿉니다. (부드럽고 가벼움)
// =====================================================================
import { useSyncExternalStore } from "react";
import type { HandCard, PubObj, PubRoom } from "../../shared/protocol";

export interface Session {
  code: string;
  playerId: string;
  token: string;
  nickname: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: string;
}

export interface ClientState {
  status: "connecting" | "online" | "reconnecting";
  session: Session | null;
  room: PubRoom | null;
  objects: Map<string, PubObj>;
  hand: HandCard[];
  toasts: Toast[];
  kicked: string | null;
  joining: boolean;
  /** 큰 알림 (승리 등) */
  banner: { text: string; kind: string } | null;
  /** 👁 몰래 본 카드 (나에게만 보임) */
  peek: { id: string; face: string; back: string; shape?: "P" | "L" } | null;
}

let state: ClientState = {
  status: "connecting",
  session: null,
  room: null,
  objects: new Map(),
  hand: [],
  toasts: [],
  kicked: null,
  joining: false,
  banner: null,
  peek: null,
};

/** 서버 시계 - 내 시계 (타이머를 모두 같은 시간으로 보여 주기 위함) */
let serverOffset = 0;
export function setServerNow(serverNow: number) {
  if (typeof serverNow === "number") serverOffset = serverNow - Date.now();
}
export function serverNow(): number {
  return Date.now() + serverOffset;
}

let bannerTimer = 0;
export function showBanner(text: string, kind: string, ms = 4500) {
  clearTimeout(bannerTimer);
  setState({ banner: { text, kind } });
  bannerTimer = window.setTimeout(() => setState({ banner: null }), ms);
}

const listeners = new Set<() => void>();

export function getState(): ClientState {
  return state;
}

export function setState(patch: Partial<ClientState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useStore(): ClientState {
  return useSyncExternalStore(subscribe, getState, getState);
}

let toastSeq = 1;
export function toast(text: string, kind = "info") {
  const t = { id: toastSeq++, text, kind };
  setState({ toasts: [...state.toasts.slice(-3), t] });
  setTimeout(() => setState({ toasts: state.toasts.filter((x) => x.id !== t.id) }), 3500);
}

export function myId(): string {
  return state.session?.playerId ?? "";
}

export function playerById(id: string | null | undefined) {
  if (!id) return undefined;
  return state.room?.players.find((p) => p.id === id);
}

export function isHostMe(): boolean {
  return !!state.room && state.room.hostId === myId();
}

export function canEditMe(): boolean {
  return isHostMe() || !!state.room?.settings.allowEveryoneDelete;
}
