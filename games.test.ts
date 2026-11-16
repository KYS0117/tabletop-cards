// 규칙 자동 게임 테스트: 우노 · 바퀴벌레 포커 · 프로포즈 라운드
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProposeGame } from "../src/games/propose";
import { RoachGame, creatureOf } from "../src/games/roach";
import { UnoGame } from "../src/games/uno";
import { applyPreset } from "../src/presets";
import type { IPlayer, Room } from "../src/room";
import { leaks, setup } from "./helpers";

function addPlayers(room: Room, n: number): IPlayer[] {
  const out: IPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const p = room.addPlayer(`P${i}`, `tab-${i}`)!;
    p.connected = true;
    out.push(p);
  }
  return out;
}
const U = (face: string) => ({ face, back: "uno" });

// ---------------------------------------------------------------------
// 우노
// ---------------------------------------------------------------------
function unoSetup(extra = 0) {
  const s = setup();
  const more = addPlayers(s.room, extra);
  assert.equal(applyPreset(s.room, "uno", "A"), null);
  const g = s.room.game as UnoGame;
  assert.ok(g instanceof UnoGame);
  const all = [s.A, s.B, ...more];
  /** 원하는 상황 만들기: 손패, 버린 카드 맨 위, 차례 */
  const arrange = (hands: Record<string, string[]>, top: string, turn: IPlayer, color?: "R" | "Y" | "G" | "B") => {
    for (const p of all) p.hand = (hands[p.nickname] ?? ["U:R-9", "U:Y-9", "U:G-9"]).map((f) => s.room.handCard(U(f)));
    const pile = s.room.objs.get(g.pileId)!;
    if (pile.kind === "stack") pile.cards = [U(top)];
    g.color = color ?? (top[2] as "R");
    g.turnIdx = g.order.indexOf(turn.id);
    g.dir = 1;
    g.drewCard = null;
    g.vulnerable = null;
  };
  const card = (p: IPlayer, face: string) => p.hand.find((h) => h.face === face)!.id;
  return { ...s, g, all, arrange, card };
}

test("우노: 준비 — 게임이 관리하는 덱·버린 카드, 손으로 조작·마음대로 내기 불가", () => {
  const { room, g, A, B } = unoSetup();
  assert.equal(A.hand.length, 7);
  assert.deepEqual(g.order, [A.id, B.id]);
  assert.ok(g.current());
  const deck = room.pubObjects().find((o) => o.id === g.deckId)!;
  assert.equal(deck.system, true);
  assert.deepEqual(room.grab(A.id, [g.deckId]), [], "덱을 잡을 수 없음");
  assert.equal(typeof room.drawToHand(A, g.deckId, 3), "string", "덱에서 마음대로 뽑기 불가");
  assert.equal(typeof room.takeTop(A.id, g.pileId), "string", "버린 카드 가져가기 불가");
  assert.equal(typeof room.handPlay(A, A.hand[0].id, 100, 100, true, false), "string", "손패를 테이블에 마음대로 내기 불가");
  assert.equal(typeof room.newDeck("standard54"), "string");
  assert.equal(room.pubRoom().game?.kind, "uno");
});

test("우노: 차례·낼 수 있는 카드 검사 (같은 색 / 같은 숫자 / 와일드는 색 고르기)", () => {
  const { g, A, B, arrange, card } = unoSetup();
  arrange({ A: ["U:R-3", "U:B-5", "U:G-7", "U:W-W"], B: ["U:R-1", "U:Y-1", "U:G-2"] }, "U:R-5", A);
  assert.match(g.play(B, card(B, "U:R-1"))!, /차례/, "내 차례가 아니면 거부");
  assert.match(g.play(A, card(A, "U:G-7"))!, /낼 수 없는/, "색도 숫자도 다르면 거부");
  assert.equal(g.play(A, card(A, "U:B-5")), null, "같은 숫자는 가능");
  assert.equal(g.color, "B");
  assert.equal(g.current(), B.id);
  assert.match(g.play(B, card(B, "U:R-1"))!, /낼 수 없는/);
  arrange({ A: ["U:R-3", "U:W-W", "U:G-1"], B: ["U:Y-1", "U:G-2", "U:B-3"] }, "U:R-5", A);
  assert.match(g.play(A, card(A, "U:W-W"))!, /색을 골라/);
  assert.equal(g.play(A, card(A, "U:W-W"), "G"), null);
  assert.equal(g.color, "G");
  assert.equal(g.play(B, card(B, "U:G-2")), null, "고른 색으로 낼 수 있음");
});

