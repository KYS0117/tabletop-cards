// =====================================================================
// 게임 모드별 화면 목록
// - 방의 room.mode 값에 따라 해당 화면만 불러옵니다 (lazy: 필요할 때 따로 내려받음).
//   그래서 게임이 늘어나도 처음 접속할 때 받는 코드 양이 같이 늘지 않아요.
// - 새 게임 추가: client/src/modes/<게임>/ 에 화면을 만들고 아래에 한 줄 추가.
//   카드 테이블(Table), 손패, 메뉴 같은 공통 부품은 그대로 가져다 쓰면 됩니다.
// =====================================================================
import { lazy, type ComponentType } from "react";
import type { GameMode } from "../../../shared/protocol";

export interface ModeDef {
  id: GameMode;
  name: string;
  component: ComponentType;
}

export const MODES: Record<GameMode, ModeDef> = {
  sandbox: {
    id: "sandbox",
    name: "자유 테이블",
    component: lazy(() => import("../Table").then((m) => ({ default: m.Table }))),
  },
};

export function modeFor(id: string | undefined): ModeDef {
  return MODES[(id ?? "sandbox") as GameMode] ?? MODES.sandbox;
}
