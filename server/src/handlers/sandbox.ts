// =====================================================================
// 기능 모듈: 자유 테이블(샌드박스) 카드 조작
// - 기존 rooms.ts 에 있던 카드/더미/손패 이벤트를 그대로 옮긴 것입니다 (동작 변경 없음).
// - 실제 로직은 room.ts 의 Room 메서드에 있고, 여기서는 입력값 검증과 연결만 합니다.
// =====================================================================
import { MAX_IDS_PER_REQUEST, type DeckType, type Move } from "../../../shared/protocol";
import type { Router } from "../router";
import { applyPreset } from "../presets";
import { idList, isFiniteNum, isId } from "../util";

export function registerSandboxHandlers(r: Router) {
  // ---------------- 실시간 이동 (빈도 높음) ----------------
  r.stream("obj:drag", (c, payload) => {
    const moves = (payload as { moves?: unknown })?.moves;
    if (!Array.isArray(moves)) return;
    const ok = c.room.drag(c.player.id, moves as Move[]);
    // volatile: 연결이 밀리면 오래된 위치는 버림 (최신 위치만 의미 있음)
    if (ok.length) r.socket.volatile.to(c.room.code).emit("obj:moving", { by: c.player.id, moves: ok });
  });

  r.stream("cursor", (c, payload) => {
    const p = payload as { x?: unknown; y?: unknown };
    if (!isFiniteNum(p?.x) || !isFiniteNum(p?.y)) return;
    r.socket.volatile.to(c.room.code).emit("cursor", { by: c.player.id, x: Math.round(p.x), y: Math.round(p.y) });
  });

  // ---------------- 카드 조작 ----------------
  const ids = (p: Record<string, unknown>) => idList(p.ids, MAX_IDS_PER_REQUEST);

  r.on("obj:grab", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    return { granted: c.room.grab(c.player.id, list) };
  });
  r.on("obj:release", (c, p) => {
    if (!Array.isArray(p.moves) || p.moves.length > MAX_IDS_PER_REQUEST) return "잘못된 요청이에요";
    const moves = (p.moves as unknown[]).filter((m): m is Move => !!m && typeof m === "object" && isId((m as Move).id));
    const merge = isId(p.mergeInto) ? p.mergeInto : null;
    return c.room.release(c.player.id, moves, merge);
  });
  r.on("obj:flip", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    return c.room.flip(c.player.id, list) ?? undefined;
  });
  r.on("obj:rotate", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    return c.room.rotate(c.player.id, list, p.delta as number) ?? undefined;
  });
  r.on("obj:toTop", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    c.room.toTop(c.player.id, list);
  });
  r.on("obj:arrange", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    c.room.arrange(c.player.id, list);
  });
  r.on("obj:duplicate", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    return c.room.duplicate(c.player.id, list) ?? undefined;
  });
  r.on("obj:delete", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    return c.room.remove(c.player.id, list) ?? undefined;
  });
  r.on("obj:shake", (c, p) => {
    if (!isId(p.id)) return "잘못된 요청이에요";
    return c.room.shakeGather(c.player.id, p.id, Number(p.x), Number(p.y));
  });
  r.on("obj:pin", (c, p) => {
    const list = ids(p);
    if (!list || typeof p.pinned !== "boolean") return "잘못된 요청이에요";
    return c.room.setPinned(c.player.id, list, p.pinned) ?? undefined;
  });
  r.on("obj:peek", (c, p) => {
    if (!isId(p.id)) return "잘못된 요청이에요";
    return c.room.peek(c.player, p.id) ?? undefined;
  });

  // ---------------- 더미 ----------------
  r.on("stack:take", (c, p) => {
    if (!isId(p.stackId)) return "잘못된 요청이에요";
    const r = c.room.takeTop(c.player.id, p.stackId);
    return typeof r === "string" ? r : { card: r };
  });
  r.on("stack:draw", (c, p) => {
    if (!isId(p.stackId)) return "잘못된 요청이에요";
    return c.room.drawToHand(c.player, p.stackId, Number(p.count) || 1) ?? undefined;
  });
  r.on("stack:deal", (c, p) => {
    if (!isId(p.stackId)) return "잘못된 요청이에요";
    return c.room.deal(c.player.id, p.stackId, Number(p.count) || 1) ?? undefined;
  });
  r.on("stack:shuffle", (c, p) => {
    if (!isId(p.stackId)) return "잘못된 요청이에요";
    return c.room.shuffle(c.player.id, p.stackId) ?? undefined;
  });
  r.on("stack:spread", (c, p) => {
    if (!isId(p.stackId)) return "잘못된 요청이에요";
    return c.room.spread(c.player.id, p.stackId) ?? undefined;
  });
  r.on("stack:create", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    return c.room.createStack(c.player.id, list) ?? undefined;
  });

  // ---------------- 손패 ----------------
  r.on("hand:take", (c, p) => {
    const list = ids(p);
    if (!list) return "잘못된 요청이에요";
    return c.room.handTake(c.player, list) ?? undefined;
  });
  r.on("hand:play", (c, p) => {
    if (!isId(p.cardId)) return "잘못된 요청이에요";
    const r = c.room.handPlay(c.player, p.cardId, p.x as number, p.y as number, !!p.faceUp, !!p.grab);
    return typeof r === "string" ? r : { card: r };
  });
  r.on("hand:reorder", (c, p) => {
    const list = idList(p.order, 500);
    if (!list) return "잘못된 요청이에요";
    if (!c.room.handReorder(c.player, list)) return "손패 순서가 맞지 않아요";
  });

  // ---------------- 방장 ----------------
  // 초기화 = 지금 선택된 게임을 처음 상태로 다시 준비
  r.hostOnly("host:reset", (c) => applyPreset(c.room, c.room.preset, c.player.nickname) ?? undefined);
  r.hostOnly("host:gather", (c) => c.room.gather());
  r.hostOnly("host:newDeck", (c, p) => {
    const deck: DeckType = p.deck === "uno108" || p.deck === "propose" || p.deck === "cockroach" ? p.deck : "standard54";
    return c.room.newDeck(deck) ?? undefined;
  });
}
