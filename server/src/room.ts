// =====================================================================
// 게임방 하나의 전체 상태와 모든 카드 조작 로직
// - 서버가 "최종 상태"를 결정합니다. 클라이언트 요청은 여기서 검증한 뒤에만 반영됩니다.
// - 숨겨진 정보(뒷면 카드의 정체, 더미 안의 순서, 남의 손패)는 pub*() 함수에서
//   아예 빼고 보내므로 개발자 도구로 네트워크를 봐도 알 수 없습니다.
// - 메모리에만 저장합니다. 서버를 재시작하면 모든 방이 사라집니다.
// =====================================================================
import type { Server, Socket } from "socket.io";
import {
  CARD_H,
  CARD_W,
  MAX_IDS_PER_REQUEST,
  MAX_PLAYERS,
  TABLE_H,
  TABLE_W,
  type BackStyle,
  type Background,
  type DeckType,
  type Face,
  type HandCard,
  type Move,
  type PubCard,
  type PubObj,
  type PubPlayer,
  type PubRoom,
  type PubStack,
  type RoomSettings,
} from "../../shared/protocol";
import { deckFaces } from "../../shared/cards";
import { clamp, cleanText, isFiniteNum, newId, newToken, normRot, shuffleInPlace } from "./util";

interface ICard {
  kind: "card";
  id: string;
  face: Face;
  back: BackStyle;
  faceUp: boolean;
  x: number;
  y: number;
  rot: number;
  z: number;
  lockedBy: string | null;
  lockAt: number;
}

interface IStackCard {
  face: Face;
  back: BackStyle;
}

interface IStack {
  kind: "stack";
  id: string;
  /** cards[0] = 맨 아래, 마지막 = 맨 위 */
  cards: IStackCard[];
  faceUp: boolean;
  x: number;
  y: number;
  rot: number;
  z: number;
  lockedBy: string | null;
  lockAt: number;
}

type IObj = ICard | IStack;

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
}

const COLORS = ["#ef476f", "#118ab2", "#ffd166", "#06d6a0", "#9b5de5", "#f78c6b", "#4cc9f0", "#c9ada7"];
const LOCK_STALE_MS = 15_000;
const BACKGROUNDS: Background[] = ["felt", "navy", "black", "wood"];
const SCALES = [0.8, 1, 1.25];

