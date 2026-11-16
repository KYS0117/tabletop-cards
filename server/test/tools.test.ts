// 게임 준비(프리셋), 커스텀 카드, 반지 점수, 타이머, 버림 더미 테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PLAYERS } from "../../shared/protocol";
import { applyPreset } from "../src/presets";
import { leaks, setup } from "./helpers";

const stacks = (room: ReturnType<typeof setup>["room"]) => room.pubObjects().filter((o) => o.kind === "stack");

test("프로포즈 게임 준비: 가로형 덱 하나 + 기본 6장·덱 6장씩 + 반지 3개 점수판 (사용한 카드 자리 없음)", () => {
  const { room, A, B } = setup();
  assert.equal(applyPreset(room, "propose", "A"), null);
  assert.equal(room.preset, "propose");
  assert.deepEqual(room.score, { label: "반지", icon: "💍", goal: 3 });
  const s = stacks(room);
  assert.equal(s.length, 1);
  const main = s[0];
  assert.ok(main.kind === "stack" && !main.keep);
  assert.equal(main.shape, "L");
  for (const p of [A, B]) {
    assert.equal(p.hand.length, 12);
    assert.ok(p.hand.every((h) => h.shape === "L"));
  }
  assert.equal(room.timer.durationMs, 60_000);
});

test(`${MAX_PLAYERS}명 꽉 찬 방에서도 프로포즈·우노 준비 (모두 같은 장수)`, () => {
  const { room, A, B } = setup();
  const all = [A, B];
  for (let i = 2; i < MAX_PLAYERS; i++) {
    const p = room.addPlayer(`P${i}`, `tok-${i}`);
    assert.ok(p);
    p.connected = true;
    all.push(p);
  }
  assert.equal(all.length, 10);
  assert.equal(applyPreset(room, "propose", "A"), null);
  for (const p of all) assert.equal(p.hand.length, 12);
  assert.equal(applyPreset(room, "uno", "A"), null);
  for (const p of all) assert.equal(p.hand.length, 7);
  const deck = stacks(room).find((o) => o.kind === "stack" && !o.keep);
  assert.equal(deck?.count, 108 - 70 - 1);
});

test("우노 방식 준비: 7장씩 + 버린 카드 자리에 첫 카드 공개", () => {
  const { room, A, B } = setup();
  assert.equal(applyPreset(room, "uno", "A"), null);
  assert.equal(A.hand.length, 7);
  assert.equal(B.hand.length, 7);
  const pile = stacks(room).find((o) => o.kind === "stack" && o.keep);
  assert.ok(pile && pile.kind === "stack");
  assert.equal(pile.count, 1);
  assert.equal(pile.faceUp, true);
  assert.match(pile.top ?? "", /^U:/);
  const deck = stacks(room).find((o) => o.kind === "stack" && !o.keep);
  assert.equal(deck?.count, 108 - 14 - 1);
  assert.equal(room.score, null);
});

test("게임 준비 시 이전 손패와 점수는 비워짐, 알 수 없는 게임은 거부", () => {
  const { room, A } = setup();
  applyPreset(room, "propose", "A");
  A.score = 2;
  applyPreset(room, "free", "A");
  assert.equal(A.hand.length, 0);
  assert.equal(A.score, 0);
  assert.equal(room.pubObjects().length, 1);
  assert.equal(typeof applyPreset(room, "hack", "A"), "string");
});

test("버림 더미(keep): 비어도 사라지지 않고, 카드를 놓으면 앞면으로 쌓임", () => {
  const { room, A } = setup();
  applyPreset(room, "uno", "A");
  const pile = stacks(room).find((o) => o.kind === "stack" && o.keep)!;
  const h = A.hand[0];
  const card = room.handPlay(A, h.id, pile.x + 5, pile.y + 5, true, true);
  assert.ok(typeof card !== "string");
  room.release(A.id, [{ id: card.id, x: pile.x + 5, y: pile.y + 5 }], pile.id);
  const after = stacks(room).find((o) => o.id === pile.id);
  assert.ok(after && after.kind === "stack");
  assert.equal(after.count, 2);
  assert.equal(after.top, h.face);
  // 전부 가져가도 자리는 남음
  room.drawToHand(A, pile.id, 2);
  const empty = stacks(room).find((o) => o.id === pile.id);
  assert.ok(empty && empty.kind === "stack" && empty.count === 0);
});

