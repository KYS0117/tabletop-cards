// =====================================================================
// 게임방 하나의 전체 상태와 모든 카드 조작 로직
// - 서버가 "최종 상태"를 결정합니다. 클라이언트 요청은 여기서 검증한 뒤에만 반영됩니다.
// - 숨겨진 정보(뒷면 카드의 정체, 더미 안의 순서, 남의 손패)는 pub*() 함수에서
//   아예 빼고 보내므로 개발자 도구로 네트워크를 봐도 알 수 없습니다.
// - 메모리에만 저장합니다. 서버를 재시작하면 모든 방이 사라집니다.
// =====================================================================
import type { Server, Socket } from "socket.io";
import {
  CREATURES,
  CUSTOM_LINES_MAX,
  CUSTOM_TEXT_MAX,
  MAX_IDS_PER_REQUEST,
  MAX_PLAYERS,
  TABLE_H,
  TABLE_W,
  TIMER_MAX_SEC,
  type BackStyle,
  type Background,
  type BgmTrack,
  type ClaimState,
  type CreatureId,
  type DeckType,
  type Face,
  type GameMode,
  type HandCard,
  type Move,
  type PubCard,
  type PubObj,
  type PubPlayer,
  type PubRoom,
  type PubStack,
  type RoomSettings,
  type ServerEvents,
  type PresetId,
  type ScoreConfig,
  type Shape,
  type TimerState,
  cardSize,
} from "../../shared/protocol";
import { builtinDeck } from "../../shared/cards";
import { loadImageDeck } from "./decks";
import { clamp, cleanText, isFiniteNum, newId, newToken, normRot, randomIndex, shuffleInPlace } from "./util";

interface ICard {
  kind: "card";
  id: string;
  face: Face;
  back: BackStyle;
  shape: Shape;
  faceUp: boolean;
  x: number;
  y: number;
  rot: number;
  z: number;
  lockedBy: string | null;
  lockAt: number;
  /** 🔒 잠금 (잠근 사람 id) */
  pinnedBy?: string;
}

export interface IStackCard {
  face: Face;
  back: BackStyle;
  shape?: Shape;
}

interface IStack {
  kind: "stack";
  id: string;
  /** cards[0] = 맨 아래, 마지막 = 맨 위 */
  cards: IStackCard[];
  faceUp: boolean;
  shape: Shape;
  /** 비어도 사라지지 않는 자리 (버림 더미 등) */
  keep?: boolean;
  label?: string;
  x: number;
  y: number;
  rot: number;
  z: number;
  lockedBy: string | null;
  lockAt: number;
  /** 🔒 잠금 (잠근 사람 id) */
  pinnedBy?: string;
}

export type IObj = ICard | IStack;

export interface IPlayer {
  id: string;
  token: string;
  tabId: string;
  nickname: string;
  color: string;
  joinedAt: number;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number | null;
  hand: HandCard[];
  score: number;
  /** 우노를 외친 상태 */
  uno?: boolean;
  unoAt?: number;
}

const COLORS = ["#ef476f", "#118ab2", "#ffd166", "#06d6a0", "#9b5de5", "#f78c6b", "#4cc9f0", "#c9ada7", "#ff9f1c", "#8ac926"];
const BGM_TRACKS: BgmTrack[] = ["calm", "party", "mystery", "fantasy", "tension"];
const LOCK_STALE_MS = 15_000;
const BACKGROUNDS: Background[] = ["felt", "navy", "black", "wood"];
const SCALES = [0.8, 1, 1.25];
const PINNED_MSG = "🔒 잠긴 카드예요 (메뉴에서 잠금 풀기)";

export class Room {
  readonly code: string;
  name: string;
  /** 현재 게임 모드 (지금은 자유 테이블만) */
  mode: GameMode = "sandbox";
  /** 지금 선택된 게임 */
  preset: PresetId = "free";
  /** 점수판 (프로포즈 게임: 반지 3개) */
  score: ScoreConfig | null = null;
  timer: TimerState = { durationMs: 60_000, running: false, endsAt: null, remainingMs: 60_000 };
  bgm: { track: BgmTrack | null } = { track: null };
  /** 바퀴벌레 포커의 마지막 선언 */
  claim: ClaimState | null = null;
  hostId = "";
  settings: RoomSettings = { background: "felt", cardScale: 1, allowEveryoneDelete: false };
  players = new Map<string, IPlayer>();
  objs = new Map<string, IObj>();
  private zTop = 1;
  emptySince: number | null = null;
  hostAwaySince: number | null = null;

  constructor(private io: Server, code: string, name: string) {
    this.code = code;
    this.name = name;
    this.addDeck("standard54", TABLE_W / 2, TABLE_H / 2, true);
  }

  /** 손패에 넣을 카드 만들기 (게임 준비용) */
  handCard(c: IStackCard): HandCard {
    return this.toHand(c);
  }

  /** 더미 맨 위 카드를 다른 더미로 옮기기 (예: 우노 첫 카드 공개) */
  transferTop(from: IStack, to: IStack): void {
    const c = from.cards.pop();
    if (!c) return;
    to.cards.push(c);
    const r = this.normalizeStack(from);
    this.removeIds(r.removed);
    this.upsert([...r.changed, to]);
  }

  /** 들어온 카드 정보에 손패 id 붙이기 */
  private toHand(c: IStackCard | ICard): HandCard {
    const h: HandCard = { id: newId(), face: c.face, back: c.back };
    const shape = c.shape;
    if (shape === "L") h.shape = "L";
    return h;
  }

