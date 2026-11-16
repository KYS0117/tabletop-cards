// =====================================================================
// 바퀴벌레 포커 — 규칙 자동
//  - 벌레 8종 × 8장 = 64장을 모두 나눠 가짐
//  - 차례인 사람(active)이 손패 1장을 뒷면으로 골라 다른 사람에게 넘기며 "이건 ○○야!" 선언
//  - 받은 사람은 ① "진짜!" / "거짓말!"로 대답하거나 ② 몰래 보고 아직 이 카드를 안 본 사람에게 다시 넘김(새 선언)
//    → 이 카드를 모두가 이미 봤으면 넘길 수 없고 대답해야 함
//  - 대답이 맞으면 마지막으로 넘긴 사람이, 틀리면 받은 사람이 그 카드를 자기 앞에 앞면으로 둠 (벌칙 카드)
//    → 벌칙 카드를 받은 사람이 다음 차례
//  - 같은 벌레 벌칙 카드가 4장이 되면 패배. 자기 차례에 손패가 없어도 패배
// =====================================================================
import { CREATURES, TABLE_H, TABLE_W, type CreatureId, type PubRoach, type RoachClaim } from "../../../shared/protocol";
import { loadImageDeck } from "../decks";
import type { IPlayer, IStackCard, Room } from "../room";
import { randomIndex, shuffleInPlace } from "../util";
import { nextInOrder, type GameEngine } from "./types";

export const ROACH_LOSE_COUNT = 4;

/** 카드 앞면 → 벌레 종류. 글자 카드("🐀 쥐")는 이름으로, 그림 카드는 파일 이름(rat.png, rat-3.png)으로 판단 */
export function creatureOf(face: string): CreatureId | null {
  if (face.startsWith("T:")) {
    const t = face.slice(2).trim();
    const c = CREATURES.find((x) => t === x.name || t.endsWith(` ${x.name}`) || t === x.id);
    return c ? c.id : null;
  }
  if (face.startsWith("IMG:")) {
    const file = face.split("/").pop() ?? "";
    const stem = file
      .replace(/\.[a-z]+$/i, "")
      .toLowerCase()
      .replace(/[-_ ]?\d+$/, "");
    const c = CREATURES.find((x) => x.id === stem);
    return c ? c.id : null;
  }
  return null;
}
const cr = (id: CreatureId) => CREATURES.find((c) => c.id === id)!;

