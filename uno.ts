// =====================================================================
// 우노 방식 컬러 카드 — 규칙 자동
//  - 차례 순서대로 진행, 낼 수 있는 카드만 낼 수 있음 (같은 색 / 같은 숫자·기호 / 와일드)
//  - 스킵(⊘): 다음 사람 건너뜀 · 리버스(⇄): 방향 바꿈 (2명이면 스킵과 같음)
//  - +2: 다음 사람이 2장 받고 건너뜀 · 와일드: 색 고르기 · 와일드 +4: 색 고르기 + 다음 사람 4장 받고 건너뜀
//  - 낼 카드가 없거나 내기 싫으면 1장 뽑기 → 뽑은 카드가 낼 수 있으면 그 카드만 내거나 넘기기, 못 내면 자동으로 넘어감
//  - 카드가 1장 남았는데 "우노!"를 안 외쳤으면, 다음 사람이 무언가 하기 전까지 다른 사람이 "잡기" → 2장 받음
//  - 손패를 다 내면 승리
//  - 와일드 +4 는 지금 색과 같은 색 카드가 손에 없을 때만 낼 수 있음 (공식 규칙, 서버가 확인하므로 "도전" 단계는 없음)
// 단순화: 점수 계산은 없음 (손패를 먼저 다 낸 사람이 승리)
// =====================================================================
import { builtinDeck } from "../../../shared/cards";
import { TABLE_H, TABLE_W, type HandCard, type PubUno, type UnoColor } from "../../../shared/protocol";
import type { IPlayer, IStack, IStackCard, Room } from "../room";
import { randomIndex, shuffleInPlace } from "../util";
import { nextInOrder, type GameEngine } from "./types";

const COLORS: UnoColor[] = ["R", "Y", "G", "B"];
const COLOR_NAME: Record<string, string> = { R: "빨강", Y: "노랑", G: "초록", B: "파랑" };
const VALUE_NAME: Record<string, string> = { S: "스킵", V: "리버스", D2: "+2", W: "와일드", D4: "와일드 +4" };

export function parseUno(face: string): { color: UnoColor | "W"; value: string } | null {
  const m = /^U:([RYGBW])-(\w+)$/.exec(face);
  return m ? { color: m[1] as UnoColor | "W", value: m[2] } : null;
}
const cardName = (face: string) => {
  const c = parseUno(face);
  if (!c) return "?";
  if (c.color === "W") return VALUE_NAME[c.value];
  return `${COLOR_NAME[c.color]} ${VALUE_NAME[c.value] ?? c.value}`;
};

export class UnoGame implements GameEngine {
  readonly kind = "uno" as const;
  readonly blocksFreePlay = true;
  order: string[] = [];
  turnIdx = 0;
  dir: 1 | -1 = 1;
  color: UnoColor = "R";
  /** 이번 차례에 뽑은 카드 (그 카드만 낼 수 있음) */
  drewCard: string | null = null;
  vulnerable: string | null = null;
  winner: string | null = null;
  last = "";
  deckId = "";
  pileId = "";

  constructor(private room: Room) {}

