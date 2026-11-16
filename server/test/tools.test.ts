// 게임 준비(프리셋), 커스텀 카드, 반지 점수, 타이머, 버림 더미 테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PLAYERS } from "../../shared/protocol";
import { applyPreset } from "../src/presets";
import { leaks, setup, startRules } from "./helpers";

const stacks = (room: ReturnType<typeof setup>["room"]) => room.pubObjects().filter((o) => o.kind === "stack");

test("프로포즈 게임 준비: 가로형 덱 하나 + 기본 6장·덱 6장씩 + 반지 3개 점수판 (사용한 카드 자리 없음)", () => {
  const { room, A, B } = setup();
  assert.equal(applyPreset(room, "propose", "A"), null);
  assert.equal(room.preset, "propose");
  assert.deepEqual(room.score, { label: "반지", icon: "💍", goal: 3 });
  const s = stacks(room);
  assert.equal(s.length, 1);
  const main = s[0];
  assert.ok(main.kind === "stack" && main.system, "게임이 관리하는 덱");
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
  assert.equal(startRules(room), null);
  for (const p of all) assert.equal(p.hand.length, 7);
  const deck = stacks(room).find((o) => o.kind === "stack" && o.label === "우노 덱");
  assert.equal(deck?.count, 108 - 70 - 1);
});

test("우노 방식 준비: 7장씩 + 버린 카드 자리에 첫 카드 공개", () => {
  const { room, A, B } = setup();
  assert.equal(applyPreset(room, "uno", "A"), null);
  assert.equal(startRules(room), null);
  assert.equal(A.hand.length, 7);
  assert.equal(B.hand.length, 7);
  const pile = stacks(room).find((o) => o.kind === "stack" && o.label === "버린 카드");
  assert.ok(pile && pile.kind === "stack");
  assert.equal(pile.count, 1);
  assert.equal(pile.faceUp, true);
  assert.equal(pile.system, true, "게임이 관리하는 더미");
  assert.match(pile.top ?? "", /^U:[RYGB]-\d$/, "첫 카드는 숫자 카드");
  const deck = stacks(room).find((o) => o.kind === "stack" && o.label === "우노 덱");
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
  const deck = stacks(room)[0];
  const pile = room.addStack([], { x: 600, y: 600, faceUp: true, keep: true, label: "버린 카드" });
  room.drawToHand(A, deck.id, 1);
  const h = A.hand[0];
  const card = room.handPlay(A, h.id, pile.x + 5, pile.y + 5, true, true);
  assert.ok(typeof card !== "string");
  room.release(A.id, [{ id: card.id, x: pile.x + 5, y: pile.y + 5 }], pile.id);
  const after = stacks(room).find((o) => o.id === pile.id);
  assert.ok(after && after.kind === "stack");
  assert.equal(after.count, 1);
  assert.equal(after.top, h.face);
  // 전부 가져가도 자리는 남음
  room.drawToHand(A, pile.id, 1);
  const empty = stacks(room).find((o) => o.id === pile.id);
  assert.ok(empty && empty.kind === "stack" && empty.count === 0);
});

test("커스텀 카드: 덱과 같은 뒷면·모양으로 섞이고, 다른 사람에게 내용이 전송되지 않음", () => {
  const { room, A, io } = setup();
  applyPreset(room, "propose", "A");
  const main = stacks(room).find((o) => o.kind === "stack")!;
  io.clear();
  const r = room.customCreate(A, ["바다가 보이는 옥상에서", "  ", "비밀 문장 ABC"], "deck");
  assert.deepEqual(r, { count: 2 });
  const after = stacks(room).find((o) => o.id === main.id)!;
  assert.equal(after.count, main.count + 2);
  assert.equal(after.back, main.back);
  assert.deepEqual(leaks(io.sentTo("TEST01"), ["T:비밀 문장 ABC", "T:바다가 보이는 옥상에서"]), []);
  assert.doesNotMatch(JSON.stringify(io.sentTo("TEST01")), /비밀 문장/);
});

test("커스텀 카드: 프로포즈 게임에서만, 내 손패로, 글자 수·줄 수 제한, 빈 입력 거부", () => {
  const { room, A } = setup();
  assert.equal(typeof room.customCreate(A, ["안 됨"], "hand"), "string", "자유 테이블에서는 거부");
  applyPreset(room, "propose", "A");
  A.hand = [];
  const r = room.customCreate(A, ["가".repeat(50), ...Array.from({ length: 30 }, (_, i) => `줄${i}`)], "hand");
  assert.ok(typeof r !== "string");
  assert.equal(r.count, 20);
  assert.equal(A.hand[0].face.length, 2 + 30);
  assert.equal(typeof room.customCreate(A, ["", " "], "deck"), "string");
  assert.equal(typeof room.customCreate(A, "문자열", "deck"), "string");
});

test("반지 고치기(score:add)는 방장만, 0 아래로 안 내려감", () => {
  const { room, A, B, io } = setup();
  assert.equal(typeof room.scoreAdd(A, B.id, 1), "string", "점수판 없는 게임");
  applyPreset(room, "propose", "A");
  room.hostId = A.id;
  assert.equal(typeof room.scoreAdd(B, B.id, 1), "string", "방장이 아니면 거부");
  io.clear();
  room.scoreAdd(A, B.id, 1);
  room.scoreAdd(A, B.id, 1);
  room.scoreAdd(A, B.id, 1);
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

test("🫨 잡고 흔들기: 들고 있는 카드 주변 카드만 모여 한 더미가 되고, 계속 들고 있음", () => {
  const { room, io, A, B } = setup();
  const deck = stacks(room)[0];
  room.drawToHand(A, deck.id, 6);
  const play = (i: number, x: number, y: number) => {
    const c = room.handPlay(A, A.hand[0].id, x, y, true, false);
    assert.ok(typeof c !== "string");
    return c.id;
  };
  void play;
  const held = play(0, 500, 500);
  const near1 = play(1, 560, 520);
  const near2 = play(2, 420, 640);
  const far = play(3, 1500, 1500);
  const pinned = play(4, 520, 450);
  room.setPinned(A.id, [pinned], true);
  assert.deepEqual(room.shakeGather(A.id, held, 500, 500) as string, "들고 있는 카드를 흔들어야 모을 수 있어요", "안 들고 있으면 거부");
  assert.deepEqual(room.grab(A.id, [held]), [held]);
  assert.equal(typeof room.shakeGather(B.id, held, 500, 500), "string", "남이 든 카드는 흔들 수 없음");
  io.clear();
  const r = room.shakeGather(A.id, held, 500, 500);
  assert.ok(typeof r !== "string");
  assert.equal(r.count, 2, "주변 2장을 모음 (들고 있던 1장과 합쳐 3장)");
  const objs = room.pubObjects();
  const st = objs.find((o) => o.id === r.id);
  assert.ok(st && st.kind === "stack" && st.count === 3 && st.lockedBy === A.id, "새 더미는 계속 A가 들고 있음");
  assert.ok(objs.some((o) => o.id === far), "멀리 있는 카드는 그대로");
  assert.ok(objs.some((o) => o.id === pinned), "잠긴 카드는 그대로");
  assert.ok(!objs.some((o) => o.id === near1 || o.id === near2 || o.id === held));
  assert.ok(io.sentTo(room.code).some((m) => m.ev === "fx:gather"), "모두에게 모이는 연출");
  // 다시 흔들어도 더 모을 게 없으면 그대로
  const again = room.shakeGather(A.id, r.id, 500, 500);
  assert.ok(typeof again !== "string" && again.count === 0 && again.id === r.id);
});
