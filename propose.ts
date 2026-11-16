// =====================================================================
// 방금 떠올린 프로포즈의 말을 너에게 바칠게 — 라운드 진행 자동
//  - 라운드마다 "프로포즈 받는 사람"이 한 명. 나머지는 손패 카드를 테이블에 자유롭게 내서 프로포즈
//  - 반지는 받는 사람만, 한 라운드에 딱 1개, 자기 자신이 아닌 사람에게 줄 수 있음
//  - "다음 라운드": 테이블 카드 정리(단어 카드는 버림), 모두 기본 카드 6장 되돌려 받기,
//    단어 카드 6장까지 덱에서 보충, 받는 사람은 다음 사람으로
//  - 반지 3개를 모으면 승리
// =====================================================================
import { TABLE_H, TABLE_W, type PubPropose } from "../../../shared/protocol";
import { loadImageDeck } from "../decks";
import type { IPlayer, IStack, IStackCard, Room } from "../room";
import { randomIndex, shuffleInPlace } from "../util";
import { nextInOrder, type GameEngine } from "./types";

export const PROPOSE_WORDS = 6;

export class ProposeGame implements GameEngine {
  readonly kind = "propose" as const;
  readonly blocksFreePlay = false; // 카드는 테이블에 자유롭게 내서 문장을 만듦
  receiver: string | null = null;
  round = 1;
  given: string | null = null;
  deckId = "";
  base: IStackCard[] = [];
  baseFaces = new Set<string>();
  /** 버린 단어 카드 (덱이 떨어지면 섞어서 다시 사용) */
  discard: IStackCard[] = [];

  constructor(private room: Room) {}

  static start(room: Room): ProposeGame | string {
    const d = loadImageDeck("propose");
    if (typeof d === "string") return d;
    room.clearTable();
    room.preset = "propose";
    room.score = { label: "반지", icon: "💍", goal: 3 };
    const g = new ProposeGame(room);
    const cards: IStackCard[] = d.cards.map((face) => ({ face, back: d.back, shape: d.shape }));
    const deck = room.addStack(cards, { x: TABLE_W / 2, y: TABLE_H / 2 - 120, shuffle: true, shape: d.shape, label: "프로포즈 카드", system: true });
    g.deckId = deck.id;
    g.base = d.base.map((face) => ({ face, back: d.back, shape: d.shape }));
    g.baseFaces = new Set(d.base);
    room.game = g;
    const players = room.connectedPlayers();
    for (const p of players) g.dealIn(p);
    room.emitUpsert([deck]);
    g.receiver = players.length ? players[randomIndex(players.length)].id : null;
    room.timerSet(60);
    if (d.placeholder) room.notice("아직 카드 그림이 없어서 임시 글자 카드로 준비했어요 (decks/propose 폴더에 그림을 넣으면 바뀌어요)", "warn");
    return g;
  }

  private deck(): IStack {
    return this.room.objs.get(this.deckId) as IStack;
  }
  private name(id: string | null) {
    return (id && this.room.players.get(id)?.nickname) || "?";
  }
  private isBase(face: string) {
    return this.baseFaces.has(face);
  }

  /** 기본 카드 한 벌 + 단어 카드를 6장까지 */
  private dealIn(p: IPlayer) {
    p.hand = p.hand.filter((h) => !this.isBase(h.face));
    const words = p.hand.length;
    p.hand.unshift(...this.base.map((c) => this.room.handCard(c)));
    const deck = this.deck();
    for (let i = words; i < PROPOSE_WORDS; i++) {
      if (!deck.cards.length && this.discard.length) {
        deck.cards = this.discard;
        this.discard = [];
        shuffleInPlace(deck.cards);
        this.room.notice("🔀 덱이 떨어져서 버린 카드를 섞어 새 덱을 만들었어요", "shuffle", deck.id);
      }
      const c = deck.cards.pop();
      if (!c) break;
      p.hand.push(this.room.handCard(c));
    }
    this.room.sendHand(p);
  }

