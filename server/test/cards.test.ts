import { test } from "node:test";
import assert from "node:assert/strict";
import { deckFaces, faceLabel, parseFace, standard54 } from "../../shared/cards";

test("트럼프 54장: 중복 없음, 조커 2장 포함", () => {
  const faces = standard54();
  assert.equal(faces.length, 54);
  assert.equal(new Set(faces).size, 54);
  assert.ok(faces.includes("JK-R") && faces.includes("JK-B"));
});

test("앞면 문자열 해석", () => {
  assert.deepEqual(parseFace("H-10"), { type: "std", suit: "H", rank: "10", red: true, symbol: "♥" });
  assert.equal(parseFace("JK-B").type, "joker");
  assert.deepEqual(parseFace("T:고양이"), { type: "text", text: "고양이" });
  assert.equal(parseFace("X-1").type, "unknown");
  assert.equal(faceLabel("S-A"), "♠A");
});

test("단어 카드 덱은 글자 카드로 구성", () => {
  const { faces, back } = deckFaces("amumal");
  assert.ok(faces.length > 10);
  assert.ok(faces.every((f) => f.startsWith("T:")));
  assert.equal(back, "amumal");
});
