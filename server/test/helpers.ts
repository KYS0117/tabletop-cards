// 테스트용 가짜 Socket.IO 서버: 실제 네트워크 없이 "누구에게 무엇을 보냈는지"만 기록
import type { Server, Socket } from "socket.io";
import { Room, type IPlayer } from "../src/room";

export interface Sent {
  to: string;
  ev: string;
  data: any;
}

export class FakeIO {
  sent: Sent[] = [];
  sockets = { sockets: new Map() };
  to(room: string): any {
    const op: any = {
      emit: (ev: string, data: unknown) => {
        this.sent.push({ to: room, ev, data });
        return true;
      },
      to: (r: string) => this.to(r),
    };
    Object.defineProperty(op, "volatile", { get: () => op });
    return op;
  }
  /** 특정 채널(방 전체 또는 p:<플레이어>)로 보낸 것만 */
  sentTo(channel: string) {
    return this.sent.filter((s) => s.to === channel);
  }
  clear() {
    this.sent = [];
  }
}

export function fakeSocket(io: FakeIO, id: string): Socket {
  return {
    id,
    join() {},
    leave() {},
    emit(ev: string, data: unknown) {
      io.sent.push({ to: `socket:${id}`, ev, data });
      return true;
    },
  } as unknown as Socket;
}

/** 방 하나 + 접속한 플레이어 A(방장), B */
export function setup() {
  const io = new FakeIO();
  const room = new Room(io as unknown as Server, "TEST01", "테스트");
  const A = room.addPlayer("A", "tabA")!;
  const B = room.addPlayer("B", "tabB")!;
  room.attachSocket(A, fakeSocket(io, "sA"));
  room.attachSocket(B, fakeSocket(io, "sB"));
  io.clear();
  return { io, room, A, B };
}

export function deckOf(room: Room) {
  const pub = room.pubObjects();
  const s = pub.find((o) => o.kind === "stack");
  if (!s || s.kind !== "stack") throw new Error("no deck");
  return s;
}

/** 직렬화한 전송 데이터 안에 카드 앞면 문자열이 있는지 */
export function leaks(sent: Sent[], faces: string[]) {
  const text = JSON.stringify(sent);
  return faces.filter((f) => text.includes(`"${f}"`));
}

/** 규칙 게임 대기실에서 방장이 "게임 시작" */
export function startRules(room: Room): string | null {
  const g = room.game as unknown as { kind?: string; start?: (p: IPlayer) => string | null } | null;
  if (!g || g.kind !== "lobby" || !g.start) return "대기실이 아니에요";
  return g.start(room.players.get(room.hostId)!);
}

export type { IPlayer };