test("우노: 스킵·리버스·+2·+4 효과 (3명)", () => {
  const { g, A, B, all, arrange, card } = unoSetup(1);
  const C = all[2];
  arrange({ A: ["U:R-S", "U:R-1", "U:R-2"] }, "U:R-5", A);
  g.play(A, card(A, "U:R-S"));
  assert.equal(g.current(), C.id, "스킵: B 건너뛰고 C");
  arrange({ A: ["U:R-V", "U:R-1", "U:R-2"] }, "U:R-5", A);
  g.play(A, card(A, "U:R-V"));
  assert.equal(g.dir, -1);
  assert.equal(g.current(), C.id, "리버스: 반대 방향 다음 사람 (A 앞은 C)");
  arrange({ A: ["U:R-D2", "U:R-1", "U:R-2"] }, "U:R-5", A);
  const before = B.hand.length;
  g.play(A, card(A, "U:R-D2"));
  assert.equal(B.hand.length, before + 2, "+2: 다음 사람 2장");
  assert.equal(g.current(), C.id, "+2 받은 사람은 건너뜀");
  arrange({ A: ["U:W-D4", "U:R-1", "U:G-2"] }, "U:R-5", A);
  assert.match(g.play(A, card(A, "U:W-D4"), "Y")!, /빨강 카드가 손에 없을 때만/, "+4: 지금 색 카드가 있으면 거부 (공식 규칙)");
  arrange({ A: ["U:W-D4", "U:B-1", "U:G-2"] }, "U:R-5", A);
  assert.equal(g.play(A, card(A, "U:W-D4"), "Y"), null, "같은 색이 없으면 가능 (숫자만 같은 카드가 있어도 OK)");
  assert.equal(B.hand.length, 3 + 4);
  assert.equal(g.color, "Y");
  assert.equal(g.current(), C.id);
});

test("우노: 2명일 때 리버스는 스킵처럼 (내 차례가 다시)", () => {
  const { g, A, arrange, card } = unoSetup();
  arrange({ A: ["U:R-V", "U:R-1", "U:R-2"] }, "U:R-5", A);
  g.play(A, card(A, "U:R-V"));
  assert.equal(g.current(), A.id);
});

test("우노: 뽑기 — 낼 수 있으면 그 카드만 내거나 넘기기, 못 내면 자동으로 넘어감", () => {
  const { room, g, A, B, arrange, card } = unoSetup();
  arrange({ A: ["U:G-1", "U:G-2"] }, "U:R-5", A);
  const deck = room.objs.get(g.deckId)!;
  if (deck.kind === "stack") deck.cards.push(U("U:R-7"));
  assert.equal(g.drawOne(A), null);
  assert.equal(A.hand.length, 3);
  assert.equal(g.current(), A.id, "낼 수 있는 카드를 뽑으면 차례 유지");
  assert.match(g.drawOne(A)!, /이미/);
  assert.match(g.play(A, card(A, "U:G-1"))!, /뽑은 카드만/);
  assert.equal(g.pass(A), null);
  assert.equal(g.current(), B.id);
  arrange({ A: ["U:G-1", "U:G-2"] }, "U:R-5", A);
  if (deck.kind === "stack") deck.cards.push(U("U:B-3"));
  g.drawOne(A);
  assert.equal(g.current(), B.id, "못 내는 카드를 뽑으면 자동으로 넘어감");
  assert.match(g.pass(B)!, /먼저 한 장 뽑아야/);
});