test("커스텀 카드: 덱과 같은 뒷면·모양으로 섞이고, 다른 사람에게 내용이 전송되지 않음", () => {
  const { room, A, io } = setup();
  applyPreset(room, "propose", "A");
  const main = stacks(room).find((o) => o.kind === "stack" && !o.keep)!;
  io.clear();
  const r = room.customCreate(A, ["바다가 보이는 옥상에서", "  ", "비밀 문장 ABC"], "deck");
  assert.deepEqual(r, { count: 2 });
  const after = stacks(room).find((o) => o.id === main.id)!;
  assert.equal(after.count, main.count + 2);
  assert.equal(after.back, main.back);
  assert.deepEqual(leaks(io.sentTo("TEST01"), ["T:비밀 문장 ABC", "T:바다가 보이는 옥상에서"]), []);
  assert.doesNotMatch(JSON.stringify(io.sentTo("TEST01")), /비밀 문장/);
});

test("커스텀 카드: 내 손패로, 글자 수·줄 수 제한, 빈 입력 거부", () => {
  const { room, A } = setup();
  const r = room.customCreate(A, ["가".repeat(50), ...Array.from({ length: 30 }, (_, i) => `줄${i}`)], "hand");
  assert.ok(typeof r !== "string");
  assert.equal(r.count, 20);
  assert.equal(A.hand[0].face.length, 2 + 30);
  assert.equal(typeof room.customCreate(A, ["", " "], "deck"), "string");
  assert.equal(typeof room.customCreate(A, "문자열", "deck"), "string");
});

test("반지: 누구나 주고 빼기, 3개면 승리 알림, 점수판 없는 게임에서는 거부", () => {
  const { room, A, B, io } = setup();
  assert.equal(typeof room.scoreAdd(A, B.id, 1), "string");
  applyPreset(room, "propose", "A");
  io.clear();
  room.scoreAdd(A, B.id, 1);
  room.scoreAdd(A, B.id, 1);
  room.scoreAdd(B, B.id, 1);
  assert.equal(B.score, 3);
  assert.ok(io.sent.some((s) => s.ev === "notice" && s.data.kind === "win"));
  room.scoreAdd(A, B.id, -1);
  assert.equal(B.score, 2);
  assert.equal(typeof room.scoreAdd(A, B.id, 5), "string");
  room.scoreAdd(A, A.id, -1);
  assert.equal(A.score, 0, "0 아래로 내려가지 않음");
});

test("타이머: 서버 시각 기준 시작·일시정지·끝·초기화", async () => {
  const { room } = setup();
  assert.equal(typeof room.timerSet(0), "string");
  assert.equal(room.timerSet(300), null, "5분까지 가능");
  assert.equal(typeof room.timerSet(301), "string", "5분 넘으면 거부");
  assert.equal(room.timerSet(1), null);
  room.timerStart();
  assert.equal(room.timer.running, true);
  assert.ok(room.timer.endsAt! - Date.now() <= 1000);
  await new Promise((r) => setTimeout(r, 200));
  room.timerPause();
  assert.equal(room.timer.running, false);
  assert.ok(room.timer.remainingMs < 1000 && room.timer.remainingMs > 500);
  room.timerStart();
  await new Promise((r) => setTimeout(r, 900));
  const pub = room.pubRoom();
  assert.equal(pub.timer.running, false, "시간이 지나면 끝난 상태");
  assert.equal(pub.timer.remainingMs, 0);
  assert.ok(Math.abs(pub.serverNow - Date.now()) < 50);
  room.timerReset();
  assert.equal(room.timer.remainingMs, 1000);
});

test("배경음악: 정해진 곡만", () => {
  const { room } = setup();
  assert.equal(room.setBgm("party"), null);
  assert.equal(room.pubRoom().bgm.track, "party");
  assert.equal(typeof room.setBgm("http://evil"), "string");
  assert.equal(room.setBgm(null), null);
});

test("🔒 잠금: 잡기·뒤집기·회전·삭제·손패로 가져오기 불가, 잠긴 더미에서 뽑기·섞기는 가능", () => {
  const { room, A, B } = setup();
  room.settings.allowEveryoneDelete = true;
  const deck = stacks(room)[0];
  assert.equal(room.setPinned(A.id, [deck.id], true), null);
  assert.equal(stacks(room)[0].pinned, true);
  assert.deepEqual(room.grab(B.id, [deck.id]), [], "잠긴 더미는 잡을 수 없음");
  assert.equal(typeof room.flip(B.id, [deck.id]), "string");
  assert.equal(typeof room.rotate(B.id, [deck.id], 15), "string");
  assert.equal(typeof room.remove(B.id, [deck.id]), "string");
  assert.equal(typeof room.handTake(B, [deck.id]), "string");
  assert.equal(typeof room.spread(B.id, deck.id), "string");
  const before = room.pubObjects().find((o) => o.id === deck.id)!;
  room.release(B.id, [{ id: deck.id, x: 10, y: 10 }], null);
  const after = room.pubObjects().find((o) => o.id === deck.id)!;
  assert.equal(after.x, before.x, "강제로 옮기기 요청도 무시");
  // 잠긴 더미에서 카드 뽑기·섞기는 가능
  const c = room.takeTop(B.id, deck.id);
  assert.ok(typeof c !== "string");
  assert.equal(room.shuffle(B.id, deck.id), null);
  assert.equal(room.drawToHand(B, deck.id, 2), null);
  // 풀기: 잠근 사람이 아니면 거부, 방장(A)은 가능
  room.hostId = "someone-else";
  assert.equal(typeof room.setPinned(B.id, [deck.id], false), "string");
  room.hostId = A.id;
  assert.equal(room.setPinned(A.id, [deck.id], false), null);
  assert.ok(!room.pubObjects().find((o) => o.id === deck.id)!.pinned);
  assert.ok(room.grab(B.id, [deck.id]).includes(deck.id));
});