export class RoachGame implements GameEngine {
  readonly kind = "roach" as const;
  readonly blocksFreePlay = true;
  static REVEAL_MS = 2200;
  order: string[] = [];
  active = "";
  phase: PubRoach["phase"] = "give";
  chain: RoachClaim[] = [];
  card: IStackCard | null = null;
  cardObjId: string | null = null;
  /** 지금 오가는 카드를 몰래 본 받은 사람 (이 사람만 넘길 수 있음) */
  peekedBy: string | null = null;
  penalties: Record<string, Partial<Record<CreatureId, number>>> = {};
  loser: string | null = null;
  loseReason = "";
  reveal: PubRoach["reveal"] = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private room: Room) {}

  static start(room: Room): RoachGame | string {
    const players = room.connectedPlayers();
    if (players.length < 2) return "바퀴벌레 포커는 2명 이상 접속해 있어야 시작할 수 있어요";
    const d = loadImageDeck("cockroach");
    if (typeof d === "string") return d;
    const bad = d.cards.filter((f) => !creatureOf(f));
    if (bad.length)
      return `벌레 종류를 알 수 없는 카드 그림이 있어요 (${bad[0].split("/").pop()}). 파일 이름을 cockroach, rat, bat, fly, toad, scorpion, spider, stinkbug 로 시작하게 해 주세요`;
    room.clearTable();
    room.preset = "cockroach";
    room.score = null;
    const g = new RoachGame(room);
    const cards: IStackCard[] = d.cards.map((face) => ({ face, back: d.back, shape: d.shape }));
    shuffleInPlace(cards);
    g.order = players.map((p) => p.id);
    let i = 0;
    for (const c of cards) players[i++ % players.length].hand.push(room.handCard(c));
    for (const pl of players) {
      g.penalties[pl.id] = {};
      room.sendHand(pl);
    }
    g.active = g.order[randomIndex(g.order.length)];
    room.game = g;
    room.timerSet(30);
    if (d.placeholder) room.notice("아직 카드 그림이 없어서 임시 글자 카드로 준비했어요 (decks/cockroach 폴더에 그림을 넣으면 바뀌어요)", "warn");
    return g;
  }

  // ------------------------------------------------------------------
  private name(id: string | null | undefined) {
    return (id && this.room.players.get(id)?.nickname) || "?";
  }
  private live = (id: string) => !!this.room.players.get(id)?.connected;
  get holder(): string | null {
    return this.phase === "respond" ? (this.chain[this.chain.length - 1]?.to ?? null) : null;
  }
  /** 지금 카드를 이미 본(넘긴) 사람들 */
  seen(): Set<string> {
    const s = new Set<string>();
    for (const c of this.chain) {
      s.add(c.from);
      s.add(c.to);
    }
    return s;
  }
  /** 받은 사람이 넘길 수 있는 대상 (아직 이 카드를 안 본, 접속 중인 사람) */
  passTargets(): string[] {
    const seen = this.seen();
    return this.order.filter((id) => !seen.has(id) && this.live(id));
  }
  private validCreature(c: unknown): c is CreatureId {
    return CREATURES.some((x) => x.id === c);
  }
  private claimText(c: RoachClaim) {
    const x = cr(c.creature);
    return `📣 ${this.name(c.from)} → ${this.name(c.to)}: "이건 ${x.icon} ${x.name}야!"`;
  }

  // ------------------------------------------------------------------
  give(p: IPlayer, cardId: string, to: string, creature: unknown): string | null {
    if (this.phase !== "give") return this.phase === "over" ? "게임이 끝났어요" : "지금은 카드를 넘길 수 없어요";
    if (p.id !== this.active) return `지금은 ${this.name(this.active)}님 차례예요`;
    const idx = p.hand.findIndex((h) => h.id === cardId);
    if (idx < 0) return "손패에 없는 카드예요";
    if (to === p.id || !this.order.includes(to) || !this.live(to)) return "받을 사람을 골라 주세요";
    if (!this.validCreature(creature)) return "벌레를 골라 주세요";
    const [h] = p.hand.splice(idx, 1);
    this.card = { face: h.face, back: h.back, shape: h.shape };
    const obj = this.room.addSystemCard(h.face, h.back, TABLE_W / 2, TABLE_H / 2, h.shape ?? "P");
    this.cardObjId = obj.id;
    this.chain = [{ from: p.id, to, creature }];
    this.peekedBy = null;
    this.phase = "respond";
    this.room.sendHand(p);
    this.room.roomChanged();
    this.room.notice(this.claimText(this.chain[0]), "claim");
    return null;
  }

  peek(p: IPlayer): string | null {
    if (this.phase !== "respond" || p.id !== this.holder || !this.card) return "지금은 몰래 볼 수 없어요";
    if (!this.passTargets().length) return "모두 이 카드를 이미 봤어요. 진짜/거짓말로 대답해야 해요";
    const first = this.peekedBy !== p.id;
    this.peekedBy = p.id;
    this.room.roomChanged(); // 먼저 "몰래 봄" 상태를 알리고 → 정체는 본인에게만
    this.room.sendTo(p.id, "peek", { id: this.cardObjId ?? "", face: this.card.face, back: this.card.back, shape: this.card.shape === "L" ? "L" : undefined });
    if (first) this.room.notice(`👁 ${p.nickname}님이 카드를 몰래 봤어요 (다른 사람에게 넘길 거예요)`, "peek");
    return null;
  }

  pass(p: IPlayer, to: string, creature: unknown): string | null {
    if (this.phase !== "respond" || p.id !== this.holder) return "지금은 넘길 수 없어요";
    if (this.peekedBy !== p.id) return "넘기기 전에 먼저 몰래 봐야 해요";
    if (!this.passTargets().includes(to)) return "이 카드를 아직 안 본 사람에게만 넘길 수 있어요";
    if (!this.validCreature(creature)) return "벌레를 골라 주세요";
    const c: RoachClaim = { from: p.id, to, creature };
    this.chain.push(c);
    this.peekedBy = null;
    this.room.roomChanged();
    this.room.notice(this.claimText(c), "claim");
    return null;
  }

  answer(p: IPlayer, said: unknown): string | null {
    if (this.phase !== "respond" || p.id !== this.holder || !this.card) return "지금은 대답할 수 없어요";
    if (said !== "yes" && said !== "no") return "잘못된 대답이에요";
    const last = this.chain[this.chain.length - 1];
    const real = creatureOf(this.card.face)!;
    const truth = real === last.creature;
    const correct = (said === "yes") === truth;
    const taker = correct ? last.from : p.id;
    this.reveal = { face: this.card.face, creature: real, said, truth, taker };
    this.phase = "reveal";
    // 테이블 카드를 앞면으로 → 모두의 화면에서 뒤집히는 애니메이션
    const obj = this.cardObjId ? this.room.objs.get(this.cardObjId) : undefined;
    if (obj && obj.kind === "card") {
      obj.faceUp = true;
      this.room.emitUpsert([obj]);
    }
    const x = cr(real);
    this.room.roomChanged();
    this.room.notice(
      `${p.nickname}: ${said === "yes" ? "🙆 진짜!" : "🙅 거짓말!"} → 정답은 ${x.icon} ${x.name}! ${correct ? "맞혔어요" : "틀렸어요"} — ${this.name(taker)}님이 벌칙 카드를 받아요`,
      "claim",
    );
    this.timer = setTimeout(() => this.finishReveal(), RoachGame.REVEAL_MS);
    return null;
  }

  /** 공개 후 정리: 벌칙 카드 → 패배 확인 → 다음 차례 */
  finishReveal(): void {
    if (this.phase !== "reveal" || !this.reveal) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const { taker, creature } = this.reveal;
    const pen = (this.penalties[taker] ??= {});
    pen[creature] = (pen[creature] ?? 0) + 1;
    if (this.cardObjId) {
      this.room.objs.delete(this.cardObjId);
      this.room.emitRemove([this.cardObjId]);
    }
    this.cardObjId = null;
    this.card = null;
    this.chain = [];
    this.reveal = null;
    if ((pen[creature] ?? 0) >= ROACH_LOSE_COUNT) {
      this.lose(taker, `${cr(creature).icon} ${cr(creature).name} 벌칙 카드 ${ROACH_LOSE_COUNT}장`);
      return;
    }
    this.active = taker;
    this.phase = "give";
    this.checkEmptyHand();
    this.room.roomChanged();
  }

  private checkEmptyHand() {
    const a = this.room.players.get(this.active);
    if (this.phase === "give" && a && a.hand.length === 0) this.lose(a.id, "자기 차례에 손패가 없음");
  }

  private lose(id: string, reason: string) {
    this.loser = id;
    this.loseReason = reason;
    this.phase = "over";
    this.room.roomChanged();
    this.room.notice(`😱 ${this.name(id)}님 패배! (${reason})`, "lose");
  }

  /** 오가던 카드를 처음 넘긴 사람에게 돌려주고 그 사람 차례로 */
  private cancelTransit(reason: string) {
    const first = this.chain[0];
    if (this.card && first) {
      const p = this.room.players.get(first.from);
      if (p) {
        p.hand.push(this.room.handCard(this.card));
        this.room.sendHand(p);
      }
    }
    if (this.cardObjId) {
      this.room.objs.delete(this.cardObjId);
      this.room.emitRemove([this.cardObjId]);
    }
    if (first && this.order.includes(first.from)) this.active = first.from;
    this.card = null;
    this.cardObjId = null;
    this.chain = [];
    this.peekedBy = null;
    this.phase = "give";
    this.room.notice(`↩ ${reason} 카드를 처음 넘긴 사람에게 돌려줬어요`, "info");
  }

  skip(by: IPlayer): string | null {
    if (this.phase === "over") return "게임이 끝났어요";
    if (this.phase === "reveal") {
      this.finishReveal();
      return null;
    }
    if (this.phase === "respond") this.cancelTransit(`${by.nickname}님(방장)이 진행을 되돌려서`);
    else {
      const i = this.order.indexOf(this.active);
      this.active = this.order[nextInOrder(this.order, i, 1, this.live)];
      this.room.notice(`⏭ ${by.nickname}님(방장)이 차례를 ${this.name(this.active)}님에게 넘겼어요`, "info");
    }
    this.room.roomChanged();
    return null;
  }

  onLeave(p: IPlayer): void {
    const i = this.order.indexOf(p.id);
    if (i < 0) return;
    p.hand = [];
    if (this.phase === "respond" && this.seen().has(p.id)) {
      if (this.chain[0]?.from === p.id) {
        // 처음 넘긴 사람이 나감 → 카드는 버림
        if (this.cardObjId) {
          this.room.objs.delete(this.cardObjId);
          this.room.emitRemove([this.cardObjId]);
        }
        this.card = null;
        this.cardObjId = null;
        this.chain = [];
        this.phase = "give";
      } else this.cancelTransit(`${p.nickname}님이 나가서`);
    }
    if (this.phase === "reveal" && this.reveal?.taker === p.id) {
      // 벌칙 카드를 받을 사람이 나감 → 카드는 버리고 다음 사람 차례
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.cardObjId) {
        this.room.objs.delete(this.cardObjId);
        this.room.emitRemove([this.cardObjId]);
      }
      this.card = null;
      this.cardObjId = null;
      this.chain = [];
      this.reveal = null;
      this.phase = "give";
      this.active = p.id;
    }
    if (this.active === p.id) this.active = this.order[nextInOrder(this.order, i, 1, (id) => id !== p.id && this.live(id))];
    this.order.splice(i, 1);
    if (this.order.length < 2 && this.phase !== "over") {
      this.phase = "over";
      this.loser = null;
      this.loseReason = "사람이 부족해서 끝났어요";
    }
  }

  onJoin(): void {
    /* 진행 중에 들어온 사람은 구경 (다음 판부터 참여) */
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  pub(): PubRoach {
    return {
      kind: "roach",
      phase: this.phase,
      active: this.active,
      chain: this.chain.map((c) => ({ ...c })),
      cardId: this.cardObjId,
      order: [...this.order],
      penalties: JSON.parse(JSON.stringify(this.penalties)),
      loser: this.loser,
      loseReason: this.loseReason,
      reveal: this.reveal ? { ...this.reveal } : null,
      peekedBy: this.peekedBy,
    };
  }
}
