// 서버 카드 로직 기본 테스트 — 기능을 추가할 때마다 `npm test` 로 기존 동작이 그대로인지 확인하세요.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PLAYERS, TABLE_H, TABLE_W } from "../../shared/protocol";
import { deckOf, leaks, setup } from "./helpers";

test("처음에는 54장 뒷면 덱 1개, 카드 정체는 전송되지 않음", () => {
  const { room } = setup();
  const objs = room.pubObjects();
  assert.equal(objs.length, 1);
  const d = deckOf(room);
  assert.equal(d.count, 54);
  assert.equal(d.faceUp, false);
  assert.equal(d.top, null);
  assert.doesNotMatch(JSON.stringify(objs), /"(face|top)":"/);
});

test("덱에서 1장 집기: 뒷면 카드가 집은 사람에게 잠긴 채 생성", () => {
  const { room, A } = setup();
  const d = deckOf(room);
  const c = room.takeTop(A.id, d.id);
  assert.ok(typeof c !== "string");
  assert.equal(c.face, null);
  assert.equal(c.lockedBy, A.id);
  assert.equal(deckOf(room).count, 53);
});

test("잠금: 남이 잡은 카드는 잡기·이동·섞기 불가, 놓으면 풀림", () => {
  const { room, A, B } = setup();
  const d = deckOf(room);
  const c = room.takeTop(A.id, d.id);
  assert.ok(typeof c !== "string");
  assert.deepEqual(room.grab(B.id, [c.id]), []);
  assert.deepEqual(room.drag(B.id, [{ id: c.id, x: 5, y: 5 }]), []);
  room.grab(A.id, [d.id]);
  assert.equal(typeof room.shuffle(B.id, d.id), "string");
  room.release(A.id, [{ id: c.id, x: 500, y: 500 }], null);
  assert.deepEqual(room.grab(B.id, [c.id]), [c.id]);
});

test("뒤집으면 앞면 정보가 방 전체에 공개됨", () => {
  const { room, A, io } = setup();
  const c = room.takeTop(A.id, deckOf(room).id);
  assert.ok(typeof c !== "string");
  io.clear();
  room.flip(A.id, [c.id]);
  const up = io.sentTo("TEST01").find((s) => s.ev === "obj:upsert");
  assert.ok(up);
  assert.match(up.data.objects[0].face, /^(S|H|D|C|JK)-/);
});

test("손패: 소유자 채널로만 전송, 방 전체 데이터에는 카드 정체 없음", () => {
  const { room, A, io } = setup();
  assert.equal(room.drawToHand(A, deckOf(room).id, 5), null);
  assert.equal(A.hand.length, 5);
  const faces = A.hand.map((h) => h.face);
  assert.deepEqual(leaks(io.sentTo("TEST01"), faces), []);
  assert.ok(io.sentTo(`p:${A.id}`).some((s) => s.ev === "hand:update" && s.data.hand.length === 5));
  const upd = io.sentTo("TEST01").filter((s) => s.ev === "room:update").pop();
  assert.equal(upd?.data.room.players.find((p: { id: string }) => p.id === A.id).handCount, 5);
});

test("손패에서 내기: 새 id 발급, 뒷면으로 내면 정체 비공개", () => {
  const { room, A, io } = setup();
  room.drawToHand(A, deckOf(room).id, 2);
  const [h1, h2] = A.hand;
  io.clear();
  const up = room.handPlay(A, h1.id, 800, 600, true, false);
  assert.ok(typeof up !== "string");
  assert.notEqual(up.id, h1.id);
  assert.equal(up.face, h1.face);
  const down = room.handPlay(A, h2.id, 900, 600, false, false);
  assert.ok(typeof down !== "string");
  assert.equal(down.face, null);
  assert.deepEqual(leaks(io.sentTo("TEST01"), [h2.face]), [], "뒷면으로 낸 카드 정체가 방 전체에 전송됨");
});

test("남의 손패 카드 id로 내기 → 거부", () => {
  const { room, A, B } = setup();
  room.drawToHand(A, deckOf(room).id, 1);
  assert.equal(typeof room.handPlay(B, A.hand[0].id, 100, 100, true, false), "string");
  assert.equal(A.hand.length, 1);
});

test("손패 순서 바꾸기: 정확한 순열만 허용", () => {
  const { room, A } = setup();
  room.drawToHand(A, deckOf(room).id, 3);
  const ids = A.hand.map((h) => h.id);
  assert.equal(room.handReorder(A, [ids[2], ids[0], ids[1]]), true);
  assert.deepEqual(A.hand.map((h) => h.id), [ids[2], ids[0], ids[1]]);
  assert.equal(room.handReorder(A, [ids[0], ids[0], ids[1]]), false);
  assert.equal(room.handReorder(A, [ids[0]]), false);
});

test("섞기: 카드 구성은 그대로, 순서는 전송되지 않음", () => {
  const { room, A, io } = setup();
  const d = deckOf(room);
  room.flip(A.id, [d.id]); // 앞면 더미 → 맨 위 카드만 공개
  io.clear();
  assert.equal(room.shuffle(A.id, d.id), null);
  const text = JSON.stringify(io.sentTo("TEST01"));
  assert.doesNotMatch(text, /"cards"/);
  const s = deckOf(room);
  assert.equal(s.count, 54);
  assert.ok(s.top, "앞면 더미의 맨 위 카드는 보여야 함");
});

test("더미 위에 놓으면 합쳐지고, 그냥 겹치면 합쳐지지 않음", () => {
  const { room, A } = setup();
  const d = deckOf(room);
  const c1 = room.takeTop(A.id, d.id);
  const c2 = room.takeTop(A.id, d.id);
  assert.ok(typeof c1 !== "string" && typeof c2 !== "string");
  room.release(A.id, [{ id: c1.id, x: 1000, y: 1000 }], null);
  // c2 를 c1 위에 겹쳐 놓기 (mergeInto 없음) → 둘 다 낱장으로 남음
  room.release(A.id, [{ id: c2.id, x: 1005, y: 1003 }], null);
  assert.equal(room.pubObjects().filter((o) => o.kind === "card").length, 2);
  // c2 를 덱 위에 놓고 합치기
  room.grab(A.id, [c2.id]);
  room.release(A.id, [{ id: c2.id, x: d.x + 10, y: d.y + 5 }], d.id);
  assert.equal(deckOf(room).count, 53);
  // 너무 멀리서 합치기 요청 → 거부(낱장으로 남음)
  room.grab(A.id, [c1.id]);
  room.release(A.id, [{ id: c1.id, x: 100, y: 100 }], d.id);
  assert.equal(deckOf(room).count, 53);
});

test("묶기 / 펼치기 / 정렬", () => {
  const { room, A } = setup();
  const d = deckOf(room);
  room.spread(A.id, d.id);
  const cards = room.pubObjects();
  assert.equal(cards.length, 54);
  assert.ok(cards.every((o) => o.kind === "card"));
  const ids = cards.slice(0, 5).map((o) => o.id);
  room.arrange(A.id, ids);
  const arranged = room.pubObjects().filter((o) => ids.includes(o.id));
  assert.ok(arranged.every((o) => o.rot === 0));
  assert.equal(room.createStack(A.id, ids), null);
  assert.equal(room.pubObjects().filter((o) => o.kind === "stack")[0].count, 5);
  assert.equal(typeof room.createStack(A.id, [cards[10].id]), "string", "1장으로는 더미 불가");
});

test("회전 값 검증: 15° 단위만 허용", () => {
  const { room, A } = setup();
  const d = deckOf(room);
  assert.equal(typeof room.rotate(A.id, [d.id], 7), "string");
  assert.equal(room.rotate(A.id, [d.id], 15), null);
  assert.equal(room.rotate(A.id, [d.id], -90), null);
  assert.equal(deckOf(room).rot, 285);
});

test("삭제·복제 권한: 방장만, 설정으로 모두 허용 가능", () => {
  const { room, A, B } = setup();
  const d = deckOf(room);
  assert.equal(typeof room.remove(B.id, [d.id]), "string");
  assert.equal(typeof room.duplicate(B.id, [d.id]), "string");
  room.updateSettings({ allowEveryoneDelete: true });
  assert.equal(room.duplicate(B.id, [d.id]), null);
  assert.equal(room.pubObjects().length, 2);
  assert.equal(room.remove(A.id, [d.id]), null);
});

test("비정상 좌표는 테이블 범위로 제한", () => {
  const { room, A } = setup();
  const d = deckOf(room);
  room.grab(A.id, [d.id]);
  room.drag(A.id, [{ id: d.id, x: Number.NaN, y: 5 }]);
  assert.equal(deckOf(room).x, d.x, "NaN 이동은 무시");
  room.release(A.id, [{ id: d.id, x: 1e9, y: -1e9 }], null);
  const s = deckOf(room);
  assert.ok(s.x <= TABLE_W + 40 && s.y >= -40 && s.y <= TABLE_H + 40);
});

test("나가면 손패는 테이블에 뒷면 더미로, 방장은 다음 사람에게", () => {
  const { room, A, B } = setup();
  room.drawToHand(A, deckOf(room).id, 4);
  room.removePlayer(A, "나갔어요");
  assert.equal(room.hostId, B.id);
  const stacks = room.pubObjects().filter((o) => o.kind === "stack");
  assert.ok(stacks.some((s) => s.kind === "stack" && s.count === 4 && !s.faceUp));
});

test("나눠주기: 접속한 모든 사람에게 n장씩", () => {
  const { room, A, B } = setup();
  assert.equal(room.deal(A.id, deckOf(room).id, 3), null);
  assert.equal(A.hand.length, 3);
  assert.equal(B.hand.length, 3);
  assert.equal(deckOf(room).count, 48);
});

test(`최대 인원 ${MAX_PLAYERS}명`, () => {
  const { room } = setup();
  for (let i = 2; i < MAX_PLAYERS; i++) assert.ok(room.addPlayer(`P${i}`, `t${i}`));
  assert.equal(room.addPlayer("넘침", "tx"), null);
});

test("초기화: 테이블과 모든 손패 비우고 새 덱 1개", () => {
  const { room, A, B } = setup();
  room.drawToHand(A, deckOf(room).id, 2);
  room.drawToHand(B, deckOf(room).id, 2);
  room.reset();
  assert.equal(A.hand.length + B.hand.length, 0);
  assert.equal(room.pubObjects().length, 1);
  assert.equal(deckOf(room).count, 54);
});