  // ------------------------------------------------------------------
  // 공개용 변환 (숨김 정보 제거)
  // ------------------------------------------------------------------
  private pub(o: IObj): PubObj {
    if (o.kind === "card") {
      const c: PubCard = {
        kind: "card",
        id: o.id,
        x: o.x,
        y: o.y,
        rot: o.rot,
        z: o.z,
        faceUp: o.faceUp,
        face: o.faceUp ? o.face : null,
        back: o.back,
        lockedBy: o.lockedBy,
      };
      if (o.shape === "L") c.shape = "L";
      if (o.pinnedBy) c.pinned = true;
      return c;
    }
    const top = o.cards[o.cards.length - 1];
    const s: PubStack = {
      kind: "stack",
      id: o.id,
      x: o.x,
      y: o.y,
      rot: o.rot,
      z: o.z,
      faceUp: o.faceUp,
      count: o.cards.length,
      top: o.faceUp && top ? top.face : null,
      // 뒷면 무늬는 더미가 앞면일 땐 맨 아래 카드, 뒷면일 땐 맨 위 카드 기준
      back: (o.faceUp ? o.cards[0] : top)?.back ?? o.cards[0]?.back ?? "blue",
      lockedBy: o.lockedBy,
    };
    if (o.shape === "L") s.shape = "L";
    if (o.keep) s.keep = true;
    if (o.label) s.label = o.label;
    if (o.pinnedBy) s.pinned = true;
    return s;
  }

