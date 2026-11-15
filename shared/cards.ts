// =====================================================================
// 카드 종류 정의
// - 앞면은 문자열(Face)로 표현합니다. 화면 그리기는 클라이언트가 이 문자열을 해석해서 합니다.
// - 나중에 커스텀 카드(이미지 업로드)를 넣을 때는 "IMG:<자산id>" 같은 형식을 추가하면
//   서버 로직(숨김/공개, 이동, 더미)은 그대로 재사용할 수 있습니다.
// =====================================================================
import type { BackStyle, DeckType, Face } from "./protocol";

export const SUITS = ["S", "H", "D", "C"] as const; // 스페이드, 하트, 다이아, 클로버
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function standard54(): Face[] {
  const out: Face[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(`${s}-${r}`);
  out.push("JK-B", "JK-R");
  return out;
}

/** "아무말 청혼" 단어 카드 덱 (글자 카드 예시 — 커스텀 카드 구조 확인용) */
export const AMUMAL_WORDS = [
  "나는", "너를", "나의", "너의", "사랑해", "~을/를", "~와/과 함께", "~처럼",
  "고양이", "김치찌개", "우주", "편의점", "냉장고", "월요일", "노래방", "떡볶이", "지하철 2호선", "은하수",
  "펭귄", "공룡", "외계인", "마법사", "해적", "치킨", "붕어빵", "마라탕", "민트초코", "한강",
  "와이파이", "충전기", "양말", "전기장판", "로또", "월급", "택배", "첫눈", "벚꽃", "새벽 3시",
  "퇴근길", "100년", "다음 생", "방귀", "코골이", "뱃살", "심장", "영혼", "운명", "흑역사",
  "뜨겁게", "몰래", "당당하게", "평생", "할부로", "두 배로", "전속력으로", "촉촉하게", "반짝이는", "수상한",
  "전설의", "우주 최고", "말랑말랑한", "무릎 꿇고", "지켜줄게", "먹여줄게", "책임질게", "끓여줄게", "업어줄게", "기다릴게",
  "같이 늙고 싶어", "다 줄게", "약속해", "안아줄게", "~보다 더", "~만큼", "~을/를 위해", "~때문에", "~속에서", "~(으)로",
];

export function deckFaces(deck: DeckType): { faces: Face[]; back: BackStyle } {
  if (deck === "amumal") return { faces: AMUMAL_WORDS.map((w) => `T:${w}`), back: "amumal" };
  return { faces: standard54(), back: "blue" };
}

export type ParsedFace =
  | { type: "std"; suit: string; rank: string; red: boolean; symbol: string }
  | { type: "joker"; red: boolean }
  | { type: "text"; text: string }
  | { type: "unknown"; raw: string };

export function parseFace(face: Face): ParsedFace {
  if (face.startsWith("T:")) return { type: "text", text: face.slice(2) };
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
  if (p.type === "text") return p.text;
  return "카드";
}