test("우노: 1장 남았는데 안 외치면 잡혀서 +2, 외치면 안전, 다음 사람이 움직이면 기회 끝", () => {
  const { g, A, B, arrange, card } = unoSetup(1);
  arrange({ A: ["U:R-1", "U:R-2"] }, "U:R-5", A);
  g.play(A, card(A, "U:R-1"));
  assert.equal(g.vulnerable, A.id);
  assert.match(g.catchUno(A, A.id)!, /잡을 수 없/, "자기 자신은 못 잡음");
  assert.equal(g.catchUno(B, A.id), null);
  assert.equal(A.hand.length, 3);
  assert.equal(g.vulnerable, null);
  // 미리 외치면 안전
  arrange({ A: ["U:R-1", "U:R-2"] }, "U:R-5", A);
  assert.equal(g.callUno(A), null);
  g.play(A, card(A, "U:R-1"));
  assert.equal(g.vulnerable, null);
  assert.match(g.catchUno(B, A.id)!, /잡을 수 없/);
  // 잡기 기회는 다음 사람이 행동하면 끝
  arrange({ A: ["U:R-1", "U:R-2"], B: ["U:R-3", "U:R-4", "U:R-6", "U:R-7"] }, "U:R-5", A);
  A.uno = false;
  g.play(A, card(A, "U:R-1"));
  g.play(B, card(B, "U:R-3"));
  assert.equal(g.vulnerable, null);
  assert.match(g.catchUno(B, A.id)!, /잡을 수 없/);
  // 손패 3장 이상이면 외칠 수 없음
  assert.match(g.callUno(B)!, /2장 이하/);
});

test("우노: 마지막 카드를 내면 승리, 그 뒤로는 못 냄", () => {
  const { room, g, A, B, arrange, card, io } = unoSetup();
  arrange({ A: ["U:R-1"] }, "U:R-5", A);
  io.clear();
  assert.equal(g.play(A, card(A, "U:R-1")), null);
  assert.equal(g.winner, A.id);
  const pg = room.pubRoom().game;
  assert.equal(pg?.kind === "uno" ? pg.winner : null, A.id);
  assert.ok(io.sent.some((m) => m.ev === "notice" && m.data.kind === "win"));
  assert.match(g.drawOne(B)!, /끝났/);
});

test("우노: 덱이 떨어지면 버린 카드를 섞어 다시 사용", () => {
  const { room, g, A, arrange } = unoSetup();
  arrange({ A: ["U:G-1"] }, "U:R-5", A);
  const deck = room.objs.get(g.deckId)!;
  const pile = room.objs.get(g.pileId)!;
  if (deck.kind !== "stack" || pile.kind !== "stack") throw new Error();
  deck.cards = [];
  pile.cards = [U("U:B-1"), U("U:B-2"), U("U:R-5")];
  g.drawOne(A);
  assert.equal(pile.cards.length, 1, "맨 위 카드만 남음");
  assert.equal(deck.cards.length + A.hand.length, 1 + 2);
});

test("우노: 남의 손패 정보는 전송되지 않음, 나간 사람은 순서에서 빠짐", () => {
  const { room, g, A, B, io, all } = unoSetup(1);
  const C = all[2];
  const aFaces = A.hand.map((h) => h.id);
  assert.deepEqual(leaks(io.sentTo(room.code), aFaces), [], "방 전체로 손패 id 미전송");
  assert.deepEqual(leaks(io.sentTo(`p:${B.id}`), aFaces), []);
  g.turnIdx = g.order.indexOf(B.id);
  g.dir = 1;
  room.removePlayer(B, "나갔어요");
  assert.deepEqual(g.order, [A.id, C.id]);
  assert.equal(g.current(), C.id, "나간 사람 차례였으면 다음 사람");
  room.removePlayer(C, "나갔어요");
  assert.equal(g.winner, A.id, "혼자 남으면 승리");
});

test("우노: 방장 차례 넘기기 (연결이 끊긴 사람 때문에 멈췄을 때)", () => {
  const { g, A, B, arrange } = unoSetup();
  arrange({}, "U:R-5", A);
  assert.equal(g.skip(B), null);
  assert.equal(g.current(), B.id);
});

// ---------------------------------------------------------------------
// 바퀴벌레 포커
// ---------------------------------------------------------------------
function roachSetup(extra = 1) {
  const s = setup();
  const more = addPlayers(s.room, extra);
  RoachGame.REVEAL_MS = 60_000; // 테스트에서는 finishReveal 을 직접 호출
  assert.equal(applyPreset(s.room, "cockroach", "A"), null);
  const g = s.room.game as RoachGame;
  assert.ok(g instanceof RoachGame);
  const all = [s.A, s.B, ...more];
  const T = (name: string) => s.room.handCard({ face: `T:${name}`, back: "cockroach" });
  return { ...s, g, all, T };
}