  pubPlayers(): PubPlayer[] {
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        color: p.color,
        isHost: p.id === this.hostId,
        connected: p.connected,
        handCount: p.hand.length,
        joinedAt: p.joinedAt,
        score: p.score,
        ...(p.uno ? { uno: true } : {}),
      }));
  }

  pubRoom(): PubRoom {
    this.settleTimer();
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      preset: this.preset,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: this.pubPlayers(),
      score: this.score ? { ...this.score } : null,
      timer: { ...this.timer },
      bgm: { ...this.bgm },
      claim: this.claim ? { ...this.claim } : null,
      serverNow: Date.now(),
    };
  }

  pubObjects(): PubObj[] {
    return [...this.objs.values()].map((o) => this.pub(o));
  }

  // ------------------------------------------------------------------
  // 전송 도우미 — 방 단위(io.to(code))로만 보내므로 다른 방에 새지 않음
  // ------------------------------------------------------------------
  private upsert(objs: IObj[]) {
    if (objs.length) this.io.to(this.code).emit("obj:upsert", { objects: objs.map((o) => this.pub(o)) });
  }
  private removeIds(ids: string[]) {
    if (ids.length) this.io.to(this.code).emit("obj:remove", { ids });
  }
  roomChanged() {
    this.io.to(this.code).emit("room:update", { room: this.pubRoom() });
  }
  notice(text: string, kind: NonNullable<ServerEvents["notice"]["kind"]> = "info", stackId?: string) {
    this.io.to(this.code).emit("notice", { text, kind, stackId });
  }
  /** 손패는 소유자 전용 채널(p:<플레이어id>)로만 전송 */
  sendHand(p: IPlayer) {
    if (p.uno && p.hand.length > 2) p.uno = false; // 카드를 다시 받으면 우노 상태 풀림 (방 정보는 호출한 쪽에서 갱신)
    this.io.to(`p:${p.id}`).emit("hand:update", { hand: p.hand });
  }

  // ------------------------------------------------------------------
  // 공통 검사
  // ------------------------------------------------------------------
  private isLockedByOther(o: IObj, pid: string): boolean {
    return !!o.lockedBy && o.lockedBy !== pid && Date.now() - o.lockAt < LOCK_STALE_MS;
  }
  private canTouch(o: IObj, pid: string): boolean {
    return !this.isLockedByOther(o, pid);
  }
  /** 잠기지 않았고 다른 사람이 잡고 있지 않음 → 옮기기·뒤집기·회전·삭제 가능 */
  private canMove(o: IObj, pid: string): boolean {
    return !o.pinnedBy && this.canTouch(o, pid);
  }
  private canEdit(pid: string): boolean {
    return pid === this.hostId || this.settings.allowEveryoneDelete;
  }
  isHost(pid: string): boolean {
    return pid === this.hostId;
  }
  private nextZ(): number {
    this.zTop += 1;
    return this.zTop;
  }
  private clampPos(x: number, y: number): { x: number; y: number } {
    const m = 40;
    return { x: clamp(x, -m, TABLE_W + m), y: clamp(y, -m, TABLE_H + m) };
  }
  size(shape?: Shape) {
    return cardSize(this.settings.cardScale, shape);
  }
  private getObjs(ids: string[]): IObj[] {
    const out: IObj[] = [];
    for (const id of ids.slice(0, MAX_IDS_PER_REQUEST)) {
      const o = this.objs.get(id);
      if (o) out.push(o);
    }
    return out;
  }
  private makeCard(face: Face, back: BackStyle, faceUp: boolean, x: number, y: number, rot = 0, shape: Shape = "P"): ICard {
    const p = this.clampPos(x, y);
    return { kind: "card", id: newId(), face, back, shape, faceUp, x: p.x, y: p.y, rot, z: this.nextZ(), lockedBy: null, lockAt: 0 };
  }
  /** 더미가 1장 이하가 되면 정리: 1장 → 낱장 카드, 0장 → 삭제 (keep 더미는 그대로 유지) */
  private normalizeStack(s: IStack): { removed: string[]; changed: IObj[] } {
    if (s.cards.length >= 2 || s.keep || s.pinnedBy) return { removed: [], changed: [s] }; // 잠긴 더미는 비어도 자리 유지
    this.objs.delete(s.id);
    if (s.cards.length === 1) {
      const c = this.makeCard(s.cards[0].face, s.cards[0].back, s.faceUp, s.x, s.y, s.rot, s.cards[0].shape ?? s.shape);
      this.objs.set(c.id, c);
      return { removed: [s.id], changed: [c] };
    }
    return { removed: [s.id], changed: [] };
  }

  /** 덱의 카드 목록 만들기 (트럼프/우노는 코드에 정의, 프로포즈 카드는 decks/propose 폴더에서 읽음) */
  deckCards(deck: DeckType): { cards: IStackCard[]; shape: Shape; label?: string } | string {
    if (deck === "propose" || deck === "cockroach") {
      const d = loadImageDeck(deck);
      if (typeof d === "string") return d;
      return { cards: d.cards.map((face) => ({ face, back: d.back, shape: d.shape })), shape: d.shape, label: d.name };
    }
    const { faces, back } = builtinDeck(deck);
    return { cards: faces.map((face) => ({ face, back })), shape: "P" };
  }

  addDeck(deck: DeckType, x: number, y: number, shuffle: boolean): IStack | string {
    const d = this.deckCards(deck);
    if (typeof d === "string") return d;
    return this.addStack(d.cards, { x, y, shuffle, shape: d.shape, findSpot: true });
  }

  /** 카드 묶음을 더미로 테이블에 놓기 */
  addStack(
    cards: IStackCard[],
    o: { x: number; y: number; shuffle?: boolean; faceUp?: boolean; shape?: Shape; keep?: boolean; label?: string; findSpot?: boolean },
  ): IStack {
    if (o.shuffle) shuffleInPlace(cards);
    const p = o.findSpot ? this.freeSpot(o.x, o.y) : this.clampPos(o.x, o.y);
    const s: IStack = {
      kind: "stack",
      id: newId(),
      cards,
      faceUp: !!o.faceUp,
      shape: o.shape ?? cards[0]?.shape ?? "P",
      keep: o.keep,
      label: o.label,
      x: p.x,
      y: p.y,
      rot: 0,
      z: this.nextZ(),
      lockedBy: null,
      lockAt: 0,
    };
    this.objs.set(s.id, s);
    this.upsert([s]);
    return s;
  }

  /** 새 덱을 놓을 때 기존 물체와 겹치지 않는 자리 찾기 */
  private freeSpot(x: number, y: number): { x: number; y: number } {
    const { w, h } = this.size();
    for (let k = 0; k < 20; k++) {
      const cx = x + (k % 5) * (w * 1.6) * (k % 2 ? 1 : -1) * Math.ceil(k / 2);
      const cy = y + Math.floor(k / 5) * h * 1.3;
      const p = this.clampPos(cx, cy);
      let ok = true;
      for (const o of this.objs.values()) {
        if (Math.abs(o.x - p.x) < w && Math.abs(o.y - p.y) < h) {
          ok = false;
          break;
        }
      }
      if (ok) return p;
    }
    return this.clampPos(x, y);
  }

  // ------------------------------------------------------------------
  // 플레이어 입장 / 퇴장 / 재접속
  // ------------------------------------------------------------------
  playerCount(): number {
    return this.players.size;
  }
  connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  findByToken(token: string): IPlayer | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  addPlayer(nickname: string, tabId: string): IPlayer | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[this.players.size % COLORS.length];
    const p: IPlayer = {
      id: newId(),
      token: newToken(),
      tabId,
      nickname,
      color,
      joinedAt: Date.now(),
      sockets: new Set(),
      connected: false,
      disconnectedAt: null,
      hand: [],
      score: 0,
    };
    this.players.set(p.id, p);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = p.id;
    return p;
  }

  attachSocket(p: IPlayer, socket: Socket) {
    const wasConnected = p.connected;
    p.sockets.add(socket.id);
    p.connected = true;
    p.disconnectedAt = null;
    this.emptySince = null;
    if (p.id === this.hostId) this.hostAwaySince = null;
    socket.join(this.code);
    socket.join(`p:${p.id}`);
    socket.emit("state:full", { room: this.pubRoom(), objects: this.pubObjects(), hand: p.hand, you: p.id });
    this.roomChanged();
    if (!wasConnected) this.notice(`${p.nickname}님이 들어왔어요`, "join");
  }

  /** 소켓 연결이 끊김 (탭 닫기, 네트워크 끊김). 플레이어와 손패는 남겨 두어 재접속 시 복원 */
  detachSocket(p: IPlayer, socketId: string) {
    p.sockets.delete(socketId);
    if (p.sockets.size > 0) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    this.releaseLocksOf(p.id);
    if (p.id === this.hostId) this.hostAwaySince = Date.now();
    if (this.connectedCount() === 0) this.emptySince = Date.now();
    this.roomChanged();
    this.notice(`${p.nickname}님의 연결이 끊겼어요`, "leave");
  }

  /** 완전히 나감(나가기 버튼, 강퇴, 장시간 미접속). 손패는 테이블에 뒷면 더미로 내려놓음 */
  removePlayer(p: IPlayer, reason: string) {
    this.releaseLocksOf(p.id);
    if (p.hand.length) {
      const cards: IStackCard[] = p.hand.map((h) => ({ face: h.face, back: h.back, shape: h.shape ?? "P" }));
      p.hand = [];
      const pos = this.freeSpot(TABLE_W / 2, TABLE_H - 300);
      if (cards.length === 1) {
        const c = this.makeCard(cards[0].face, cards[0].back, false, pos.x, pos.y, 0, cards[0].shape);
        this.objs.set(c.id, c);
        this.upsert([c]);
      } else {
        this.addStack(cards, { x: pos.x, y: pos.y });
      }
    }
    this.players.delete(p.id);
    if (p.id === this.hostId) this.transferHost();
    if (this.connectedCount() === 0) this.emptySince = this.emptySince ?? Date.now();
    this.roomChanged();
    this.notice(`${p.nickname}님이 ${reason}`, "leave");
  }

  transferHost() {
    const next = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    this.hostId = next ? next.id : ([...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? "");
    this.hostAwaySince = null;
    const h = this.players.get(this.hostId);
    if (h) this.notice(`${h.nickname}님이 방장이 되었어요`, "info");
  }

  releaseLocksOf(pid: string) {
    const changed: IObj[] = [];
    for (const o of this.objs.values()) {
      if (o.lockedBy === pid) {
        o.lockedBy = null;
        changed.push(o);
      }
    }
    this.upsert(changed);
  }

  /** 주기 점검: 오래된 잠금 해제 */
  tick() {
    if (this.settleTimer()) this.roomChanged();
    const now = Date.now();
    const changed: IObj[] = [];
    for (const o of this.objs.values()) {
      if (o.lockedBy && now - o.lockAt > LOCK_STALE_MS) {
        o.lockedBy = null;
        changed.push(o);
      }
    }
    this.upsert(changed);
  }

  // ------------------------------------------------------------------
  // 카드 조작
  // ------------------------------------------------------------------
  grab(pid: string, ids: string[]): string[] {
    const objs = this.getObjs(ids).filter((o) => this.canMove(o, pid));
    objs.sort((a, b) => a.z - b.z);
    const now = Date.now();
    for (const o of objs) {
      o.lockedBy = pid;
      o.lockAt = now;
      o.z = this.nextZ();
    }
    this.upsert(objs);
    return objs.map((o) => o.id);
  }

  /** 드래그 중 위치 갱신. 저장만 하고, 다른 사람에게는 가벼운 obj:moving 으로 전달 */
  drag(pid: string, moves: Move[]): Move[] {
    const ok: Move[] = [];
    const now = Date.now();
    for (const m of moves.slice(0, MAX_IDS_PER_REQUEST)) {
      if (!m || !isFiniteNum(m.x) || !isFiniteNum(m.y)) continue;
      const o = this.objs.get(m.id);
      if (!o || o.lockedBy !== pid) continue;
      const p = this.clampPos(m.x, m.y);
      o.x = p.x;
      o.y = p.y;
      o.lockAt = now;
      ok.push({ id: o.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
    }
    return ok;
  }

  release(pid: string, moves: Move[], mergeInto: string | null): { ok: boolean; merged: boolean } {
    const moved: IObj[] = [];
    for (const m of moves.slice(0, MAX_IDS_PER_REQUEST)) {
      if (!m) continue;
      const o = this.objs.get(m.id);
      if (!o || this.isLockedByOther(o, pid) || o.pinnedBy) continue;
      if (isFiniteNum(m.x) && isFiniteNum(m.y)) {
        const p = this.clampPos(m.x, m.y);
        o.x = p.x;
        o.y = p.y;
      }
      o.lockedBy = null;
      moved.push(o);
    }
    // 더미 위에 놓았으면 합치기 (거리 검증)
    if (mergeInto && moved.length) {
      const t = this.objs.get(mergeInto);
      const { w, h } = this.size(t?.shape);
      const primary = moved[moved.length - 1];
      if (
        t &&
        !moved.includes(t) &&
        this.canTouch(t, pid) &&
        Math.abs(primary.x - t.x) < w * 0.75 &&
        Math.abs(primary.y - t.y) < h * 0.75
      ) {
        const target = this.toStack(t);
        const removed: string[] = [];
        moved.sort((a, b) => a.z - b.z);
        for (const o of moved) {
          if (o.kind === "card") target.cards.push({ face: o.face, back: o.back, shape: o.shape });
          else target.cards.push(...o.cards);
          this.objs.delete(o.id);
          removed.push(o.id);
        }
        target.z = this.nextZ();
        if (t.kind === "card") removed.push(t.id);
        this.removeIds(removed);
        this.upsert([target]);
        return { ok: true, merged: true };
      }
    }
    this.upsert(moved);
    return { ok: true, merged: false };
  }

  /** 낱장 카드 위에 놓아 더미를 만들 때: 그 카드를 1장짜리 더미로 바꿈 */
  private toStack(o: IObj): IStack {
    if (o.kind === "stack") return o;
    this.objs.delete(o.id);
    const s: IStack = {
      kind: "stack",
      id: newId(),
      cards: [{ face: o.face, back: o.back, shape: o.shape }],
      faceUp: o.faceUp,
      shape: o.shape,
      x: o.x,
      y: o.y,
      rot: o.rot,
      z: o.z,
      lockedBy: null,
      lockAt: 0,
      pinnedBy: o.pinnedBy,
    };
    this.objs.set(s.id, s);
    return s;
  }

  flip(pid: string, ids: string[]): string | null {
    const all = this.getObjs(ids);
    const objs = all.filter((o) => this.canMove(o, pid));
    if (!objs.length && all.some((o) => o.pinnedBy)) return PINNED_MSG;
    for (const o of objs) {
      if (o.kind === "card") o.faceUp = !o.faceUp;
      else {
        o.cards.reverse(); // 더미를 통째로 뒤집으면 맨 아래 카드가 맨 위로
        o.faceUp = !o.faceUp;
      }
    }
    this.upsert(objs);
    return null;
  }

  rotate(pid: string, ids: string[], delta: number): string | null {
    if (!isFiniteNum(delta) || Math.abs(delta) > 180 || delta % 15 !== 0) return "회전 값이 올바르지 않아요";
    const all = this.getObjs(ids);
    const objs = all.filter((o) => this.canMove(o, pid));
    if (!objs.length && all.some((o) => o.pinnedBy)) return PINNED_MSG;
    for (const o of objs) o.rot = normRot(o.rot + delta);
    this.upsert(objs);
    return null;
  }

  toTop(pid: string, ids: string[]): void {
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    objs.sort((a, b) => a.z - b.z);
    for (const o of objs) o.z = this.nextZ();
    this.upsert(objs);
  }

  /** 선택한 카드를 한 줄로 가지런히 정렬 */
  arrange(pid: string, ids: string[]): void {
    const objs = this.getObjs(ids).filter((o) => this.canMove(o, pid));
    if (!objs.length) return;
    objs.sort((a, b) => a.x - b.x || a.y - b.y);
    const w = Math.max(...objs.map((o) => this.size(o.shape).w));
    const h = Math.max(...objs.map((o) => this.size(o.shape).h));
    const x0 = objs[0].x;
    const y0 = objs.reduce((s, o) => s + o.y, 0) / objs.length;
    const perRow = 10;
    objs.forEach((o, i) => {
      const p = this.clampPos(x0 + (i % perRow) * w * 1.1, y0 + Math.floor(i / perRow) * h * 1.15);
      o.x = p.x;
      o.y = p.y;
      o.rot = 0;
      o.z = this.nextZ();
    });
    this.upsert(objs);
  }

  duplicate(pid: string, ids: string[]): string | null {
    if (!this.canEdit(pid)) return "방장만 복제할 수 있어요 (설정에서 허용 가능)";
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    const created: IObj[] = [];
    for (const o of objs) {
      if (o.kind === "card") {
        const c = this.makeCard(o.face, o.back, o.faceUp, o.x + 30, o.y + 30, o.rot, o.shape);
        this.objs.set(c.id, c);
        created.push(c);
      } else {
        const p = this.clampPos(o.x + 30, o.y + 30);
        const s: IStack = { ...o, id: newId(), cards: o.cards.map((c) => ({ ...c })), keep: false, label: undefined, pinnedBy: undefined, x: p.x, y: p.y, z: this.nextZ(), lockedBy: null, lockAt: 0 };
        this.objs.set(s.id, s);
        created.push(s);
      }
    }
    this.upsert(created);
    return null;
  }

  remove(pid: string, ids: string[]): string | null {
    if (!this.canEdit(pid)) return "방장만 삭제할 수 있어요 (설정에서 허용 가능)";
    const all = this.getObjs(ids);
    const objs = all.filter((o) => this.canMove(o, pid));
    if (!objs.length && all.some((o) => o.pinnedBy)) return PINNED_MSG;
    for (const o of objs) this.objs.delete(o.id);
    this.removeIds(objs.map((o) => o.id));
    return null;
  }

  /** 더미에서 n장 꺼내기 (keep 더미 정리 규칙 적용) */
  private popCards(s: IStack, n: number): IStackCard[] {
    const out: IStackCard[] = [];
    for (let i = 0; i < n; i++) {
      const c = s.cards.pop();
      if (!c) break;
      out.push(c);
    }
    return out;
  }

  /** 더미 맨 위 카드를 집어 듦 (드래그로 한 장 뽑기). 새 카드는 요청자가 잡은 상태로 생성 */
  takeTop(pid: string, stackId: string): PubCard | string {
    const s = this.objs.get(stackId);
    if (!s || s.kind !== "stack") return "더미를 찾을 수 없어요";
    if (!this.canTouch(s, pid)) return "다른 사람이 잡고 있어요";
    const top = s.cards.pop();
    if (!top) return "빈 더미예요";
    const c = this.makeCard(top.face, top.back, s.faceUp, s.x, s.y, s.rot, top.shape ?? s.shape);
    c.lockedBy = pid;
    c.lockAt = Date.now();
    this.objs.set(c.id, c);
    const n = this.normalizeStack(s);
    this.removeIds(n.removed);
    this.upsert([...n.changed, c]);
    return this.pub(c) as PubCard;
  }

  drawToHand(p: IPlayer, stackId: string, count: number): string | null {
    const s = this.objs.get(stackId);
    if (!s) return "대상을 찾을 수 없어요";
    if (!this.canTouch(s, p.id)) return "다른 사람이 잡고 있어요";
    if (s.kind === "card") {
      if (s.pinnedBy) return PINNED_MSG;
      this.objs.delete(s.id);
      p.hand.push(this.toHand(s));
      this.removeIds([s.id]);
    } else {
      if (!s.cards.length) return "빈 더미예요";
      const n = clamp(Math.floor(count) || 1, 1, s.cards.length);
      for (const c of this.popCards(s, n)) p.hand.push(this.toHand(c));
      const r = this.normalizeStack(s);
      this.removeIds(r.removed);
      this.upsert(r.changed);
    }
    this.sendHand(p);
    this.roomChanged();
    return null;
  }

  /** 접속 중인 모든 플레이어에게 n장씩 돌아가며 나눠주기 */
  deal(pid: string, stackId: string, count: number): string | null {
    const s = this.objs.get(stackId);
    if (!s || s.kind !== "stack") return "더미를 찾을 수 없어요";
    if (!this.canTouch(s, pid)) return "다른 사람이 잡고 있어요";
    const n = clamp(Math.floor(count) || 1, 1, 30);
    const { players, given } = this.dealFrom(s, n);
    const who = this.players.get(pid)?.nickname ?? "누군가";
    this.notice(`${who}님이 ${players}명에게 ${given}장을 나눠줬어요`, "deal");
    return null;
  }

  /** 더미에서 접속한 사람들에게 n장씩 (게임 준비에도 사용) */
  dealFrom(s: IStack, n: number): { players: number; given: number } {
    const players = this.connectedPlayers();
    let given = 0;
    for (let round = 0; round < n; round++) {
      for (const p of players) {
        const c = s.cards.pop();
        if (!c) break;
        p.hand.push(this.toHand(c));
        given++;
      }
    }
    const r = this.normalizeStack(s);
    this.removeIds(r.removed);
    this.upsert(r.changed);
    for (const p of players) this.sendHand(p);
    this.roomChanged();
    return { players: players.length, given };
  }

  connectedPlayers(): IPlayer[] {
    return [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  shuffle(pid: string, stackId: string): string | null {
    const s = this.objs.get(stackId);
    if (!s || s.kind !== "stack") return "더미를 찾을 수 없어요";
    if (!this.canTouch(s, pid)) return "다른 사람이 잡고 있어요";
    shuffleInPlace(s.cards);
    this.upsert([s]);
    const who = this.players.get(pid)?.nickname ?? "누군가";
    this.notice(`${who}님이 더미를 섞었어요`, "shuffle", s.id);
    return null;
  }

  /** 더미를 낱장 카드로 펼치기 */
  spread(pid: string, stackId: string): string | null {
    const s = this.objs.get(stackId);
    if (!s || s.kind !== "stack") return "더미를 찾을 수 없어요";
    if (!this.canTouch(s, pid)) return "다른 사람이 잡고 있어요";
    if (s.pinnedBy) return "🔒 잠긴 더미는 펼칠 수 없어요";
    if (!s.cards.length) return "빈 더미예요";
    const { w, h } = this.size(s.shape);
    const perRow = 13;
    const gap = w * 0.42;
    const rows = Math.ceil(s.cards.length / perRow);
    const startX = clamp(s.x, w / 2, TABLE_W - (perRow - 1) * gap - w / 2);
    const startY = clamp(s.y, h / 2, TABLE_H - (rows - 1) * h * 1.1 - h / 2);
    const created: ICard[] = [];
    // 맨 위 카드부터 왼쪽에 놓이도록
    const ordered = [...s.cards].reverse();
    ordered.forEach((c, i) => {
      const card = this.makeCard(c.face, c.back, s.faceUp, startX + (i % perRow) * gap, startY + Math.floor(i / perRow) * h * 1.1, 0, c.shape ?? s.shape);
      this.objs.set(card.id, card);
      created.push(card);
    });
    if (s.keep) {
      s.cards = [];
      created.push(s as unknown as ICard); // 빈 자리는 남겨 둠
      this.upsert(created);
      return null;
    }
    this.objs.delete(s.id);
    this.removeIds([s.id]);
    this.upsert(created);
    return null;
  }

  /** 선택한 낱장 카드들로 새 더미 만들기 */
  createStack(pid: string, ids: string[]): string | null {
    const objs = this.getObjs(ids).filter((o) => this.canMove(o, pid));
    if (objs.length < 2) return "카드를 2장 이상 선택해 주세요";
    objs.sort((a, b) => a.z - b.z);
    const base = objs[0];
    const cards: IStackCard[] = [];
    for (const o of objs) {
      if (o.kind === "card") cards.push({ face: o.face, back: o.back, shape: o.shape });
      else cards.push(...o.cards);
      this.objs.delete(o.id);
    }
    this.removeIds(objs.map((o) => o.id));
    const s = this.addStack(cards, { x: base.x, y: base.y, faceUp: base.faceUp, shape: base.shape });
    s.rot = base.rot;
    return null;
  }

  // ------------------------------------------------------------------
  // 손패
  // ------------------------------------------------------------------
  handTake(p: IPlayer, ids: string[]): string | null {
    const all = this.getObjs(ids);
    const objs = all.filter((o) => this.canMove(o, p.id));
    if (!objs.length) return all.some((o) => o.pinnedBy) ? PINNED_MSG : "가져올 수 있는 카드가 없어요";
    objs.sort((a, b) => a.z - b.z);
    const removed: string[] = [];
    const changed: IObj[] = [];
    for (const o of objs) {
      if (o.kind === "card") p.hand.push(this.toHand(o));
      else for (let i = o.cards.length - 1; i >= 0; i--) p.hand.push(this.toHand(o.cards[i]));
      if (o.kind === "stack" && o.keep) {
        o.cards = [];
        changed.push(o);
      } else {
        this.objs.delete(o.id);
        removed.push(o.id);
      }
    }
    this.removeIds(removed);
    this.upsert(changed);
    this.sendHand(p);
    this.roomChanged();
    return null;
  }

  handPlay(p: IPlayer, cardId: string, x: number, y: number, faceUp: boolean, grab: boolean): PubCard | string {
    const idx = p.hand.findIndex((h) => h.id === cardId);
    if (idx < 0) return "손패에 없는 카드예요";
    if (!isFiniteNum(x) || !isFiniteNum(y)) return "잘못된 위치예요";
    const [h] = p.hand.splice(idx, 1);
    // 손패에서 나온 카드는 새 id를 받음 → 손패 속 카드를 추적할 수 없음
    const c = this.makeCard(h.face, h.back, !!faceUp, x, y, 0, h.shape ?? "P");
    if (grab) {
      c.lockedBy = p.id;
      c.lockAt = Date.now();
    }
    this.objs.set(c.id, c);
    this.upsert([c]);
    this.sendHand(p);
    this.roomChanged();
    return this.pub(c) as PubCard;
  }

  handReorder(p: IPlayer, order: string[]): boolean {
    if (order.length !== p.hand.length) return false;
    const map = new Map(p.hand.map((h) => [h.id, h]));
    const next: HandCard[] = [];
    for (const id of order) {
      const h = map.get(id);
      if (!h) return false;
      map.delete(id);
      next.push(h);
    }
    p.hand = next;
    this.sendHand(p);
    return true;
  }

  // ------------------------------------------------------------------
  // 방장 기능
  // ------------------------------------------------------------------
  /** 테이블과 모든 손패 비우기 */
  clearTable(): void {
    const ids = [...this.objs.keys()];
    this.objs.clear();
    this.removeIds(ids);
    this.claim = null;
    for (const p of this.players.values()) {
      p.hand = [];
      p.score = 0;
      p.uno = false;
      this.sendHand(p);
    }
  }

  reset(): void {
    this.clearTable();
    this.preset = "free";
    this.score = null;
    this.addDeck("standard54", TABLE_W / 2, TABLE_H / 2, true);
    this.roomChanged();
    this.notice("방장이 테이블을 초기화했어요", "warn");
  }

  gather(): void {
    const all = [...this.objs.values()].filter((o) => !o.pinnedBy).sort((a, b) => a.z - b.z); // 잠긴 것은 그대로
    if (!all.length) return;
    const cards: IStackCard[] = [];
    for (const o of all) {
      if (o.kind === "card") cards.push({ face: o.face, back: o.back, shape: o.shape });
      else cards.push(...o.cards);
    }
    for (const o of all) this.objs.delete(o.id);
    this.removeIds(all.map((o) => o.id));
    if (cards.length) this.addStack(cards, { x: TABLE_W / 2, y: TABLE_H / 2, shape: cards[0].shape });
    this.notice("방장이 테이블의 모든 카드를 한 더미로 모았어요", "info");
  }

  newDeck(deck: DeckType): string | null {
    const s = this.addDeck(deck, TABLE_W / 2, TABLE_H / 2, true);
    if (typeof s === "string") return s;
    const names: Record<DeckType, string> = { standard54: "트럼프 54장", uno108: "우노 방식 컬러 카드 108장", propose: "프로포즈 카드", cockroach: "바퀴벌레 포커 카드" };
    this.notice(`${names[deck]} 덱이 추가됐어요`, "info");
    return null;
  }

  // ------------------------------------------------------------------
  // 커스텀 글자 카드 (직접 쓴 카드를 덱에 섞기)
  // ------------------------------------------------------------------
  customCreate(p: IPlayer, rawLines: unknown, target: "deck" | "hand", stackId?: string): string | { count: number } {
    if (!Array.isArray(rawLines)) return "카드 내용을 입력해 주세요";
    const lines = rawLines.slice(0, CUSTOM_LINES_MAX).map((l) => cleanText(l, CUSTOM_TEXT_MAX)).filter(Boolean);
    if (!lines.length) return "카드 내용을 입력해 주세요";
    // 섞을 덱: 지정한 더미 → 없으면 테이블에서 가장 큰 덱
    let deck: IStack | undefined;
    const pick = stackId ? this.objs.get(stackId) : undefined;
    if (pick && pick.kind === "stack") deck = pick;
    if (!deck) deck = [...this.objs.values()].filter((o): o is IStack => o.kind === "stack" && !o.keep).sort((a, b) => b.cards.length - a.cards.length)[0];
    // 커스텀 카드는 덱과 같은 뒷면·모양으로 만들어서 섞으면 구별할 수 없게 함
    const back = deck?.cards[0]?.back ?? (this.preset === "propose" ? "propose" : "blue");
    const shape: Shape = deck?.shape ?? (this.preset === "propose" ? "L" : "P");
    const cards: IStackCard[] = lines.map((t) => ({ face: `T:${t}`, back, shape }));
    if (target === "hand" || !deck) {
      for (const c of cards) p.hand.push(this.toHand(c));
      this.sendHand(p);
      this.roomChanged();
      return { count: cards.length };
    }
    if (!this.canTouch(deck, p.id)) return "다른 사람이 덱을 잡고 있어요";
    for (const c of cards) deck.cards.splice(randomIndex(deck.cards.length + 1), 0, c);
    this.upsert([deck]);
    this.notice(`${p.nickname}님이 직접 쓴 카드 ${cards.length}장을 덱에 섞었어요`, "shuffle", deck.id);
    return { count: cards.length };
  }

  // ------------------------------------------------------------------
  // 점수 (반지)
  // ------------------------------------------------------------------
  scoreAdd(actor: IPlayer, targetId: string, delta: number): string | null {
    if (!this.score) return "이 게임에는 점수판이 없어요";
    if (delta !== 1 && delta !== -1) return "잘못된 값이에요";
    const t = this.players.get(targetId);
    if (!t) return "플레이어를 찾을 수 없어요";
    const before = t.score;
    t.score = clamp(t.score + delta, 0, 99);
    if (t.score === before) return null;
    this.roomChanged();
    const { icon, label, goal } = this.score;
    if (delta > 0) {
      const from = actor.id === t.id ? "" : `${actor.nickname}님이 `;
      this.notice(`${icon} ${from}${t.nickname}님에게 ${label}를 줬어요 (${t.score}/${goal})`, "ring");
      if (before < goal && t.score >= goal) this.notice(`🎉 ${t.nickname}님이 ${label} ${goal}개를 모아 승리했어요!`, "win");
    } else this.notice(`${t.nickname}님의 ${label}가 하나 줄었어요 (${t.score}/${goal})`, "info");
    return null;
  }

  // ------------------------------------------------------------------
  // 공용 타이머 (서버 시계 기준)
  // ------------------------------------------------------------------
  /** 실행 중인 타이머가 끝났으면 멈춤 상태로 정리 */
  settleTimer(): boolean {
    const t = this.timer;
    if (t.running && t.endsAt !== null && Date.now() >= t.endsAt) {
      t.running = false;
      t.endsAt = null;
      t.remainingMs = 0;
      return true;
    }
    return false;
  }
  timerSet(seconds: number): string | null {
    if (!isFiniteNum(seconds) || seconds < 1 || seconds > TIMER_MAX_SEC) return "1초~5분 사이로 정해 주세요";
    const ms = Math.round(seconds) * 1000;
    this.timer = { durationMs: ms, running: false, endsAt: null, remainingMs: ms };
    this.roomChanged();
    return null;
  }
  timerStart(): void {
    this.settleTimer();
    const t = this.timer;
    if (t.running) return;
    if (t.remainingMs <= 0) t.remainingMs = t.durationMs;
    t.running = true;
    t.endsAt = Date.now() + t.remainingMs;
    this.roomChanged();
  }
  timerPause(): void {
    this.settleTimer();
    const t = this.timer;
    if (!t.running || t.endsAt === null) return;
    t.remainingMs = Math.max(0, t.endsAt - Date.now());
    t.running = false;
    t.endsAt = null;
    this.roomChanged();
  }
  timerReset(): void {
    this.timer = { durationMs: this.timer.durationMs, running: false, endsAt: null, remainingMs: this.timer.durationMs };
    this.roomChanged();
  }

  setBgm(track: unknown): string | null {
    if (track !== null && !BGM_TRACKS.includes(track as BgmTrack)) return "알 수 없는 음악이에요";
    this.bgm = { track: track as BgmTrack | null };
    this.roomChanged();
    return null;
  }

  // ------------------------------------------------------------------
  // 🔒 잠금 / 👁 몰래 보기
  // ------------------------------------------------------------------
  /** 잠그기는 누구나, 풀기는 잠근 사람 또는 방장 */
  setPinned(pid: string, ids: string[], pinned: boolean): string | null {
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    const changed: IObj[] = [];
    let denied = 0;
    for (const o of objs) {
      if (pinned) {
        if (o.pinnedBy) continue;
        o.pinnedBy = pid;
        o.lockedBy = null;
        changed.push(o);
      } else {
        if (!o.pinnedBy) continue;
        if (o.pinnedBy !== pid && pid !== this.hostId && this.players.has(o.pinnedBy)) {
          denied++;
          continue;
        }
        o.pinnedBy = undefined;
        changed.push(o);
      }
    }
    // 잠금을 푼 더미가 1장 이하면 낱장으로 정리
    const removed: string[] = [];
    const out: IObj[] = [];
    for (const o of changed) {
      if (!pinned && o.kind === "stack") {
        const n = this.normalizeStack(o);
        removed.push(...n.removed);
        out.push(...n.changed);
      } else out.push(o);
    }
    this.removeIds(removed);
    this.upsert(out);
    if (!changed.length && denied) {
      const by = this.players.get(objs.find((o) => o.pinnedBy)?.pinnedBy ?? "")?.nickname ?? "다른 사람";
      return `${by}님이 잠근 거예요. 잠근 사람이나 방장만 풀 수 있어요`;
    }
    return null;
  }

  /** 뒷면 카드 몰래 보기: 정체는 요청한 사람에게만, "봤다"는 사실은 모두에게 */
  peek(p: IPlayer, id: string): string | null {
    const o = this.objs.get(id);
    if (!o || o.kind !== "card") return "카드를 찾을 수 없어요";
    if (o.faceUp) return "이미 앞면이에요";
    if (!this.canTouch(o, p.id)) return "다른 사람이 잡고 있어요";
    this.io.to(`p:${p.id}`).emit("peek", { id: o.id, face: o.face, back: o.back, shape: o.shape === "L" ? "L" : undefined });
    this.notice(`👁 ${p.nickname}님이 카드를 몰래 봤어요`, "peek");
    return null;
  }

  // ------------------------------------------------------------------
  // 우노! / 바퀴벌레 포커 선언
  // ------------------------------------------------------------------
  callUno(p: IPlayer): string | null {
    if (this.preset !== "uno") return "우노 게임에서만 외칠 수 있어요";
    if (p.hand.length > 2) return "카드가 2장 이하일 때 외칠 수 있어요";
    const now = Date.now();
    if (p.unoAt && now - p.unoAt < 2000) return null; // 연타 방지
    p.unoAt = now;
    p.uno = true;
    this.roomChanged();
    this.notice(`🔔 ${p.nickname}: 우노!`, "uno");
    return null;
  }

  sayClaim(p: IPlayer, to: string, creature: string): string | null {
    const c = CREATURES.find((x) => x.id === creature);
    const target = this.players.get(to);
    if (!c) return "알 수 없는 벌레예요";
    if (!target || target.id === p.id) return "받을 사람을 골라 주세요";
    this.claim = { by: p.id, to: target.id, creature: c.id as CreatureId, answer: null, at: Date.now() };
    this.roomChanged();
    this.notice(`📣 ${p.nickname} → ${target.nickname}: "이건 ${c.icon} ${c.name}야!"`, "claim");
    return null;
  }

  answerClaim(p: IPlayer, answer: unknown): string | null {
    const cl = this.claim;
    if (!cl) return "대답할 선언이 없어요";
    if (cl.to !== p.id) return "선언을 받은 사람만 대답할 수 있어요";
    if (answer !== "yes" && answer !== "no") return "잘못된 대답이에요";
    if (cl.answer) return "이미 대답했어요";
    cl.answer = answer;
    this.roomChanged();
    const c = CREATURES.find((x) => x.id === cl.creature)!;
    this.notice(`${p.nickname}: ${answer === "yes" ? `"진짜 ${c.name} 맞아!" 🙆` : `"${c.name} 아니야, 거짓말!" 🙅`} — 카드를 뒤집어 확인하세요`, "claim");
    return null;
  }

  updateSettings(patch: Record<string, unknown>): void {
    if (typeof patch.background === "string" && BACKGROUNDS.includes(patch.background as Background)) this.settings.background = patch.background as Background;
    if (typeof patch.cardScale === "number" && SCALES.includes(patch.cardScale)) this.settings.cardScale = patch.cardScale;
    if (typeof patch.allowEveryoneDelete === "boolean") this.settings.allowEveryoneDelete = patch.allowEveryoneDelete;
    if (typeof patch.name === "string") {
      const n = cleanText(patch.name, 24);
      if (n) this.name = n;
    }
    this.roomChanged();
  }
}
