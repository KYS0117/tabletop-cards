// =====================================================================
// 클라이언트와 서버가 함께 쓰는 타입과 상수
// - 좌표는 모두 "테이블 좌표(월드 좌표)"입니다. 화면 크기, 확대/축소와 무관하게
//   모든 기기에서 같은 값이므로 PC와 모바일의 카드 위치가 항상 일치합니다.
// - 카드의 x, y는 카드 "중심" 좌표입니다.
// =====================================================================

export const TABLE_W = 3200;
export const TABLE_H = 2000;
export const CARD_W = 100; // 카드 기본 폭 (테이블 좌표)
export const CARD_H = 140; // 카드 기본 높이
export const MAX_PLAYERS = 6;
export const MAX_IDS_PER_REQUEST = 120;

/** 카드 앞면 식별자. 예) "S-A"(스페이드 A), "H-10", "JK-R"(컬러 조커), "T:텍스트"(글자 카드) */
export type Face = string;
export type BackStyle = "red" | "blue" | "green" | "purple" | "amumal";
export type Background = "felt" | "navy" | "black" | "wood";
export type DeckType = "standard54" | "amumal";

/** 테이블 위 낱장 카드 (모든 플레이어에게 같은 내용이 전송됨) */
export interface PubCard {
  kind: "card";
  id: string;
  x: number;
  y: number;
  rot: number;
  z: number;
  faceUp: boolean;
  /** 앞면일 때만 값이 있음. 뒷면 카드의 정체는 네트워크로 보내지 않음 */
  face: Face | null;
  back: BackStyle;
  /** 지금 이 카드를 잡고 있는 플레이어 id */
  lockedBy: string | null;
}

/** 테이블 위 카드 더미(덱). 안쪽 카드의 순서와 정체는 서버만 알고 있음 */
export interface PubStack {
  kind: "stack";
  id: string;
  x: number;
  y: number;
  rot: number;
  z: number;
  faceUp: boolean;
  count: number;
  /** 더미가 앞면으로 놓였을 때 맨 위 카드만 공개 */
  top: Face | null;
  back: BackStyle;
  lockedBy: string | null;
}

export type PubObj = PubCard | PubStack;

/** 내 손패 카드 (소유자에게만 전송) */
export interface HandCard {
  id: string;
  face: Face;
  back: BackStyle;
}

export interface PubPlayer {
  id: string;
  nickname: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  handCount: number;
  joinedAt: number;
}

export interface RoomSettings {
  background: Background;
  /** 0.8 / 1 / 1.25 — 방 전체에 같은 값이 적용되어 기기마다 겹침 상태가 달라지지 않음 */
  cardScale: number;
  /** true면 방장이 아니어도 카드 삭제/복제 가능 */
  allowEveryoneDelete: boolean;
}

export interface PubRoom {
  code: string;
  name: string;
  hostId: string;
  settings: RoomSettings;
  players: PubPlayer[];
}

export interface Move {
  id: string;
  x: number;
  y: number;
}

export type AckResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

/** 서버 → 클라이언트 이벤트 이름과 내용 */
export interface ServerEvents {
  "state:full": { room: PubRoom; objects: PubObj[]; hand: HandCard[]; you: string };
  "room:update": { room: PubRoom };
  "obj:upsert": { objects: PubObj[] };
  "obj:remove": { ids: string[] };
  "obj:moving": { by: string; moves: Move[] };
  "hand:update": { hand: HandCard[] };
  cursor: { by: string; x: number; y: number };
  notice: { text: string; kind?: "join" | "leave" | "info" | "shuffle" | "warn"; stackId?: string };
  kicked: { reason: string };
}

/** 클라이언트 → 서버 요청 이름과 내용 (모두 ack 콜백으로 결과를 돌려받음, 표시된 것 제외) */
export interface ClientRequests {
  "room:create": { nickname: string; roomName?: string; tabId: string };
  "room:join": { code: string; nickname: string; token?: string; tabId: string };
  "room:leave": Record<string, never>;
  "obj:grab": { ids: string[] };
  "obj:drag": { moves: Move[] }; // ack 없음, 전송 빈도 제한
  "obj:release": { moves: Move[]; mergeInto?: string | null };
  "obj:flip": { ids: string[] };
  "obj:rotate": { ids: string[]; delta: number };
  "obj:toTop": { ids: string[] };
  "obj:arrange": { ids: string[] };
  "obj:duplicate": { ids: string[] };
  "obj:delete": { ids: string[] };
  "stack:take": { stackId: string };
  "stack:draw": { stackId: string; count: number };
  "stack:deal": { stackId: string; count: number };
  "stack:shuffle": { stackId: string };
  "stack:spread": { stackId: string };
  "stack:create": { ids: string[] };
  "hand:take": { ids: string[] };
  "hand:play": { cardId: string; x: number; y: number; faceUp: boolean; grab: boolean };
  "hand:reorder": { order: string[] };
  "host:reset": Record<string, never>;
  "host:gather": Record<string, never>;
  "host:newDeck": { deck: DeckType };
  "host:settings": Partial<RoomSettings> & { name?: string };
  "host:kick": { playerId: string };
  cursor: { x: number; y: number }; // ack 없음
}

export interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function cardSize(scale: number) {
  return { w: CARD_W * scale, h: CARD_H * scale };
}
