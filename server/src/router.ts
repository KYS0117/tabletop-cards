// =====================================================================
// 소켓 요청 처리 공통 도우미 (모든 기능 모듈이 함께 사용)
// - 방/플레이어 확인, 요청 수 제한, 예외 처리, ack 응답 형식을 한 곳에서 처리합니다.
// - 새 게임 모듈은 이 Router 로 이벤트를 등록하기만 하면 같은 검증을 자동으로 받습니다.
// =====================================================================
import type { Server, Socket } from "socket.io";
import type { IPlayer, Room } from "./room";
import { RateLimiter } from "./util";

export interface Ctx {
  room: Room;
  player: IPlayer;
}

export type Ack = (res: unknown) => void;

/** 처리 함수의 반환값: 문자열 = 오류 메시지, 객체 = 성공 응답에 합쳐짐, 없음 = { ok: true } */
export type Handler = (c: Ctx, payload: Record<string, unknown>) => unknown;

export interface SocketData {
  code?: string;
  pid?: string;
  dragLimit: RateLimiter;
  actionLimit: RateLimiter;
}

export interface Router {
  socket: Socket;
  io: Server;
  data: SocketData;
  /** 이 소켓이 지금 들어가 있는 방과 플레이어 (없으면 null) */
  ctx(): Ctx | null;
  /** 일반 요청 (초당 약 15회 제한, ack 로 결과 응답) */
  on(event: string, fn: Handler): void;
  /** 방장만 가능한 요청 */
  hostOnly(event: string, fn: Handler): void;
  /** 드래그·커서처럼 빈번한 실시간 이벤트 (ack 없음, 초당 약 60회 제한) */
  stream(event: string, fn: (c: Ctx, payload: unknown) => void): void;
}

export function createRouter(socket: Socket, io: Server, getRoom: (code: string) => Room | undefined): Router {
  const data = socket.data as SocketData;
  data.dragLimit = new RateLimiter(60, 90);
  data.actionLimit = new RateLimiter(15, 30);

  const ctx = (): Ctx | null => {
    if (!data.code || !data.pid) return null;
    const room = getRoom(data.code);
    const player = room?.players.get(data.pid);
    if (!room || !player) return null;
    return { room, player };
  };

  const on = (event: string, fn: Handler) => {
    socket.on(event, (payload: unknown, ack?: Ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        if (!data.actionLimit.take()) return reply({ ok: false, error: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요" });
        const c = ctx();
        if (!c) return reply({ ok: false, error: "방에 접속해 있지 않아요" });
        const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
        const r = fn(c, p);
        if (typeof r === "string") reply({ ok: false, error: r });
        else if (r && typeof r === "object") reply({ ok: true, ...(r as object) });
        else reply({ ok: true });
      } catch (e) {
        console.error(`[error] ${event}`, e);
        reply({ ok: false, error: "서버 오류가 발생했어요" });
      }
    });
  };

  const hostOnly = (event: string, fn: Handler) => on(event, (c, p) => (c.room.isHost(c.player.id) ? fn(c, p) : "방장만 할 수 있어요"));

  const stream = (event: string, fn: (c: Ctx, payload: unknown) => void) => {
    socket.on(event, (payload: unknown) => {
      if (!data.dragLimit.take()) return;
      const c = ctx();
      if (!c) return;
      try {
        fn(c, payload);
      } catch (e) {
        console.error(`[error] ${event}`, e);
      }
    });
  };

  return { socket, io, data, ctx, on, hostOnly, stream };
}
