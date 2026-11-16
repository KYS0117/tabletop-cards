// =====================================================================
// 규칙이 자동인 게임(우노·바퀴벌레 포커·프로포즈 라운드)의 공통 모양
// - 게임 상태는 Room.game 에 하나만 들어갑니다. 자유 테이블이면 null.
// - pub() 은 모두에게 보내도 되는 정보만 돌려줘야 합니다 (손패·덱 순서 X).
// =====================================================================
import type { PubGame } from "../../../shared/protocol";
import type { IPlayer } from "../room";

export interface GameEngine {
  readonly kind: PubGame["kind"];
  /** true 면 손패를 테이블에 마음대로 내기·가져오기·덱 추가가 막힘 (규칙대로만 진행) */
  readonly blocksFreePlay: boolean;
  pub(): PubGame;
  /** 게임 중에 새로 들어온 사람 */
  onJoin?(p: IPlayer): void;
  /** 방에서 나간 사람 (손패는 게임이 정리) */
  onLeave?(p: IPlayer): void;
  /** 방장이 멈춘 게임을 진행시킬 때 */
  skip?(by: IPlayer): string | null;
  /** 게임이 바뀔 때 정리 (타이머 등) */
  dispose?(): void;
}

/** 접속 중인 사람 중 order 순서상 다음 사람 (dir 방향) */
export function nextInOrder(order: string[], fromIdx: number, dir: 1 | -1, ok: (id: string) => boolean): number {
  const n = order.length;
  for (let k = 1; k <= n; k++) {
    const i = (((fromIdx + dir * k) % n) + n) % n;
    if (ok(order[i])) return i;
  }
  return fromIdx;
}
