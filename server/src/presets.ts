// =====================================================================
// 게임 선택 (프리셋): 고르면 테이블을 그 게임에 맞게 새로 준비합니다.
// 규칙을 강제하지 않는 "자유 진행" 게임들이라 준비(카드 배치·나눠주기·점수판·타이머)만 자동입니다.
//
// 새 게임 준비를 추가하려면: shared/protocol.ts 의 PresetId 에 이름 추가 → 아래 PRESETS 에 함수 추가
// =====================================================================
import { TABLE_H, TABLE_W, type PresetId } from "../../shared/protocol";
import { builtinDeck } from "../../shared/cards";
import { loadImageDeck } from "./decks";
import type { IStackCard, Room } from "./room";

const CX = TABLE_W / 2;
const CY = TABLE_H / 2;

type Setup = (room: Room) => string | null;

export const PRESET_NAMES: Record<PresetId, string> = {
  free: "자유 테이블 (트럼프)",
  propose: "방금 떠올린 프로포즈의 말을 너에게 바칠게",
  uno: "우노 방식 컬러 카드",
  cockroach: "바퀴벌레 포커",
};

const PRESETS: Record<PresetId, Setup> = {
  free(room) {
    room.clearTable();
    room.preset = "free";
    room.score = null;
    room.addDeck("standard54", CX, CY, true);
    room.timerSet(60);
    return null;
  },

  /**
   * 프로포즈 게임
   * - 가운데: 프로포즈 카드 덱(뒷면). 낸 카드는 테이블 아무 곳에나 자유롭게
   * - 모든 사람: 기본 카드 6장(각자 한 벌) + 덱에서 6장
   * - 점수판: 반지 💍 3개 모으면 승리 / 타이머 10초
   */
  propose(room) {
    const d = loadImageDeck("propose");
    if (typeof d === "string") return d;
    room.clearTable();
    room.preset = "propose";
    room.score = { label: "반지", icon: "💍", goal: 3 };
    const cards: IStackCard[] = d.cards.map((face) => ({ face, back: d.back, shape: d.shape }));
    const main = room.addStack(cards, { x: CX, y: CY - 120, shuffle: true, shape: d.shape, label: "프로포즈 카드" });
    for (const p of room.connectedPlayers()) {
      p.hand.push(...d.base.map((face) => room.handCard({ face, back: d.back, shape: d.shape })));
    }
    room.dealFrom(main, 6);
    room.timerSet(60); // 한 사람 프로포즈 시간 (화면에서 바꿀 수 있음)
    if (d.placeholder) room.notice("아직 카드 그림이 없어서 임시 글자 카드로 준비했어요 (decks/propose 폴더에 그림을 넣으면 바뀌어요)", "warn");
    return null;
  },

  /**
   * 우노 방식 (자유 진행)
   * - 가운데: 덱(뒷면) + "버린 카드" 자리에 첫 카드 한 장 공개
   * - 모든 사람: 7장씩
   */
  uno(room) {
    room.clearTable();
    room.preset = "uno";
    room.score = null;
    const { faces, back } = builtinDeck("uno108");
    const deck = room.addStack(
      faces.map((face) => ({ face, back })),
      { x: CX - 120, y: CY, shuffle: true, label: "우노 덱" },
    );
    const pile = room.addStack([], { x: CX + 120, y: CY, faceUp: true, keep: true, label: "버린 카드" });
    room.dealFrom(deck, 7);
    room.transferTop(deck, pile);
    room.timerSet(30);
    return null;
  },

  /**
   * 바퀴벌레 포커
   * - 벌레 8종 × 8장 = 64장을 접속한 모든 사람에게 전부 나눠줌 (테이블은 비어 있음)
   * - 손패에서 뒷면으로 내고 📣 선언 → 받은 사람이 🙆/🙅 대답하거나 👁 몰래 보고 다른 사람에게 넘김
   * - 진 사람은 그 카드를 자기 앞에 앞면으로 놓음 (같은 벌레 4장이면 패배 — 자유 진행)
   */
  cockroach(room) {
    const d = loadImageDeck("cockroach");
    if (typeof d === "string") return d;
    room.clearTable();
    room.preset = "cockroach";
    room.score = null;
    const cards: IStackCard[] = d.cards.map((face) => ({ face, back: d.back, shape: d.shape }));
    const deck = room.addStack(cards, { x: CX, y: CY, shuffle: true, shape: d.shape, label: "바퀴벌레 포커" });
    room.dealFrom(deck, cards.length); // 남김없이 전부
    room.timerSet(30);
    if (d.placeholder) room.notice("아직 카드 그림이 없어서 임시 글자 카드로 준비했어요 (decks/cockroach 폴더에 그림을 넣으면 바뀌어요)", "warn");
    return null;
  },
};

export function applyPreset(room: Room, id: unknown, by: string): string | null {
  if (typeof id !== "string" || !(id in PRESETS)) return "알 수 없는 게임이에요";
  const err = PRESETS[id as PresetId](room);
  if (err) return err;
  room.roomChanged();
  room.notice(`🎲 ${by}님이 "${PRESET_NAMES[id as PresetId]}" 게임을 준비했어요`, "deal");
  return null;
}
