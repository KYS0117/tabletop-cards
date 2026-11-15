// =====================================================================
// 게임방 목록 관리 + 방 입장/퇴장/방장 관리 (모든 게임 공통 "코어")
// - 카드 조작 같은 기능별 이벤트는 handlers/*.ts 모듈이 등록합니다 (modules.ts 참고).
// =====================================================================
import type { Server, Socket } from "socket.io";
import { MAX_PLAYERS } from "../../shared/protocol";
import { trackSocket, type ServerCounts } from "./metrics";
import { HANDLER_MODULES } from "./modules";
import { Room, type IPlayer } from "./room";
import { createRouter, type Ack, type SocketData } from "./router";
import { cleanText, isId, newRoomCode } from "./util";

const EMPTY_ROOM_TTL_MS = 30 * 60_000; // 아무도 없으면 30분 뒤 방 삭제
const HOST_AWAY_MS = 20_000; // 방장이 20초 이상 끊겨 있으면 방장 이전
const PLAYER_AWAY_MS = 30 * 60_000; // 30분 넘게 안 돌아오면 자리 정리

export class RoomManager {
  rooms = new Map<string, Room>();

  constructor(private io: Server) {
    setInterval(() => this.sweep(), 2000).unref?.();
  }

  private sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.tick();
      if (room.hostAwaySince && now - room.hostAwaySince > HOST_AWAY_MS && room.connectedCount() > 0) {
        room.transferHost();
        room.roomChanged();
      }
      for (const p of [...room.players.values()]) {
        if (!p.connected && p.disconnectedAt && now - p.disconnectedAt > PLAYER_AWAY_MS) room.removePlayer(p, "오래 접속하지 않아 자리가 정리됐어요");
      }
      if (room.connectedCount() === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(room.code);
        console.log(`[room] ${room.code} 삭제 (비어 있음)`);
      }
    }
  }

  private createRoom(name: string): Room {
    let code = newRoomCode();
    while (this.rooms.has(code)) code = newRoomCode();
    const room = new Room(this.io, code, name);
    this.rooms.set(code, room);
    console.log(`[room] ${code} 생성`);
    return room;
  }

  /** 서버 전체 숫자 (개발자 측정용) */
  counts(): ServerCounts {
    let players = 0;
    let objects = 0;
    for (const r of this.rooms.values()) {
      players += r.connectedCount();
      objects += r.objs.size;
    }
    return { rooms: this.rooms.size, connections: this.io.sockets.sockets.size, players, objects };
  }

  handle(socket: Socket) {
    trackSocket(socket);
    const r = createRouter(socket, this.io, (code) => this.rooms.get(code));
    const data: SocketData = r.data;
    const ctx = r.ctx;
    const on = r.on;
    const hostOnly = r.hostOnly;

    const leaveCurrent = () => {
      const c = ctx();
      if (c) {
        socket.leave(c.room.code);
        socket.leave(`p:${c.player.id}`);
        c.room.detachSocket(c.player, socket.id);
      }
      data.code = undefined;
      data.pid = undefined;
    };

    // ---------------- 방 만들기 / 참가 ----------------
    socket.on("room:create", (payload: unknown, ack?: Ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const p = (payload ?? {}) as Record<string, unknown>;
      const nickname = cleanText(p.nickname, 16);
      if (!nickname) return reply({ ok: false, error: "닉네임을 입력해 주세요" });
      const tabId = isId(p.tabId) ? p.tabId : "";
      leaveCurrent();
      const room = this.createRoom(cleanText(p.roomName, 24) || `${nickname}의 테이블`);
      const player = room.addPlayer(nickname, tabId)!;
      data.code = room.code;
      data.pid = player.id;
      reply({ ok: true, code: room.code, playerId: player.id, token: player.token });
      room.attachSocket(player, socket);
    });

    socket.on("room:join", (payload: unknown, ack?: Ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const p = (payload ?? {}) as Record<string, unknown>;
      const code = typeof p.code === "string" ? p.code.trim().toUpperCase() : "";
      const room = this.rooms.get(code);
      if (!room) return reply({ ok: false, error: "방을 찾을 수 없어요. 코드를 확인해 주세요 (서버가 재시작되면 방이 사라져요)" });
      const tabId = isId(p.tabId) ? p.tabId : "";
      const nickname = cleanText(p.nickname, 16);
      let player: IPlayer | undefined | null = typeof p.token === "string" ? room.findByToken(p.token) : undefined;
      // 같은 토큰이라도 다른 탭에서 이미 접속 중이면 새 플레이어로 취급 (탭 여러 개 지원)
      if (player && player.connected && player.tabId !== tabId && tabId) player = undefined;
      leaveCurrent();
      if (player) {
        player.tabId = tabId || player.tabId;
        // 같은 탭의 이전 연결이 아직 남아 있으면 정리
        for (const sid of [...player.sockets]) {
          if (sid !== socket.id) {
            player.sockets.delete(sid);
            this.io.sockets.sockets.get(sid)?.disconnect(true);
          }
        }
        if (nickname) player.nickname = nickname;
      } else {
        if (!nickname) return reply({ ok: false, error: "닉네임을 입력해 주세요" });
        player = room.addPlayer(nickname, tabId);
        if (!player) return reply({ ok: false, error: `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명)` });
      }
      data.code = room.code;
      data.pid = player.id;
      reply({ ok: true, code: room.code, playerId: player.id, token: player.token });
      room.attachSocket(player, socket);
    });

    on("room:leave", (c) => {
      socket.leave(c.room.code);
      socket.leave(`p:${c.player.id}`);
      c.player.sockets.delete(socket.id);
      for (const sid of c.player.sockets) this.io.sockets.sockets.get(sid)?.disconnect(true);
      c.room.removePlayer(c.player, "나갔어요");
      data.code = undefined;
      data.pid = undefined;
    });

    socket.on("disconnect", () => leaveCurrent());

    // ---------------- 기능 모듈 (카드 조작, 개발자 측정, 앞으로 추가될 게임들) ----------------
    for (const m of HANDLER_MODULES) m.register(r, { counts: () => this.counts() });

    // ---------------- 방장 관리 (모든 게임 공통) ----------------
    hostOnly("host:settings", (c, p) => c.room.updateSettings(p));
    hostOnly("host:kick", (c, p) => {
      if (!isId(p.playerId) || p.playerId === c.player.id) return "잘못된 요청이에요";
      const target = c.room.players.get(p.playerId);
      if (!target) return "플레이어를 찾을 수 없어요";
      this.io.to(`p:${target.id}`).emit("kicked", { reason: "방장이 내보냈어요" });
      for (const sid of [...target.sockets]) {
        const s = this.io.sockets.sockets.get(sid);
        if (s) {
          s.leave(c.room.code);
          s.leave(`p:${target.id}`);
          (s.data as SocketData).code = undefined;
          (s.data as SocketData).pid = undefined;
        }
      }
      target.sockets.clear();
      c.room.removePlayer(target, "방에서 내보내졌어요");
    });
  }
}