  static start(room: Room): UnoGame | string {
    const players = room.connectedPlayers();
    if (players.length < 2) return "우노는 2명 이상 접속해 있어야 시작할 수 있어요";
    room.clearTable();
    room.preset = "uno";
    room.score = null;
    const g = new UnoGame(room);
    const { faces, back } = builtinDeck("uno108");
    const deck = room.addStack(
      faces.map((face) => ({ face, back })),
      { x: TABLE_W / 2 - 120, y: TABLE_H / 2, shuffle: true, label: "우노 덱", system: true },
    );
    const pile = room.addStack([], { x: TABLE_W / 2 + 120, y: TABLE_H / 2, faceUp: true, label: "버린 카드", system: true });
    g.deckId = deck.id;
    g.pileId = pile.id;
    g.order = players.map((p) => p.id);
    for (const p of players) p.uno = false;
    for (let r = 0; r < 7; r++) for (const p of players) p.hand.push(room.handCard(deck.cards.pop()!));
    // 첫 카드는 숫자 카드가 나올 때까지 (기호·와일드는 덱 맨 아래로)
    for (let i = 0; i < 108; i++) {
      const c = deck.cards.pop()!;
      const u = parseUno(c.face)!;
      if (u.color !== "W" && /^\d$/.test(u.value)) {
        pile.cards.push(c);
        g.color = u.color;
        break;
      }
      deck.cards.unshift(c);
    }
    g.turnIdx = randomIndex(g.order.length);
    g.last = `첫 카드: ${cardName(pile.cards[pile.cards.length - 1].face)}`;
    room.game = g;
    room.emitUpsert([deck, pile]);
    for (const p of players) room.sendHand(p);
    room.timerSet(30);
    return g;
  }

  // ------------------------------------------------------------------
  // 도우미
  // ------------------------------------------------------------------
  private stack(id: string): IStack {
    return this.room.objs.get(id) as IStack;
  }
  private get top(): IStackCard | undefined {
    const p = this.stack(this.pileId);
    return p.cards[p.cards.length - 1];
  }
  current(): string | null {
    return this.winner ? null : (this.order[this.turnIdx] ?? null);
  }
  private name(id: string | null) {
    return (id && this.room.players.get(id)?.nickname) || "?";
  }
  private live = (id: string) => !!this.room.players.get(id)?.connected;

  canPlay(face: string): boolean {
    const c = parseUno(face);
    const t = this.top && parseUno(this.top.face);
    if (!c) return false;
    if (c.color === "W") return true;
    return c.color === this.color || (!!t && t.value === c.value);
  }

  /** 손패에 이 색 카드가 있는지 (와일드 +4 제한) */
  hasColor(p: IPlayer, color: UnoColor, exceptId?: string): boolean {
    return p.hand.some((x) => x.id !== exceptId && parseUno(x.face)?.color === color);
  }

  private advance(skipNext = false) {
    this.turnIdx = nextInOrder(this.order, this.turnIdx, this.dir, this.live);
    if (skipNext) this.turnIdx = nextInOrder(this.order, this.turnIdx, this.dir, this.live);
    this.drewCard = null;
  }

  /** 덱이 비면 버린 카드(맨 위 제외)를 섞어 덱으로 */
  private refill(): boolean {
    const deck = this.stack(this.deckId);
    if (deck.cards.length) return true;
    const pile = this.stack(this.pileId);
    if (pile.cards.length <= 1) return false;
    const keep = pile.cards.pop()!;
    deck.cards = pile.cards;
    pile.cards = [keep];
    shuffleInPlace(deck.cards);
    this.room.notice("🔀 덱이 떨어져서 버린 카드를 섞어 새 덱을 만들었어요", "shuffle", deck.id);
    return true;
  }

  private draw(p: IPlayer, n: number): HandCard[] {
    const out: HandCard[] = [];
    for (let i = 0; i < n; i++) {
      if (!this.refill()) break;
      const c = this.stack(this.deckId).cards.pop()!;
      const h = this.room.handCard(c);
      p.hand.push(h);
      out.push(h);
    }
    if (out.length) p.uno = false; // 카드를 받으면 다시 외쳐야 함
    this.room.sendHand(p);
    return out;
  }

  /** 다른 사람이 무언가 하면 "우노 안 외침" 잡기 기회가 끝남 */
  private closeCatchWindow(actor: string) {
    if (this.vulnerable && this.vulnerable !== actor) this.vulnerable = null;
  }

  private turnError(p: IPlayer): string | null {
    if (this.winner) return "게임이 끝났어요. 방장이 다시 시작할 수 있어요";
    if (!this.order.includes(p.id)) return "이번 판에는 참여하지 않았어요 (다음 판부터 참여)";
    if (this.current() !== p.id) return `지금은 ${this.name(this.current())}님 차례예요`;
    return null;
  }

