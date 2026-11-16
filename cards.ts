// =====================================================================
// 카드 종류 정의
// - 앞면은 문자열(Face)로 표현합니다. 화면 그리기는 클라이언트가 이 문자열을 해석해서 합니다.
// - 이미지 카드("IMG:덱/파일")는 decks/ 폴더의 그림을 사용합니다 (서버가 decks/<덱>/deck.json 을 읽음).
// =====================================================================
import type { BackStyle, Face } from "./protocol";

export const SUITS = ["S", "H", "D", "C"] as const; // 스페이드, 하트, 다이아, 클로버
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function standard54(): Face[] {
  const out: Face[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(`${s}-${r}`);
  out.push("JK-B", "JK-R");
  return out;
}

// ---------------------------------------------------------------------
// 우노 방식 컬러 카드 108장 (게임 방식만 참고한 자체 디자인)
//   색 4가지 × (0 한 장, 1~9 두 장씩, 스킵·리버스·+2 두 장씩) = 100장
//   와일드 4장 + 와일드+4 4장 = 8장
// ---------------------------------------------------------------------
export const UNO_COLORS = ["R", "Y", "G", "B"] as const;
export const UNO_COLOR_NAME: Record<string, string> = { R: "빨강", Y: "노랑", G: "초록", B: "파랑", W: "와일드" };

export function uno108(): Face[] {
  const out: Face[] = [];
  for (const c of UNO_COLORS) {
    out.push(`U:${c}-0`);
    for (let n = 1; n <= 9; n++) out.push(`U:${c}-${n}`, `U:${c}-${n}`);
    for (const a of ["S", "V", "D2"]) out.push(`U:${c}-${a}`, `U:${c}-${a}`);
  }
  for (let i = 0; i < 4; i++) out.push("U:W-W", "U:W-D4");
  return out;
}

export function builtinDeck(deck: "standard54" | "uno108"): { faces: Face[]; back: BackStyle } {
  if (deck === "uno108") return { faces: uno108(), back: "uno" };
  return { faces: standard54(), back: "blue" };
}

export type ParsedFace =
  | { type: "std"; suit: string; rank: string; red: boolean; symbol: string }
  | { type: "joker"; red: boolean }
  | { type: "uno"; color: string; value: string }
  | { type: "image"; src: string }
  | { type: "text"; text: string }
  | { type: "unknown"; raw: string };

/** 이미지 경로는 영문/숫자/일부 기호만 허용 (서버도 같은 규칙으로 파일 이름을 검사) */
export const SAFE_ASSET_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$/i;

export function parseFace(face: Face): ParsedFace {
  if (face.startsWith("T:")) return { type: "text", text: face.slice(2) };
  if (face.startsWith("IMG:")) {
    const path = face.slice(4);
    return SAFE_ASSET_PATH.test(path) && !path.includes("..") ? { type: "image", src: `/decks/${path}` } : { type: "unknown", raw: face };
  }
  const u = /^U:([RYGBW])-(\d|S|V|D2|W|D4)$/.exec(face);
  if (u) return { type: "uno", color: u[1], value: u[2] };
  if (face === "JK-R") return { type: "joker", red: true };
  if (face === "JK-B") return { type: "joker", red: false };
  const m = /^([SHDC])-(A|[2-9]|10|J|Q|K)$/.exec(face);
  if (m) return { type: "std", suit: m[1], rank: m[2], red: m[1] === "H" || m[1] === "D", symbol: SUIT_SYMBOL[m[1]] };
  return { type: "unknown", raw: face };
}

/** 사람이 읽기 좋은 카드 이름 (알림, 접근성용) */
export function faceLabel(face: Face): string {
  const p = parseFace(face);
  if (p.type === "std") return `${p.symbol}${p.rank}`;
  if (p.type === "joker") return p.red ? "컬러 조커" : "흑백 조커";
  if (p.type === "uno") return `${UNO_COLOR_NAME[p.color]} ${p.value}`;
  if (p.type === "text") return p.text;
  return "카드";
}