test("🔒 잠긴 더미는 카드를 다 뽑아도 빈 자리로 남고, 모으기에서 제외", () => {
  const { room, A } = setup();
  const deck = stacks(room)[0];
  room.setPinned(A.id, [deck.id], true);
  room.drawToHand(A, deck.id, 54);
  const d = room.pubObjects().find((o) => o.id === deck.id);
  assert.ok(d && d.kind === "stack" && d.count === 0);
  const h = A.hand[0];
  room.handPlay(A, h.id, 300, 300, true, false);
  room.gather();
  assert.ok(room.pubObjects().some((o) => o.id === deck.id), "잠긴 더미는 그대로");
});

test("👁 몰래 보기: 정체는 본인 채널로만, 모두에게는 '봤다' 알림만", () => {
  const { room, io, A, B } = setup();
  const deck = stacks(room)[0];
  const c = room.takeTop(A.id, deck.id);
  assert.ok(typeof c !== "string");
  room.release(A.id, [{ id: c.id, x: 500, y: 500 }], null);
  io.clear();
  assert.equal(room.peek(B, c.id), null);
  const toB = io.sentTo(`p:${B.id}`).filter((m) => m.ev === "peek");
  assert.equal(toB.length, 1);
  assert.ok(toB[0].data.face);
  assert.equal(io.sentTo(`p:${A.id}`).filter((m) => m.ev === "peek").length, 0);
  const face = toB[0].data.face as string;
  assert.deepEqual(leaks(io.sentTo(room.code), [face]), [], "방 전체로는 정체 미전송");
  assert.deepEqual(leaks(io.sentTo(`p:${A.id}`), [face]), [], "A에게도 미전송");
  assert.ok(io.sentTo(room.code).some((m) => m.ev === "notice" && m.data.kind === "peek"));
});

test("🔔 우노!: 우노 게임 + 손패 2장 이하만, 다시 3장 이상이 되면 풀림", () => {
  const { room, A } = setup();
  assert.equal(typeof room.callUno(A), "string", "우노 게임이 아니면 거부");
  applyPreset(room, "uno", "A");
  assert.equal(typeof room.callUno(A), "string", "7장이면 거부");
  A.hand = A.hand.slice(0, 1);
  assert.equal(room.callUno(A), null);
  assert.equal(room.pubPlayers().find((p) => p.id === A.id)!.uno, true);
  const deck = stacks(room).find((o) => o.kind === "stack" && !o.keep)!;
  room.drawToHand(A, deck.id, 2);
  assert.ok(!room.pubPlayers().find((p) => p.id === A.id)!.uno);
});

test("🪳 바퀴벌레 포커: 8종×8장=64장 전부 나눠줌, 선언·대답", () => {
  const { room, A, B } = setup();
  assert.equal(applyPreset(room, "cockroach", "A"), null);
  assert.equal(A.hand.length + B.hand.length, 64);
  assert.equal(A.hand.length, 32);
  assert.equal(room.pubObjects().length, 0, "테이블은 비어 있음");
  const kinds = new Map<string, number>();
  for (const h of [...A.hand, ...B.hand]) kinds.set(h.face, (kinds.get(h.face) ?? 0) + 1);
  assert.equal(kinds.size, 8);
  assert.ok([...kinds.values()].every((n) => n === 8));
  assert.equal(typeof room.sayClaim(A, A.id, "rat"), "string", "자기 자신에게는 불가");
  assert.equal(typeof room.sayClaim(A, B.id, "dragon"), "string", "없는 벌레 불가");
  assert.equal(room.sayClaim(A, B.id, "rat"), null);
  assert.deepEqual({ ...room.pubRoom().claim, at: 0 }, { by: A.id, to: B.id, creature: "rat", answer: null, at: 0 });
  assert.equal(typeof room.answerClaim(A, "yes"), "string", "받은 사람만 대답");
  assert.equal(room.answerClaim(B, "no"), null);
  assert.equal(room.pubRoom().claim?.answer, "no");
  assert.equal(typeof room.answerClaim(B, "yes"), "string", "두 번 대답 불가");
  applyPreset(room, "free", "A");
  assert.equal(room.pubRoom().claim, null, "게임을 바꾸면 선언 초기화");
});