export class Room {
  readonly code: string;
  name: string;
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
      back: (o.faceUp ? o.cards[0] : top)?.back ?? "blue",
      lockedBy: o.lockedBy,
    };
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
      }));
  }

  pubRoom(): PubRoom {
    return { code: this.code, name: this.name, hostId: this.hostId, settings: { ...this.settings }, players: this.pubPlayers() };
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
  notice(text: string, kind: "join" | "leave" | "info" | "shuffle" | "warn" = "info", stackId?: string) {
    this.io.to(this.code).emit("notice", { text, kind, stackId });
  }
  /** 손패는 소유자 전용 채널(p:<플레이어id>)로만 전송 */
  sendHand(p: IPlayer) {
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
  private size() {
    return { w: CARD_W * this.settings.cardScale, h: CARD_H * this.settings.cardScale };
  }
  private getObjs(ids: string[]): IObj[] {
    const out: IObj[] = [];
    for (const id of ids.slice(0, MAX_IDS_PER_REQUEST)) {
      const o = this.objs.get(id);
      if (o) out.push(o);
    }
    return out;
  }
  private makeCard(face: Face, back: BackStyle, faceUp: boolean, x: number, y: number, rot = 0): ICard {
    const p = this.clampPos(x, y);
    return { kind: "card", id: newId(), face, back, faceUp, x: p.x, y: p.y, rot, z: this.nextZ(), lockedBy: null, lockAt: 0 };
  }
  /** 더미가 1장 이하가 되면 정리: 1장 → 낱장 카드, 0장 → 삭제 */
  private normalizeStack(s: IStack): { removed: string[]; changed: IObj[] } {
    if (s.cards.length >= 2) return { removed: [], changed: [s] };
    this.objs.delete(s.id);
    if (s.cards.length === 1) {
      const c = this.makeCard(s.cards[0].face, s.cards[0].back, s.faceUp, s.x, s.y, s.rot);
      this.objs.set(c.id, c);
      return { removed: [s.id], changed: [c] };
    }
    return { removed: [s.id], changed: [] };
  }

  addDeck(deck: DeckType, x: number, y: number, shuffle: boolean): IStack {
    const { faces, back } = deckFaces(deck);
    const cards = faces.map((face) => ({ face, back }));
    if (shuffle) shuffleInPlace(cards);
    const p = this.freeSpot(x, y);
    const s: IStack = { kind: "stack", id: newId(), cards, faceUp: false, x: p.x, y: p.y, rot: 0, z: this.nextZ(), lockedBy: null, lockAt: 0 };
    this.objs.set(s.id, s);
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
      const cards = p.hand.map((h) => ({ face: h.face, back: h.back }));
      p.hand = [];
      const pos = this.freeSpot(TABLE_W / 2, TABLE_H - 300);
      if (cards.length === 1) {
        const c = this.makeCard(cards[0].face, cards[0].back, false, pos.x, pos.y);
        this.objs.set(c.id, c);
        this.upsert([c]);
      } else {
        const s: IStack = { kind: "stack", id: newId(), cards, faceUp: false, x: pos.x, y: pos.y, rot: 0, z: this.nextZ(), lockedBy: null, lockAt: 0 };
        this.objs.set(s.id, s);
        this.upsert([s]);
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
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
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
      if (!o || this.isLockedByOther(o, pid)) continue;
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
      const { w, h } = this.size();
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
          if (o.kind === "card") target.cards.push({ face: o.face, back: o.back });
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
      cards: [{ face: o.face, back: o.back }],
      faceUp: o.faceUp,
      x: o.x,
      y: o.y,
      rot: o.rot,
      z: o.z,
      lockedBy: null,
      lockAt: 0,
    };
    this.objs.set(s.id, s);
    return s;
  }

  flip(pid: string, ids: string[]): void {
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    for (const o of objs) {
      if (o.kind === "card") o.faceUp = !o.faceUp;
      else {
        o.cards.reverse(); // 더미를 통째로 뒤집으면 맨 아래 카드가 맨 위로
        o.faceUp = !o.faceUp;
      }
    }
    this.upsert(objs);
  }

  rotate(pid: string, ids: string[], delta: number): boolean {
    if (!isFiniteNum(delta) || Math.abs(delta) > 180 || delta % 15 !== 0) return false;
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    for (const o of objs) o.rot = normRot(o.rot + delta);
    this.upsert(objs);
    return true;
  }

  toTop(pid: string, ids: string[]): void {
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    objs.sort((a, b) => a.z - b.z);
    for (const o of objs) o.z = this.nextZ();
    this.upsert(objs);
  }

  /** 선택한 카드를 한 줄로 가지런히 정렬 */
  arrange(pid: string, ids: string[]): void {
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    if (!objs.length) return;
    objs.sort((a, b) => a.x - b.x || a.y - b.y);
    const { w, h } = this.size();
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
        const c = this.makeCard(o.face, o.back, o.faceUp, o.x + 30, o.y + 30, o.rot);
        this.objs.set(c.id, c);
        created.push(c);
      } else {
        const p = this.clampPos(o.x + 30, o.y + 30);
        const s: IStack = { ...o, id: newId(), cards: o.cards.map((c) => ({ ...c })), x: p.x, y: p.y, z: this.nextZ(), lockedBy: null, lockAt: 0 };
        this.objs.set(s.id, s);
        created.push(s);
      }
    }
    this.upsert(created);
    return null;
  }

  remove(pid: string, ids: string[]): string | null {
    if (!this.canEdit(pid)) return "방장만 삭제할 수 있어요 (설정에서 허용 가능)";
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    for (const o of objs) this.objs.delete(o.id);
    this.removeIds(objs.map((o) => o.id));
    return null;
  }

  /** 더미 맨 위 카드를 집어 듦 (드래그로 한 장 뽑기). 새 카드는 요청자가 잡은 상태로 생성 */
  takeTop(pid: string, stackId: string): PubCard | string {
    const s = this.objs.get(stackId);
    if (!s || s.kind !== "stack") return "더미를 찾을 수 없어요";
    if (!this.canTouch(s, pid)) return "다른 사람이 잡고 있어요";
    const top = s.cards.pop();
    if (!top) return "빈 더미예요";
    const c = this.makeCard(top.face, top.back, s.faceUp, s.x, s.y, s.rot);
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
      this.objs.delete(s.id);
      p.hand.push({ id: newId(), face: s.face, back: s.back });
      this.removeIds([s.id]);
    } else {
      const n = clamp(Math.floor(count) || 1, 1, s.cards.length);
      for (let i = 0; i < n; i++) {
        const c = s.cards.pop()!;
        p.hand.push({ id: newId(), face: c.face, back: c.back });
      }
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
    const players = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const n = clamp(Math.floor(count) || 1, 1, 30);
    let given = 0;
    for (let round = 0; round < n; round++) {
      for (const p of players) {
        const c = s.cards.pop();
        if (!c) break;
        p.hand.push({ id: newId(), face: c.face, back: c.back });
        given++;
      }
    }
    const r = this.normalizeStack(s);
    this.removeIds(r.removed);
    this.upsert(r.changed);
    for (const p of players) this.sendHand(p);
    this.roomChanged();
    const who = this.players.get(pid)?.nickname ?? "누군가";
    this.notice(`${who}님이 ${players.length}명에게 ${given}장을 나눠줬어요`, "info");
    return null;
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
    const { w, h } = this.size();
    const perRow = 13;
    const gap = w * 0.42;
    const rows = Math.ceil(s.cards.length / perRow);
    const startX = clamp(s.x, w / 2, TABLE_W - (perRow - 1) * gap - w / 2);
    const startY = clamp(s.y, h / 2, TABLE_H - (rows - 1) * h * 1.1 - h / 2);
    const created: ICard[] = [];
    // 맨 위 카드부터 왼쪽에 놓이도록
    const ordered = [...s.cards].reverse();
    ordered.forEach((c, i) => {
      const card = this.makeCard(c.face, c.back, s.faceUp, startX + (i % perRow) * gap, startY + Math.floor(i / perRow) * h * 1.1);
      this.objs.set(card.id, card);
      created.push(card);
    });
    this.objs.delete(s.id);
    this.removeIds([s.id]);
    this.upsert(created);
    return null;
  }

  /** 선택한 낱장 카드들로 새 더미 만들기 */
  createStack(pid: string, ids: string[]): string | null {
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, pid));
    if (objs.length < 2) return "카드를 2장 이상 선택해 주세요";
    objs.sort((a, b) => a.z - b.z);
    const base = objs[0];
    const cards: IStackCard[] = [];
    for (const o of objs) {
      if (o.kind === "card") cards.push({ face: o.face, back: o.back });
      else cards.push(...o.cards);
      this.objs.delete(o.id);
    }
    const s: IStack = { kind: "stack", id: newId(), cards, faceUp: base.faceUp, x: base.x, y: base.y, rot: base.rot, z: this.nextZ(), lockedBy: null, lockAt: 0 };
    this.objs.set(s.id, s);
    this.removeIds(objs.map((o) => o.id));
    this.upsert([s]);
    return null;
  }

  // ------------------------------------------------------------------
  // 손패
  // ------------------------------------------------------------------
  handTake(p: IPlayer, ids: string[]): string | null {
    const objs = this.getObjs(ids).filter((o) => this.canTouch(o, p.id));
    if (!objs.length) return "가져올 수 있는 카드가 없어요";
    objs.sort((a, b) => a.z - b.z);
    for (const o of objs) {
      if (o.kind === "card") p.hand.push({ id: newId(), face: o.face, back: o.back });
      else for (let i = o.cards.length - 1; i >= 0; i--) p.hand.push({ id: newId(), face: o.cards[i].face, back: o.cards[i].back });
      this.objs.delete(o.id);
    }
    this.removeIds(objs.map((o) => o.id));
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
    const c = this.makeCard(h.face, h.back, !!faceUp, x, y);
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
  reset(): void {
    const ids = [...this.objs.keys()];
    this.objs.clear();
    this.removeIds(ids);
    for (const p of this.players.values()) {
      p.hand = [];
      this.sendHand(p);
    }
    const s = this.addDeck("standard54", TABLE_W / 2, TABLE_H / 2, true);
    this.upsert([s]);
    this.roomChanged();
    this.notice("방장이 테이블을 초기화했어요", "warn");
  }

  gather(): void {
    const all = [...this.objs.values()].sort((a, b) => a.z - b.z);
    if (!all.length) return;
    const cards: IStackCard[] = [];
    for (const o of all) {
      if (o.kind === "card") cards.push({ face: o.face, back: o.back });
      else cards.push(...o.cards);
    }
    this.objs.clear();
    this.removeIds(all.map((o) => o.id));
    const s: IStack = { kind: "stack", id: newId(), cards, faceUp: false, x: TABLE_W / 2, y: TABLE_H / 2, rot: 0, z: this.nextZ(), lockedBy: null, lockAt: 0 };
    this.objs.set(s.id, s);
    this.upsert([s]);
    this.notice("방장이 테이블의 모든 카드를 한 더미로 모았어요", "info");
  }

  newDeck(deck: DeckType): void {
    const s = this.addDeck(deck, TABLE_W / 2, TABLE_H / 2, true);
    this.upsert([s]);
    this.notice(deck === "amumal" ? "단어 카드 덱이 추가됐어요" : "트럼프 54장 덱이 추가됐어요", "info");
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
