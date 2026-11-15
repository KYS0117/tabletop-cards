// =====================================================================
// 게임방 목록 관리 + 소켓 이벤트 처리
// =====================================================================
import type { Server, Socket } from "socket.io";
import { MAX_IDS_PER_REQUEST, type DeckType, type Move } from "../../shared/protocol";
import { Room, type IPlayer } from "./room";
import { cleanText, idList, isFiniteNum, isId, newRoomCode, RateLimiter } from "./util";

const EMPTY_ROOM_TTL_MS = 30 * 60_000; // 아무도 없으면 30분 뒤 방 삭제
const HOST_AWAY_MS = 20_000; // 방장이 20초 이상 끊겨 있으면 방장 이전
const PLAYER_AWAY_MS = 30 * 60_000; // 30분 넘게 안 돌아오면 자리 정리

interface SocketData {
  code?: string;
  pid?: string;
  dragLimit: RateLimiter;
  actionLimit: RateLimiter;
}

type Ack = (res: unknown) => void;

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

  handle(socket: Socket) {
    const data = socket.data as SocketData;
    data.dragLimit = new RateLimiter(60, 90);
    data.actionLimit = new RateLimiter(15, 30);

    const ctx = (): { room: Room; player: IPlayer } | null => {
      if (!data.code || !data.pid) return null;
      const room = this.rooms.get(data.code);
      const player = room?.players.get(data.pid);
      if (!room || !player) return null;
      return { room, player };
    };

    /** 일반 요청 처리 도우미: 방/플레이어 확인 + 요청 수 제한 + 예외 처리 */
    const on = (event: string, fn: (c: { room: Room; player: IPlayer }, payload: Record<string, unknown>) => unknown) => {
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

    const hostOnly = (event: string, fn: (c: { room: Room; player: IPlayer }, p: Record<string, unknown>) => unknown) =>
      on(event, (c, p) => (c.room.isHost(c.player.id) ? fn(c, p) : "방장만 할 수 있어요"));

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
        if (!player) return reply({ ok: false, error: "방이 가득 찼어요 (최대 6명)" });
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

    // ---------------- 실시간 이동 (빈도 높음) ----------------
    socket.on("obj:drag", (payload: unknown) => {
      if (!data.dragLimit.take()) return;
      const c = ctx();
      if (!c) return;
      const moves = (payload as { moves?: unknown })?.moves;
      if (!Array.isArray(moves)) return;
      const ok = c.room.drag(c.player.id, moves as Move[]);
      if (ok.length) socket.volatile.to(c.room.code).emit("obj:moving", { by: c.player.id, moves: ok });
    });

    socket.on("cursor", (payload: unknown) => {
      if (!data.dragLimit.take()) return;
      const c = ctx();
      if (!c) return;
      const p = payload as { x?: unknown; y?: unknown };
      if (!isFiniteNum(p?.x) || !isFiniteNum(p?.y)) return;
      socket.volatile.to(c.room.code).emit("cursor", { by: c.player.id, x: Math.round(p.x), y: Math.round(p.y) });
    });

    // ---------------- 카드 조작 ----------------
    const ids = (p: Record<string, unknown>) => idList(p.ids, MAX_IDS_PER_REQUEST);

    on("obj:grab", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      return { granted: c.room.grab(c.player.id, list) };
    });
    on("obj:release", (c, p) => {
      if (!Array.isArray(p.moves) || p.moves.length > MAX_IDS_PER_REQUEST) return "잘못된 요청이에요";
      const moves = (p.moves as unknown[]).filter((m): m is Move => !!m && typeof m === "object" && isId((m as Move).id));
      const merge = isId(p.mergeInto) ? p.mergeInto : null;
      return c.room.release(c.player.id, moves, merge);
    });
    on("obj:flip", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      c.room.flip(c.player.id, list);
    });
    on("obj:rotate", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      if (!c.room.rotate(c.player.id, list, p.delta as number)) return "회전 값이 올바르지 않아요";
    });
    on("obj:toTop", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      c.room.toTop(c.player.id, list);
    });
    on("obj:arrange", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      c.room.arrange(c.player.id, list);
    });
    on("obj:duplicate", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      return c.room.duplicate(c.player.id, list) ?? undefined;
    });
    on("obj:delete", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      return c.room.remove(c.player.id, list) ?? undefined;
    });

    // ---------------- 더미 ----------------
    on("stack:take", (c, p) => {
      if (!isId(p.stackId)) return "잘못된 요청이에요";
      const r = c.room.takeTop(c.player.id, p.stackId);
      return typeof r === "string" ? r : { card: r };
    });
    on("stack:draw", (c, p) => {
      if (!isId(p.stackId)) return "잘못된 요청이에요";
      return c.room.drawToHand(c.player, p.stackId, Number(p.count) || 1) ?? undefined;
    });
    on("stack:deal", (c, p) => {
      if (!isId(p.stackId)) return "잘못된 요청이에요";
      return c.room.deal(c.player.id, p.stackId, Number(p.count) || 1) ?? undefined;
    });
    on("stack:shuffle", (c, p) => {
      if (!isId(p.stackId)) return "잘못된 요청이에요";
      return c.room.shuffle(c.player.id, p.stackId) ?? undefined;
    });
    on("stack:spread", (c, p) => {
      if (!isId(p.stackId)) return "잘못된 요청이에요";
      return c.room.spread(c.player.id, p.stackId) ?? undefined;
    });
    on("stack:create", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      return c.room.createStack(c.player.id, list) ?? undefined;
    });

    // ---------------- 손패 ----------------
    on("hand:take", (c, p) => {
      const list = ids(p);
      if (!list) return "잘못된 요청이에요";
      return c.room.handTake(c.player, list) ?? undefined;
    });
    on("hand:play", (c, p) => {
      if (!isId(p.cardId)) return "잘못된 요청이에요";
      const r = c.room.handPlay(c.player, p.cardId, p.x as number, p.y as number, !!p.faceUp, !!p.grab);
      return typeof r === "string" ? r : { card: r };
    });
    on("hand:reorder", (c, p) => {
      const list = idList(p.order, 500);
      if (!list) return "잘못된 요청이에요";
      if (!c.room.handReorder(c.player, list)) return "손패 순서가 맞지 않아요";
    });

    // ---------------- 방장 ----------------
    hostOnly("host:reset", (c) => c.room.reset());
    hostOnly("host:gather", (c) => c.room.gather());
    hostOnly("host:newDeck", (c, p) => {
      const deck: DeckType = p.deck === "amumal" ? "amumal" : "standard54";
      c.room.newDeck(deck);
    });
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
