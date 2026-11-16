// =====================================================================
// 규칙 게임 대기실 (우노 · 바퀴벌레 포커)
//  - 방장이 게임을 고르면 먼저 대기실: 사람들이 다 모일 때까지 기다림 (늦게 들어온 사람도 참가)
//  - 방장이 "▶ 게임 시작"을 누르면 그때 접속해 있는 사람으로 카드를 나누고 순서를 정해 시작
// =====================================================================
import type { PubLobby } from "../../../shared/protocol";
import type { IPlayer, Room } from "../room";
import { RoachGame } from "./roach";
import type { GameEngine } from "./types";
import { UnoGame } from "./uno";

export class LobbyGame implements GameEngine {
  readonly kind = "lobby" as const;
  readonly blocksFreePlay = true;
  static MIN = 2;

  constructor(
    private room: Room,
    readonly target: "uno" | "cockroach",
  ) {}

  static open(room: Room, target: "uno" | "cockroach"): string | null {
    if (target === "cockroach") {
      const bad = RoachGame.checkDeck();
      if (bad) return bad;
    }
    room.clearTable();
    room.preset = target;
    room.score = null;
    room.game = new LobbyGame(room, target);
    room.timerSet(30);
    return null;
  }

  start(by: IPlayer): string | null {
    if (by.id !== this.room.hostId) return "게임 시작은 방장이 할 수 있어요";
    const r = this.target === "uno" ? UnoGame.start(this.room) : RoachGame.start(this.room);
    if (typeof r === "string") return r;
    this.room.roomChanged();
    return null;
  }

  pub(): PubLobby {
    return { kind: "lobby", game: this.target, players: this.room.connectedPlayers().map((p) => p.id), min: LobbyGame.MIN };
  }
}
