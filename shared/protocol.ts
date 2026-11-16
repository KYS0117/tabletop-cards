// =====================================================================
// 클라이언트와 서버가 함께 쓰는 타입과 상수
// - 좌표는 모두 "테이블 좌표(월드 좌표)"입니다. 화면 크기, 확대/축소와 무관하게
//   모든 기기에서 같은 값이므로 PC와 모바일의 카드 위치가 항상 일치합니다.
// - 카드의 x, y는 카드 "중심" 좌표입니다.
// =====================================================================

export const TABLE_W = 3200;
export const TABLE_H = 2000;
export const CARD_W = 100; // 세로형 카드 폭 (테이블 좌표)
export const CARD_H = 140; // 세로형 카드 높이
export const CARD_L_W = 140; // 가로형 카드 폭
export const CARD_L_H = 100; // 가로형 카드 높이
/** 한 방 최대 인원 */
export const MAX_PLAYERS = 10;
export const MAX_IDS_PER_REQUEST = 120;

/**
 * 카드 앞면 식별자.
 *  "S-A"(스페이드 A), "H-10", "JK-R"(컬러 조커)  — 트럼프
 *  "U:R-5", "U:B-S"(스킵), "U:W-D4"               — 우노 방식 컬러 카드
 *  "IMG:propose/023.webp"                         — 이미지 카드 (decks/ 폴더의 그림)
 *  "T:텍스트"                                       — 글자 카드 (직접 만든 커스텀 카드)
 */
export type Face = string;
/** 카드 뒷면: "red" | "blue" | "green" | "purple" | "uno" | "propose" | "IMG:<덱>/<파일>" */
export type BackStyle = string;
/** 카드 모양: P = 세로형(기본), L = 가로형 */
export type Shape = "P" | "L";
export type Background = "felt" | "navy" | "black" | "wood";
export type DeckType = "standard54" | "uno108" | "propose" | "cockroach";
/** 게임 선택: 자유 테이블(트럼프) / 프로포즈 게임 / 우노 방식 / 바퀴벌레 포커 */
export type PresetId = "free" | "propose" | "uno" | "cockroach";

/** 바퀴벌레 포커의 벌레 8종 (선언할 때 사용) */
export const CREATURES = [
  { id: "cockroach", name: "바퀴벌레", icon: "🪳" },
  { id: "rat", name: "쥐", icon: "🐀" },
  { id: "bat", name: "박쥐", icon: "🦇" },
  { id: "fly", name: "파리", icon: "🪰" },
  { id: "toad", name: "두꺼비", icon: "🐸" },
  { id: "scorpion", name: "전갈", icon: "🦂" },
  { id: "spider", name: "거미", icon: "🕷️" },
  { id: "stinkbug", name: "노린재", icon: "🐞" },
] as const;
export type CreatureId = (typeof CREATURES)[number]["id"];

/** 바퀴벌레 포커 선언: "by 가 to 에게 이 카드는 creature 라고 말함" + 받은 사람의 대답 */
export interface ClaimState {
  by: string;
  to: string;
  creature: CreatureId;
  /** yes = "진짜라고 생각해", no = "거짓말이야" */
  answer: "yes" | "no" | null;
  at: number;
}

/** 타이머 최대 시간 (초) */
export const TIMER_MAX_SEC = 300;
/** 배경음악 분위기 (웹사이트가 직접 연주하는 음악이라 저작권 걱정 없음) */
export type BgmTrack = "calm" | "party" | "mystery" | "fantasy" | "tension";

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
  /** 가로형이면 "L" (없으면 세로형) */
  shape?: Shape;
  /** 지금 이 카드를 잡고 있는 플레이어 id */
  lockedBy: string | null;
  /** 🔒 잠금: 옮기기·뒤집기·회전·삭제 불가 */
  pinned?: boolean;
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
  shape?: Shape;
  /** 비어도 사라지지 않는 자리 (버림 더미 등) */
  keep?: boolean;
  /** 더미 이름 (예: "버린 카드") */
  label?: string;
  lockedBy: string | null;
  /** 🔒 잠금: 더미 자체는 옮기기·뒤집기·회전·삭제 불가 (카드 뽑기·섞기·쌓기는 가능) */
  pinned?: boolean;
}

export type PubObj = PubCard | PubStack;

/** 내 손패 카드 (소유자에게만 전송) */
export interface HandCard {
  id: string;
  face: Face;
  back: BackStyle;
  shape?: Shape;
}

