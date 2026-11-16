import { test } from "node:test";
import assert from "node:assert/strict";
import { faceLabel, parseFace, standard54, uno108 } from "../../shared/cards";

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

test("우노 방식 108장 구성", () => {
  const f = uno108();
  assert.equal(f.length, 108);
  assert.equal(f.filter((x) => x.startsWith("U:W-")).length, 8);
  assert.equal(f.filter((x) => x === "U:R-0").length, 1);
  assert.equal(f.filter((x) => x === "U:B-7").length, 2);
  assert.equal(f.filter((x) => x === "U:G-D2").length, 2);
  assert.ok(f.every((x) => parseFace(x).type === "uno"));
});

test("이미지 카드 경로는 안전한 이름만 허용", () => {
  assert.deepEqual(parseFace("IMG:propose/023.webp"), { type: "image", src: "/decks/propose/023.webp" });
  assert.equal(parseFace("IMG:../etc/passwd.png").type, "unknown");
  assert.equal(parseFace("IMG:propose/a b.png").type, "unknown");
  assert.equal(parseFace("IMG:propose/x.svg").type, "unknown");
});
