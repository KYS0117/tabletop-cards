// =====================================================================
// 게임 선택 (프리셋): 고르면 테이블을 그 게임에 맞게 새로 준비합니다.
// 자유 테이블은 준비만, 프로포즈·우노·바퀴벌레 포커는 규칙(차례·라운드) 진행까지 자동입니다 (games/ 폴더).
//
// 새 게임 준비를 추가하려면: shared/protocol.ts 의 PresetId 에 이름 추가 → 아래 PRESETS 에 함수 추가
// =====================================================================
import { TABLE_H, TABLE_W, type PresetId } from "../../shared/protocol";
import { ProposeGame } from "./games/propose";
import { RoachGame } from "./games/roach";
import { UnoGame } from "./games/uno";
import type { Room } from "./room";

const CX = TABLE_W / 2;
const CY = TABLE_H / 2;

type Setup = (room: Room) => string | null;

export const PRESET_NAMES: Record<PresetId, string> = {
  free: "자유 테이블 (트럼프)",
  propose: "방금 떠올린 프로포즈의 말을 너에게 바칠게",
  uno: "우노 (규칙 자동)",
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
  // 아래 셋은 규칙(라운드·차례) 진행이 자동인 게임 — server/src/games/*.ts
  propose: (room) => {
    const g = ProposeGame.start(room);
    return typeof g === "string" ? g : null;
  },
  uno: (room) => {
    const g = UnoGame.start(room);
    return typeof g === "string" ? g : null;
  },
  cockroach: (room) => {
    const g = RoachGame.start(room);
    return typeof g === "string" ? g : null;
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