  private changed() {
    this.room.emitUpsert([this.stack(this.deckId), this.stack(this.pileId)]);
    this.room.roomChanged();
  }

  // ------------------------------------------------------------------
  // 행동
  // ------------------------------------------------------------------
  play(p: IPlayer, cardId: string, chosen?: unknown): string | null {
    const err = this.turnError(p);
    if (err) return err;
    const idx = p.hand.findIndex((h) => h.id === cardId);
    if (idx < 0) return "손패에 없는 카드예요";
    const h = p.hand[idx];
    if (this.drewCard && this.drewCard !== cardId) return "뽑은 카드만 낼 수 있어요 (아니면 넘기기)";
    if (!this.canPlay(h.face)) return `낼 수 없는 카드예요 (${COLOR_NAME[this.color]} 또는 같은 숫자·기호, 와일드만 가능)`;
    const c = parseUno(h.face)!;
    if (c.value === "D4" && this.hasColor(p, this.color, cardId))
      return `와일드 +4는 ${COLOR_NAME[this.color]} 카드가 손에 없을 때만 낼 수 있어요`;
    if (c.color === "W" && !COLORS.includes(chosen as UnoColor)) return "와일드는 색을 골라 주세요";
    this.closeCatchWindow(p.id);
    p.hand.splice(idx, 1);
    this.stack(this.pileId).cards.push({ face: h.face, back: h.back });
    this.color = c.color === "W" ? (chosen as UnoColor) : c.color;
    this.last = `${p.nickname}: ${cardName(h.face)}${c.color === "W" ? ` → ${COLOR_NAME[this.color]}` : ""}`;
    if (p.hand.length === 1 && !p.uno) this.vulnerable = p.id;
    this.room.sendHand(p);

    if (p.hand.length === 0) {
      this.winner = p.id;
      this.vulnerable = null;
      this.changed();
      this.room.notice(`🎉 ${p.nickname}님이 카드를 모두 내서 승리했어요!`, "win");
      return null;
    }
    const alive = this.order.filter(this.live).length;
    const nextIdx = nextInOrder(this.order, this.turnIdx, this.dir, this.live);
    const next = this.room.players.get(this.order[nextIdx]);
    // 화면 연출용 (규칙 처리와 별개)
    const fx = { by: p.id, target: next?.id ?? null, color: this.color, n: 0, recolor: c.color === "W" };
    let effect: "wild" | "skip" | "reverse" | "draw" | null = c.value === "W" ? "wild" : null;
    switch (c.value) {
      case "S":
        this.advance(true);
        this.last += ` (${next?.nickname} 건너뜀)`;
        effect = "skip";
        break;
      case "V":
        effect = "reverse";
        if (alive <= 2) {
          this.advance(true);
          this.last += ` (${next?.nickname} 건너뜀)`;
        } else {
          this.dir = this.dir === 1 ? -1 : 1;
          this.advance();
          this.last += " (방향 바뀜)";
        }
        break;
      case "D2":
      case "D4": {
        const n = c.value === "D2" ? 2 : 4;
        if (next) this.draw(next, n);
        this.advance(true);
        this.last += ` (${next?.nickname} +${n}장, 건너뜀)`;
        effect = "draw";
        fx.n = n;
        break;
      }
      default:
        this.advance();
    }
    this.changed();
    if (effect) this.room.emitFx({ effect, ...fx, target: effect === "wild" || effect === "reverse" ? (effect === "reverse" && alive <= 2 ? fx.target : null) : fx.target });
    return null;
  }