export interface PubPlayer {
  id: string;
  nickname: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  handCount: number;
  joinedAt: number;
  /** 점수 (프로포즈 게임에서는 받은 반지 수) */
  score: number;
  /** 우노를 외친 상태 (손패가 3장 이상이 되면 풀림) */
  uno?: boolean;
}

export interface RoomSettings {
  background: Background;
  /** 0.8 / 1 / 1.25 — 방 전체에 같은 값이 적용되어 기기마다 겹침 상태가 달라지지 않음 */
  cardScale: number;
  /** true면 방장이 아니어도 카드 삭제/복제 가능 */
  allowEveryoneDelete: boolean;
}

/**
 * 방의 게임 모드. 클라이언트는 이 값으로 화면(모드 컴포넌트)을 고릅니다.
 * 지금은 "sandbox"(자유 테이블)만 있어요. 새 게임은 client/src/modes/registry.ts 와
 * server/src/modules.ts 에 등록해서 추가합니다.
 */
export type GameMode = "sandbox";

/** 점수판 설정 (예: 반지 💍 3개 모으면 승리). null 이면 점수판 없음 */
export interface ScoreConfig {
  label: string;
  icon: string;
  goal: number;
}

/** 서버 기준 공용 타이머. 남은 시간 = endsAt - (서버 현재 시각) */
export interface TimerState {
  durationMs: number;
  running: boolean;
  /** 실행 중일 때 끝나는 시각 (서버 시계, ms) */
  endsAt: number | null;
  /** 멈춰 있을 때 남은 시간 */
  remainingMs: number;
}

export interface PubRoom {
  code: string;
  name: string;
  mode: GameMode;
  /** 지금 선택된 게임 */
  preset: PresetId;
  hostId: string;
  settings: RoomSettings;
  players: PubPlayer[];
  score: ScoreConfig | null;
  timer: TimerState;
  bgm: { track: BgmTrack | null };
  /** 바퀴벌레 포커의 마지막 선언 */
  claim: ClaimState | null;
  /** 이 데이터를 보낸 순간의 서버 시각 (타이머 시계 맞추기용) */
  serverNow: number;
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
  notice: { text: string; kind?: "join" | "leave" | "info" | "shuffle" | "warn" | "ring" | "win" | "deal" | "uno" | "claim" | "peek"; stackId?: string };
  /** 몰래 보기 결과 — 요청한 사람에게만 전송 */
  peek: { id: string; face: Face; back: BackStyle; shape?: Shape };
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
  /** 🔒 잠그기/풀기 (풀기는 잠근 사람 또는 방장) */
  "obj:pin": { ids: string[]; pinned: boolean };
  /** 뒷면 카드 몰래 보기 (나에게만 보이고, 모두에게 "봤다"는 알림) */
  "obj:peek": { id: string };
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
  /** 게임 선택 (방장) — 테이블을 그 게임에 맞게 새로 준비 */
  "game:preset": { preset: PresetId };
  /** 커스텀 글자 카드 만들기: 한 줄에 한 장. 덱에 섞거나 내 손패로 */
  "custom:create": { lines: string[]; target: "deck" | "hand"; stackId?: string };
  /** 점수(반지) 주기/빼기 — 누구나 가능 (자유 진행) */
  "score:add": { playerId: string; delta: number };
  "timer:set": { seconds: number };
  "timer:start": Record<string, never>;
  "timer:pause": Record<string, never>;
  "timer:reset": Record<string, never>;
  /** 배경음악 (방장) */
  "bgm:set": { track: BgmTrack | null };
  /** 우노! 외치기 (우노 게임, 손패 2장 이하) */
  "uno:call": Record<string, never>;
  /** 바퀴벌레 포커: 선언하기 / 대답하기 */
  "claim:say": { to: string; creature: CreatureId };
  "claim:answer": { answer: "yes" | "no" };
  cursor: { x: number; y: number }; // ack 없음
  // 개발자 측정
  "perf:ping": { t: number };
  "debug:stats": Record<string, never>;
}

export interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function cardSize(scale: number, shape?: Shape) {
  return shape === "L" ? { w: CARD_L_W * scale, h: CARD_L_H * scale } : { w: CARD_W * scale, h: CARD_H * scale };
}

export const CUSTOM_TEXT_MAX = 30;
export const CUSTOM_LINES_MAX = 20;