test("바퀴벌레: 카드 이름으로 벌레 구분 (글자 카드·그림 파일 이름)", () => {
  assert.equal(creatureOf("T:🐀 쥐"), "rat");
  assert.equal(creatureOf("T:🪳 바퀴벌레"), "cockroach");
  assert.equal(creatureOf("IMG:cockroach/scorpion.png"), "scorpion");
  assert.equal(creatureOf("IMG:cockroach/Rat-7.jpg"), "rat");
  assert.equal(creatureOf("IMG:cockroach/stinkbug_2.webp"), "stinkbug");
  assert.equal(creatureOf("IMG:cockroach/photo123.png"), null);
});

test("바퀴벌레: 64장을 모두 나눠 갖고, 차례인 사람만 넘길 수 있음", () => {
  const { room, g, A, B, all } = roachSetup();
  assert.equal(all.reduce((n, p) => n + p.hand.length, 0), 64);
  assert.equal(room.pubObjects().length, 0);
  const other = all.find((p) => p.id !== g.active)!;
  const me = room.players.get(g.active)!;
  assert.match(g.give(other, other.hand[0].id, me.id, "rat")!, /차례/);
  assert.match(g.give(me, me.hand[0].id, me.id, "rat")!, /받을 사람/);
  assert.match(g.give(me, me.hand[0].id, other.id, "dragon")!, /벌레/);
  assert.ok(A && B);
});

test("바퀴벌레: 넘긴 카드는 테이블 가운데 뒷면 (정체 미전송), 받은 사람만 대답", () => {
  const { room, g, A, B, all, T, io } = roachSetup();
  g.active = A.id;
  A.hand = [T("🐀 쥐"), T("🦇 박쥐")];
  io.clear();
  assert.equal(g.give(A, A.hand[0].id, B.id, "bat"), null, "쥐를 박쥐라고 거짓말");
  const obj = room.pubObjects().find((o) => o.id === g.cardObjId)!;
  assert.ok(obj && obj.kind === "card" && obj.faceUp === false && obj.face === null && obj.system);
  assert.deepEqual(leaks(io.sentTo(room.code), ["T:🐀 쥐"]), []);
  const C = all[2];
  assert.match(g.answer(C, "yes")!, /대답할 수 없/);
  assert.equal(g.pub().phase, "respond");
  assert.deepEqual(g.pub().chain, [{ from: A.id, to: B.id, creature: "bat" }]);
});

test("바퀴벌레: 거짓말을 맞히면 넘긴 사람이, 틀리면 받은 사람이 벌칙 카드", () => {
  const { room, g, A, B, T } = roachSetup();
  g.active = A.id;
  A.hand = [T("🐀 쥐"), T("🐀 쥐"), T("🦇 박쥐")];
  // 1) 쥐를 박쥐라고 함 → B "거짓말!" → 맞힘 → A가 벌칙
  g.give(A, A.hand[0].id, B.id, "bat");
  assert.equal(g.answer(B, "no"), null);
  assert.equal(g.pub().phase, "reveal");
  assert.equal(g.pub().reveal?.taker, A.id);
  const shown = room.pubObjects().find((o) => o.id === g.cardObjId)!;
  assert.ok(shown.kind === "card" && shown.faceUp && shown.face === "T:🐀 쥐", "공개되면 앞면");
  g.finishReveal();
  assert.equal(g.penalties[A.id].rat, 1);
  assert.equal(g.active, A.id, "벌칙 받은 사람이 다음 차례");
  assert.equal(room.pubObjects().length, 0, "카드는 테이블에서 치워짐");
  // 2) 쥐를 쥐라고 함 → B "거짓말!" → 틀림 → B가 벌칙
  g.give(A, A.hand[0].id, B.id, "rat");
  g.answer(B, "no");
  g.finishReveal();
  assert.equal(g.penalties[B.id].rat, 1);
  assert.equal(g.active, B.id);
});