  giveRing(p: IPlayer, to: string): string | null {
    if (p.id !== this.receiver) return `반지는 이번에 프로포즈를 받는 ${this.name(this.receiver)}님만 줄 수 있어요`;
    if (this.given) return "이번 라운드에는 이미 반지를 줬어요";
    const t = this.room.players.get(to);
    if (!t || t.id === p.id) return "반지를 받을 사람을 골라 주세요";
    const goal = this.room.score?.goal ?? 3;
    t.score += 1;
    this.given = t.id;
    this.room.roomChanged();
    this.room.notice(`💍 ${p.nickname}님이 ${t.nickname}님의 프로포즈를 받아들였어요! (${t.nickname} 반지 ${t.score}/${goal})`, "ring");
    if (t.score === goal) this.room.notice(`🎉 ${t.nickname}님이 반지 ${goal}개를 모아 승리했어요!`, "win");
    return null;
  }

  /** 다음 라운드 (받는 사람: 반지를 준 뒤 / 방장: 언제든) */
  next(p: IPlayer): string | null {
    const host = p.id === this.room.hostId;
    if (!host && p.id !== this.receiver) return "다음 라운드는 프로포즈를 받는 사람이나 방장이 넘길 수 있어요";
    if (!host && !this.given) return "먼저 마음에 드는 프로포즈에 반지를 주세요";
    // 테이블 정리: 덱을 뺀 모든 카드 → 단어 카드는 버린 카드로, 기본 카드는 회수
    const removed: string[] = [];
    for (const o of [...this.room.objs.values()]) {
      if (o.id === this.deckId) continue;
      const cards: IStackCard[] = o.kind === "card" ? [{ face: o.face, back: o.back, shape: o.shape }] : o.cards;
      for (const c of cards) if (!this.isBase(c.face)) this.discard.push({ face: c.face, back: c.back, shape: c.shape });
      this.room.objs.delete(o.id);
      removed.push(o.id);
    }
    this.room.emitRemove(removed);
    const players = this.room.connectedPlayers();
    for (const pl of players) this.dealIn(pl);
    this.room.emitUpsert([this.deck()]);
    // 받는 사람은 다음 사람으로 (참가 순서)
    const order = players.map((x) => x.id);
    const i = this.receiver ? order.indexOf(this.receiver) : -1;
    this.receiver = order.length ? order[i < 0 ? 0 : nextInOrder(order, i, 1, () => true)] : null;
    this.round += 1;
    this.given = null;
    this.room.timerReset();
    this.room.roomChanged();
    this.room.notice(`💍 ${this.round}라운드! 이번엔 ${this.name(this.receiver)}님이 프로포즈를 받아요`, "deal");
    return null;
  }

  setReceiver(by: IPlayer, pid: string): string | null {
    if (by.id !== this.room.hostId) return "받는 사람 바꾸기는 방장만 할 수 있어요";
    const t = this.room.players.get(pid);
    if (!t) return "플레이어를 찾을 수 없어요";
    this.receiver = t.id;
    this.room.roomChanged();
    this.room.notice(`💍 이번엔 ${t.nickname}님이 프로포즈를 받아요 (방장이 바꿈)`, "info");
    return null;
  }

  onJoin(p: IPlayer): void {
    if (!p.hand.length) this.dealIn(p);
  }

  onLeave(p: IPlayer): void {
    for (const h of p.hand) if (!this.isBase(h.face)) this.discard.push({ face: h.face, back: h.back, shape: h.shape });
    p.hand = [];
    if (this.receiver === p.id) {
      const order = this.room.connectedPlayers().map((x) => x.id).filter((id) => id !== p.id);
      this.receiver = order[0] ?? null;
      this.given = null;
    }
  }

  skip(by: IPlayer): string | null {
    return this.next(by);
  }

  pub(): PubPropose {
    return { kind: "propose", receiver: this.receiver, round: this.round, given: this.given };
  }
}