  drawOne(p: IPlayer): string | null {
    const err = this.turnError(p);
    if (err) return err;
    if (this.drewCard) return "이미 한 장 뽑았어요. 뽑은 카드를 내거나 넘기세요";
    this.closeCatchWindow(p.id);
    const [h] = this.draw(p, 1);
    if (!h) {
      this.last = `${p.nickname}: 뽑을 카드가 없어 넘김`;
      this.advance();
    } else if (this.canPlay(h.face)) {
      this.drewCard = h.id;
      this.last = `${p.nickname}: 1장 뽑음 (낼 수 있어요)`;
    } else {
      this.last = `${p.nickname}: 1장 뽑고 넘김`;
      this.advance();
    }
    this.changed();
    return null;
  }

  pass(p: IPlayer): string | null {
    const err = this.turnError(p);
    if (err) return err;
    if (!this.drewCard) return "먼저 한 장 뽑아야 넘길 수 있어요";
    this.last = `${p.nickname}: 넘김`;
    this.advance();
    this.changed();
    return null;
  }

  callUno(p: IPlayer): string | null {
    if (p.hand.length > 2) return "카드가 2장 이하일 때 외칠 수 있어요";
    const now = Date.now();
    if (p.unoAt && now - p.unoAt < 2000) return null; // 연타 방지
    p.unoAt = now;
    p.uno = true;
    if (this.vulnerable === p.id) this.vulnerable = null;
    this.room.roomChanged();
    this.room.notice(`🔔 ${p.nickname}: 우노!`, "uno");
    return null;
  }

  catchUno(catcher: IPlayer, targetId: string): string | null {
    const t = this.room.players.get(targetId);
    if (!t || t.id === catcher.id) return "잡을 수 없어요";
    if (this.vulnerable !== t.id || t.hand.length !== 1 || t.uno) return "지금은 잡을 수 없어요 (이미 외쳤거나 기회가 지났어요)";
    this.vulnerable = null;
    this.draw(t, 2);
    this.last = `${catcher.nickname}님이 ${t.nickname}님을 잡음 (+2장)`;
    this.changed();
    this.room.notice(`🚨 ${catcher.nickname}님이 잡았어요! ${t.nickname}님은 우노를 안 외쳐서 2장을 받아요`, "warn");
    return null;
  }

  // ------------------------------------------------------------------
  skip(by: IPlayer): string | null {
    if (this.winner) return "게임이 끝났어요";
    const who = this.name(this.current());
    this.advance();
    this.last = `방장이 ${who}님 차례를 넘김`;
    this.changed();
    this.room.notice(`⏭ ${by.nickname}님이 ${who}님 차례를 넘겼어요`, "info");
    return null;
  }

  onLeave(p: IPlayer): void {
    const i = this.order.indexOf(p.id);
    if (i < 0) return;
    // 나간 사람 손패는 덱 맨 아래로
    const deck = this.stack(this.deckId);
    deck.cards.unshift(...p.hand.map((h) => ({ face: h.face, back: h.back })));
    p.hand = [];
    const wasTurn = i === this.turnIdx;
    this.order.splice(i, 1);
    if (this.vulnerable === p.id) this.vulnerable = null;
    if (!this.order.length) return;
    if (i < this.turnIdx) this.turnIdx--;
    if (wasTurn) {
      // 나간 자리 기준으로 다음 사람
      this.turnIdx = this.dir === 1 ? i % this.order.length : (i - 1 + this.order.length) % this.order.length;
      this.drewCard = null;
      if (!this.live(this.order[this.turnIdx])) this.turnIdx = nextInOrder(this.order, this.turnIdx, this.dir, this.live);
    }
    if (this.order.length === 1 && !this.winner) {
      this.winner = this.order[0];
      this.room.notice(`🎉 혼자 남은 ${this.name(this.winner)}님이 승리했어요`, "win");
    }
    this.room.emitUpsert([deck]);
  }

  pub(): PubUno {
    return {
      kind: "uno",
      order: [...this.order],
      turn: this.current(),
      dir: this.dir,
      color: this.color,
      drew: !!this.drewCard,
      vulnerable: this.vulnerable,
      winner: this.winner,
      deckId: this.deckId,
      pileId: this.pileId,
      last: this.last,
    };
  }
}