test("바퀴벌레: 몰래 보고 안 본 사람에게 넘기기, 몰래 본 정체는 본인에게만", () => {
  const { room, g, A, B, all, T, io } = roachSetup();
  const C = all[2];
  g.active = A.id;
  A.hand = [T("🦂 전갈"), T("🦇 박쥐")];
  g.give(A, A.hand[0].id, B.id, "spider");
  assert.match(g.pass(B, C.id, "fly")!, /먼저 몰래/);
  io.clear();
  assert.equal(g.peek(B), null);
  assert.equal(io.sentTo(`p:${B.id}`).filter((m) => m.ev === "peek")[0]?.data.face, "T:🦂 전갈");
  assert.deepEqual(leaks(io.sentTo(room.code), ["T:🦂 전갈"]), []);
  assert.deepEqual(leaks(io.sentTo(`p:${C.id}`), ["T:🦂 전갈"]), []);
  assert.equal(g.pub().peekedBy, B.id);
  assert.match(g.pass(B, A.id, "fly")!, /안 본 사람/, "이미 본 사람에게는 못 넘김");
  assert.equal(g.pass(B, C.id, "scorpion"), null);
  assert.equal(g.pub().chain.length, 2);
  // C 차례: 모두 이미 봤으므로 넘길 수 없고 대답해야 함
  assert.match(g.peek(C)!, /모두/);
  g.answer(C, "yes"); // 진짜(전갈) → 맞힘 → 마지막으로 넘긴 B가 벌칙
  g.finishReveal();
  assert.equal(g.penalties[B.id].scorpion, 1);
});

test("바퀴벌레: 같은 벌레 4장이면 패배, 차례에 손패가 없어도 패배", () => {
  const { g, A, B, T, io } = roachSetup();
  g.active = A.id;
  g.penalties[A.id] = { rat: 3 };
  A.hand = [T("🐀 쥐"), T("🦇 박쥐")];
  g.give(A, A.hand[0].id, B.id, "bat");
  g.answer(B, "no");
  io.clear();
  g.finishReveal();
  assert.equal(g.loser, A.id);
  assert.equal(g.pub().phase, "over");
  assert.ok(io.sent.some((m) => m.ev === "notice" && m.data.kind === "lose"));
  // 손패 없음
  const s2 = roachSetup();
  s2.g.active = s2.A.id;
  s2.A.hand = [s2.T("🐀 쥐")];
  s2.g.give(s2.A, s2.A.hand[0].id, s2.B.id, "rat");
  s2.g.answer(s2.B, "no"); // 진짜였는데 거짓말이라 함 → B 벌칙, B 차례
  s2.B.hand = [];
  s2.g.finishReveal();
  assert.equal(s2.g.loser, s2.B.id);
});

test("바퀴벌레: 방장이 진행 되돌리기 → 카드는 처음 넘긴 사람에게", () => {
  const { g, A, B, T } = roachSetup();
  g.active = A.id;
  A.hand = [T("🐀 쥐"), T("🦇 박쥐")];
  g.give(A, A.hand[0].id, B.id, "rat");
  assert.equal(A.hand.length, 1);
  assert.equal(g.skip(B), null);
  assert.equal(A.hand.length, 2);
  assert.equal(g.pub().phase, "give");
  assert.equal(g.active, A.id);
});

// ---------------------------------------------------------------------
// 프로포즈 라운드
// ---------------------------------------------------------------------
function proposeSetup(extra = 1) {
  const s = setup();
  const more = addPlayers(s.room, extra);
  assert.equal(applyPreset(s.room, "propose", "A"), null);
  const g = s.room.game as ProposeGame;
  assert.ok(g instanceof ProposeGame);
  return { ...s, g, all: [s.A, s.B, ...more] };
}

test("프로포즈: 받는 사람만, 한 라운드에 반지 1개, 자기 자신 제외", () => {
  const { g, A, B, all } = proposeSetup();
  const C = all[2];
  g.receiver = A.id;
  assert.match(g.giveRing(B, C.id)!, /받는/, "받는 사람이 아니면 못 줌");
  assert.match(g.giveRing(A, A.id)!, /골라/);
  assert.equal(g.giveRing(A, B.id), null);
  assert.equal(B.score, 1);
  assert.match(g.giveRing(A, C.id)!, /이미/);
  assert.equal(C.score, 0);
});

test("프로포즈: 다음 라운드 — 테이블 정리, 기본 카드 회수, 단어 카드 6장 보충, 받는 사람 교대", () => {
  const { room, g, A, B, all } = proposeSetup();
  const C = all[2];
  g.receiver = A.id;
  // B가 기본 카드 2장 + 단어 카드 2장을 테이블에 냄
  const base = B.hand.filter((h) => g.baseFaces.has(h.face)).slice(0, 2);
  const words = B.hand.filter((h) => !g.baseFaces.has(h.face)).slice(0, 2);
  for (const h of [...base, ...words]) room.handPlay(B, h.id, 500, 500, true, false);
  assert.equal(B.hand.length, 8);
  assert.match(g.next(B)!, /받는 사람이나 방장/);
  room.hostId = C.id;
  assert.match(g.next(A)!, /먼저/, "받는 사람은 반지를 준 뒤에");
  g.giveRing(A, B.id);
  assert.equal(g.next(A), null);
  assert.equal(room.pubObjects().length, 1, "덱만 남음");
  for (const p of all) {
    assert.equal(p.hand.filter((h) => g.baseFaces.has(h.face)).length, 6, "기본 카드 6장");
    assert.equal(p.hand.filter((h) => !g.baseFaces.has(h.face)).length, 6, "단어 카드 6장");
  }
  assert.equal(g.receiver, B.id, "다음 사람이 받는 사람");
  assert.equal(g.round, 2);
  assert.equal(g.given, null);
  assert.equal(g.discard.length, 2, "낸 단어 카드는 버린 카드로");
  // 방장은 반지 없이도 넘길 수 있음
  assert.equal(g.next(C), null);
  assert.equal(g.receiver, C.id);
});

test("프로포즈: 반지 3개면 승리 알림, 게임 중 들어온 사람도 카드 받음, 받는 사람 바꾸기는 방장만", () => {
  const { room, g, A, B, io } = proposeSetup(0);
  for (let r = 0; r < 3; r++) {
    g.receiver = A.id;
    g.given = null;
    io.clear();
    g.giveRing(A, B.id);
  }
  assert.equal(B.score, 3);
  assert.ok(io.sent.some((m) => m.ev === "notice" && m.data.kind === "win"));
  const [D] = addPlayers(room, 1);
  g.onJoin(D);
  assert.equal(D.hand.length, 12);
  room.hostId = A.id;
  assert.match(g.setReceiver(B, D.id)!, /방장/);
  assert.equal(g.setReceiver(A, D.id), null);
  assert.equal(g.receiver, D.id);
});

test("프로포즈: 직접 쓴 카드는 게임 덱에 섞임", () => {
  const { room, g, A } = proposeSetup(0);
  const deck = room.objs.get(g.deckId)!;
  const n = deck.kind === "stack" ? deck.cards.length : 0;
  assert.deepEqual(room.customCreate(A, ["너의 미소"], "deck"), { count: 1 });
  assert.equal(deck.kind === "stack" && deck.cards.length, n + 1);
});

test("우노: 특수 카드를 내면 모두에게 연출 이벤트 (색 바꾸기·건너뛰기·방향·공격)", () => {
  const { g, A, B, all, io, room, arrange, card } = unoSetup(1);
  const C = all[2];
  const fx = () => io.sentTo(room.code).filter((m) => m.ev === "fx:uno").map((m) => m.data);
  arrange({ A: ["U:R-S", "U:R-1", "U:R-2"] }, "U:R-5", A);
  io.clear();
  g.play(A, card(A, "U:R-S"));
  assert.deepEqual(fx().map((d) => [d.effect, d.target]), [["skip", B.id]]);
  arrange({ A: ["U:R-V", "U:R-1", "U:R-2"] }, "U:R-5", A);
  io.clear();
  g.play(A, card(A, "U:R-V"));
  assert.deepEqual(fx().map((d) => d.effect), ["reverse"]);
  arrange({ A: ["U:W-W", "U:R-1", "U:R-2"] }, "U:R-5", A);
  io.clear();
  g.play(A, card(A, "U:W-W"), "B");
  assert.deepEqual(fx().map((d) => [d.effect, d.color]), [["wild", "B"]]);
  arrange({ A: ["U:W-D4", "U:B-1", "U:G-2"] }, "U:R-5", A);
  io.clear();
  g.play(A, card(A, "U:W-D4"), "G");
  assert.deepEqual(fx().map((d) => [d.effect, d.target, d.n, d.color, d.recolor]), [["draw", B.id, 4, "G", true]]);
  arrange({ A: ["U:R-3", "U:R-1", "U:R-2"] }, "U:R-5", A);
  io.clear();
  g.play(A, card(A, "U:R-3"));
  assert.equal(fx().length, 0, "숫자 카드는 연출 없음");
  void C;
});
