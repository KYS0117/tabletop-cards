// =====================================================================
// 테이블 화면 + 모든 마우스/터치 조작
//
// [PC]   왼쪽 드래그: 카드 집기/이동 · 빈 곳 드래그: 화면 이동 · Shift+빈 곳 드래그: 영역 선택
//        Shift+클릭: 여러 장 선택 · 더블클릭: 뒤집기 · Q/E: 15° 회전 · F: 뒤집기 · Delete: 삭제
//        우클릭: 메뉴 · 휠: 확대/축소 · 더미를 끌면 맨 위 1장, 더미 모서리 손잡이(⠿)를 끌면 더미 전체
//        더미를 꾹(약 0.4초) 누른 채 끌면 더미 전체 이동
// [모바일] 한 손가락 드래그: 카드 이동(빈 곳이면 화면 이동) · 더블탭: 뒤집기 · 길게 누르기: 메뉴
//        더미를 꾹 누르면 들리고 → 그대로 끌면 더미 전체 이동, 움직이지 않고 떼면 메뉴
// [공통] 🔒 잠긴 카드/더미는 끌면 화면이 이동 (잠긴 더미에서 한 장 뽑기는 가능)
//        두 손가락: 확대/축소 + 화면 이동 · "다중 선택" 모드: 탭으로 여러 장 선택, 빈 곳 드래그로 영역 선택
//
// 모든 위치는 테이블 좌표(월드 좌표)로 서버에 보내므로 화면 크기·확대 배율과 상관없이 모두에게 같은 자리에 보입니다.
// =====================================================================
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { cardSize, TABLE_H, TABLE_W, type HandCard, type Move, type PubCard, type PubObj } from "../../shared/protocol";
import * as anim from "./anim";
import { buildActions, type Action } from "./actions";
import { CardFace } from "./CardFace";
import { Banner, ClaimPanel, CustomCardModal, GameBar, GameSelectModal, PeekModal, UnoButton } from "./gametools";
import { act, ensureObject, onCursor, request, sendVolatile } from "./net";
import { count, recordTableRender } from "./perf";
import { getPrefs, setPrefs, usePrefs } from "./prefs";
import * as sound from "./sound";
import { getState, myId, playerById, setState, toast, useStore } from "./store";
import { ActionBar, BottomBar, ConfirmModal, ContextMenu, HelpModal, PromptModal, SettingsModal, Toasts, TopBar } from "./ui";

type Target = { t: "obj"; id: string } | { t: "grip"; id: string } | { t: "empty" } | { t: "hand"; id: string };

type G =
  | { kind: "none" }
  | { kind: "press"; pid: number; sx: number; sy: number; target: Target; shift: boolean; touch: boolean; button: number; held?: boolean }
  | { kind: "drag"; pid: number; ids: string[]; off: Map<string, { dx: number; dy: number }>; primary: string; lastSent: number; cx: number; cy: number }
  | { kind: "pending"; pid: number; what: "take" | "play"; off: { dx: number; dy: number }; cx: number; cy: number; released: boolean; seq: number }
  | { kind: "handDrag"; pid: number; cardId: string; cx: number; cy: number; gx: number; gy: number }
  | { kind: "pan"; pid: number; sx: number; sy: number; camX: number; camY: number }
  | { kind: "select"; pid: number; wx: number; wy: number; additive: boolean }
  | { kind: "pinch"; a: number; b: number; d0: number; z0: number; ax: number; ay: number };

interface Cam {
  x: number;
  y: number;
  z: number;
}

const DRAG_SEND_MS = 40; // 드래그 위치 전송 간격 (초당 약 25회)
const CURSOR_SEND_MS = 90;
const LONG_PRESS_MS = 520;
const DECK_HOLD_MS = 400; // 더미를 이만큼 누르고 있으면 "더미 전체 들기"

/** 카드/더미의 실제 크기 (세로형/가로형) */
const sizeOf = (o: { shape?: PubObj["shape"] } | undefined, scale = getState().room?.settings.cardScale ?? 1) => cardSize(scale, o?.shape);

let pendingSeq = 0;

export function Table() {
  const renderStart = performance.now();
  count("tableRenders");
  const st = useStore();
  const prefs = usePrefs();
  const room = st.room!;
  const me = st.session?.playerId ?? "";
  const scale = room.settings.cardScale;

  const viewRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const handCardsRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, z: 0.4 });
  const g = useRef<G>({ kind: "none" });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const longTimer = useRef<number | null>(null);
  const lastTap = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  const lastCursor = useRef(0);
  const lastPinToast = useRef(0);
  const fitted = useRef(false);

  // 개발자 성능 창: 테이블 렌더+커밋에 걸린 시간 기록 (의존성 없음 = 매 커밋마다 실행)
  useLayoutEffect(() => {
    recordTableRender(performance.now() - renderStart);
  });

  const [selection, setSelectionState] = useState<Set<string>>(new Set());
  const selRef = useRef(selection);
  const setSelection = useCallback((s: Set<string>) => {
    selRef.current = s;
    setSelectionState(s);
  }, []);
  const [dragging, setDragging] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const mergeRef = useRef<string | null>(null);
  const [handHover, setHandHover] = useState(false);
  const handHoverRef = useRef(false);
  const [selRect, setSelRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [placeholder, setPlaceholder] = useState<{ face: string | null; back: PubObj["back"]; shape?: PubObj["shape"] } | null>(null);
  const [liftId, setLiftId] = useState<string | null>(null); // 꾹 눌러서 들린 더미
  const [ghost, setGhost] = useState<HandCard | null>(null);
  const [handInsert, setHandInsert] = useState<number | null>(null);
  const [handDragId, setHandDragId] = useState<string | null>(null);
  const [multiMode, setMultiMode] = useState(false);
  const multiRef = useRef(false);
  multiRef.current = multiMode;
  const [menu, setMenu] = useState<{ x: number; y: number; actions: Action[]; title?: string } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; max: number; def: number; onOk: (n: number) => void } | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; onOk: () => void } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(!getPrefs().helpSeen);
  const [showGame, setShowGame] = useState(false);
  const [custom, setCustom] = useState<{ stackId?: string } | null>(null);
  const [handW, setHandW] = useState(600);
  const [zoomPct, setZoomPct] = useState(40);

  // ------------------------------------------------------------------
  // 카메라 (확대/축소/이동)
  // ------------------------------------------------------------------
  const applyCam = useCallback(() => {
    const c = cam.current;
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`;
      worldRef.current.style.setProperty("--z", String(c.z));
    }
    setZoomPct(Math.round(c.z * 100));
  }, []);

  const viewInsets = () => {
    const top = 56;
    // 손패 + 선택 동작 바가 차지하는 높이 (동작 바가 없어도 나타날 자리를 미리 확보)
    const b = bottomRef.current?.getBoundingClientRect();
    const handH = handRef.current?.getBoundingClientRect().height ?? 120;
    const bottomH = Math.max(b ? b.height : 0, handH);
    return { top, bottom: bottomH + 8 };
  };

  const clampCam = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    const r = v.getBoundingClientRect();
    const c = cam.current;
    c.z = Math.max(0.12, Math.min(3, c.z));
    const keep = 120;
    c.x = Math.max(keep - TABLE_W * c.z, Math.min(r.width - keep, c.x));
    c.y = Math.max(keep - TABLE_H * c.z, Math.min(r.height - keep, c.y));
  }, []);

  /** 화면 맞춤: 카드가 있는 영역을 보기 좋게 (없거나 all=true 이면 테이블 전체) */
  const fit = useCallback(
    (all = false) => {
      const v = viewRef.current;
      if (!v) return;
      const r = v.getBoundingClientRect();
      const ins = viewInsets();
      const availW = Math.max(100, r.width - 24);
      const availH = Math.max(100, r.height - ins.top - ins.bottom);
      let box = { x0: 0, y0: 0, x1: TABLE_W, y1: TABLE_H };
      const objs = [...getState().objects.values()];
      if (!all && objs.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const o of objs) {
          const { w, h } = sizeOf(o);
          x0 = Math.min(x0, o.x - w);
          y0 = Math.min(y0, o.y - h);
          x1 = Math.max(x1, o.x + w);
          y1 = Math.max(y1, o.y + h);
        }
        // 너무 좁게 확대되지 않도록 최소 크기 확보
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const bw = Math.max(x1 - x0, 900), bh = Math.max(y1 - y0, 560);
        box = { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
      }
      const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
      const z = Math.max(0.12, Math.min(1.2, Math.min(availW / bw, availH / bh)));
      cam.current = { z, x: (r.width - bw * z) / 2 - box.x0 * z, y: ins.top + (availH - bh * z) / 2 - box.y0 * z };
      clampCam();
      applyCam();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyCam, clampCam],
  );

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = viewRef.current!.getBoundingClientRect();
    const c = cam.current;
    return { x: (cx - r.left - c.x) / c.z, y: (cy - r.top - c.y) / c.z };
  }, []);

  const zoomAt = useCallback(
    (cx: number, cy: number, nz: number) => {
      const r = viewRef.current!.getBoundingClientRect();
      const c = cam.current;
      const w = toWorld(cx, cy);
      c.z = Math.max(0.12, Math.min(3, nz));
      c.x = cx - r.left - w.x * c.z;
      c.y = cy - r.top - w.y * c.z;
      clampCam();
      applyCam();
    },
    [toWorld, clampCam, applyCam],
  );

  // 처음 한 번 화면 맞춤 + 창 크기가 바뀌면 화면 중앙의 테이블 지점을 유지
  useLayoutEffect(() => {
    const v = viewRef.current!;
    let last = v.getBoundingClientRect();
    if (!fitted.current) {
      fit();
      fitted.current = true;
    }
    const ro = new ResizeObserver(() => {
      const r = v.getBoundingClientRect();
      const c = cam.current;
      const wx = (last.width / 2 - c.x) / c.z;
      const wy = (last.height / 2 - c.y) / c.z;
      c.x = r.width / 2 - wx * c.z;
      c.y = r.height / 2 - wy * c.z;
      last = r;
      clampCam();
      applyCam();
    });
    ro.observe(v);
    return () => ro.disconnect();
  }, [fit, clampCam, applyCam]);

  useLayoutEffect(() => {
    const el = handCardsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHandW(el.getBoundingClientRect().width));
    ro.observe(el);
    setHandW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [prefs.handCollapsed]);

  // 휠 확대/축소 (passive:false 로 페이지 스크롤 막기)
  useEffect(() => {
    const v = viewRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(e.clientX, e.clientY, cam.current.z * factor);
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    // iOS Safari 의 화면 확대 제스처 막기
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    return () => {
      v.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
    };
  }, [zoomAt]);

  // ------------------------------------------------------------------
  // 도우미
  // ------------------------------------------------------------------
  const objOf = (id: string) => getState().objects.get(id);
  const lockedByOther = (o: PubObj | undefined) => !!o && !!o.lockedBy && o.lockedBy !== myId();

  const overHand = (cx: number, cy: number) => {
    const r = handRef.current?.getBoundingClientRect();
    return !!r && cx >= r.left && cx <= r.right && cy >= r.top - 6 && cy <= r.bottom;
  };

  const findMergeTarget = (ids: string[], px: number, py: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const o of getState().objects.values()) {
      if (o.kind !== "stack" || ids.includes(o.id) || lockedByOther(o)) continue;
      const { w, h } = sizeOf(o);
      const dx = Math.abs(o.x - px);
      const dy = Math.abs(o.y - py);
      if (dx < w * 0.5 && dy < h * 0.5 && dx + dy < bestD) {
        best = o.id;
        bestD = dx + dy;
      }
    }
    return best;
  };

  const objectsAt = (wx: number, wy: number): PubObj[] => {
    return [...getState().objects.values()]
      .filter((o) => {
        const { w, h } = sizeOf(o);
        // 회전을 고려한 판정
        const rad = (-o.rot * Math.PI) / 180;
        const dx = wx - o.x;
        const dy = wy - o.y;
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
        return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
      })
      .sort((a, b) => b.z - a.z);
  };

  const clearLongPress = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const openPrompt = useCallback((title: string, max: number, def: number, onOk: (n: number) => void) => setPrompt({ title, max, def, onOk }), []);

  const openMenuFor = useCallback(
    (cx: number, cy: number, target: Target) => {
      const w = toWorld(cx, cy);
      if (target.t === "obj" || target.t === "grip") {
        let ids = [...selRef.current];
        if (!selRef.current.has(target.id)) {
          ids = [target.id];
          setSelection(new Set(ids));
        }
        const under = objectsAt(w.x, w.y);
        const selectBelow =
          under.length > 1
            ? () => {
                const idx = under.findIndex((o) => o.id === target.id);
                const next = under[(idx + 1) % under.length];
                setSelection(new Set([next.id]));
              }
            : undefined;
        const actions = buildActions({ ids, openPrompt, clearSelection: () => setSelection(new Set()), selectBelow, openCustom: (stackId) => setCustom({ stackId }) });
        if (!actions.length) {
          toast("다른 사람이 잡고 있는 카드예요", "warn");
          return;
        }
        const o = objOf(target.id);
        const title = ids.length > 1 ? `${ids.length}개 선택됨` : o?.kind === "stack" ? `더미 (${o.count}장)` : "카드";
        setMenu({ x: cx, y: cy, actions, title });
      } else {
        const actions: Action[] = [
          { key: "fit", label: "카드가 있는 곳 보기", icon: "⤢", run: () => fit() },
          { key: "fitAll", label: "테이블 전체 보기", icon: "🔭", run: () => fit(true) },
        ];
        if (selRef.current.size) actions.push({ key: "clear", label: "선택 해제", icon: "✕", run: () => setSelection(new Set()) });
        actions.push({ key: "custom", label: "직접 쓰는 카드 만들기…", icon: "✍", run: () => setCustom({}) });
        if (getState().room?.hostId === myId()) {
          actions.push(
            { key: "game", label: "게임 고르기…", icon: "🎲", run: () => setShowGame(true) },
            { key: "deck", label: "트럼프 54장 덱 추가", icon: "🂠", run: () => act("host:newDeck", { deck: "standard54" }) },
            { key: "deck2", label: "우노 덱 추가", icon: "🌈", run: () => act("host:newDeck", { deck: "uno108" }) },
            { key: "deck3", label: "프로포즈 카드 덱 추가", icon: "💍", run: () => act("host:newDeck", { deck: "propose" }) },
            { key: "deck4", label: "바퀴벌레 포커 덱 추가", icon: "🪳", run: () => act("host:newDeck", { deck: "cockroach" }) },
          );
        }
        setMenu({ x: cx, y: cy, actions, title: "테이블" });
      }
    },
    [toWorld, openPrompt, setSelection, fit],
  );

  // ------------------------------------------------------------------
  // 드래그 시작
  // ------------------------------------------------------------------
  const startDrag = (ids: string[], cx: number, cy: number, pid: number, primary: string) => {
    const me = myId();
    const usable = ids.filter((id) => {
      const o = objOf(id);
      return o && !o.pinned && !(o.lockedBy && o.lockedBy !== me);
    });
    if (!usable.includes(primary)) {
      const o = objOf(primary);
      toast(`${playerById(o?.lockedBy)?.nickname ?? "다른 사람"}님이 잡고 있어요`, "warn");
      g.current = { kind: "none" };
      return;
    }
    const w = toWorld(cx, cy);
    const off = new Map<string, { dx: number; dy: number }>();
    for (const id of usable) {
      const p = anim.shown(id) ?? objOf(id)!;
      off.set(id, { dx: p.x - w.x, dy: p.y - w.y });
      anim.setLocal(id, p.x, p.y);
    }
    g.current = { kind: "drag", pid, ids: usable, off, primary, lastSent: 0, cx, cy };
    setDragging(new Set(usable));
    sound.sfx("pick");
    request<"obj:grab", { granted: string[] }>("obj:grab", { ids: usable }).then((r) => {
      const cur = g.current;
      const granted = new Set(r.ok ? r.granted : []);
      const denied = usable.filter((id) => !granted.has(id));
      if (!denied.length) return;
      for (const id of denied) anim.clearLocal(id);
      if (cur.kind === "drag" && cur.ids === usable) {
        cur.ids = usable.filter((id) => granted.has(id));
        setDragging(new Set(cur.ids));
        if (!cur.ids.length) {
          g.current = { kind: "none" };
          toast(r.ok ? "다른 사람이 먼저 잡았어요" : r.error, "warn");
        }
      }
    });
  };

  /** 더미 맨 위 카드를 끌어 한 장 뽑기: 서버 응답 전까지는 임시 카드를 보여 줌 */
  const startTake = (s: PubObj, cx: number, cy: number, pid: number) => {
    if (s.kind !== "stack") return;
    if (s.count === 0) {
      // 빈 더미(버린 카드 자리 등)는 끌어도 아무것도 없음 → 화면 이동처럼 동작하지 않게 그냥 무시
      g.current = { kind: "none" };
      return;
    }
    if (lockedByOther(s)) {
      toast(`${playerById(s.lockedBy)?.nickname ?? "다른 사람"}님이 잡고 있어요`, "warn");
      g.current = { kind: "none" };
      return;
    }
    const w = toWorld(cx, cy);
    const seq = ++pendingSeq;
    g.current = { kind: "pending", pid, what: "take", off: { dx: s.x - w.x, dy: s.y - w.y }, cx, cy, released: false, seq };
    setPlaceholder({ face: s.faceUp ? s.top : null, back: s.back, shape: s.shape });
    sound.sfx("draw");
    movePlaceholder(cx, cy);
    request<"stack:take", { card: PubCard }>("stack:take", { stackId: s.id }).then((r) => onPendingResult(seq, r));
  };

  const onPendingResult = (seq: number, r: { ok: true; card: PubCard } | { ok: false; error: string }) => {
    const cur = g.current;
    const mine = cur.kind === "pending" && cur.seq === seq;
    setPlaceholder(null);
    setGhost(null);
    setHandDragId(null);
    if (!r.ok) {
      toast(r.error, "warn");
      if (mine) g.current = { kind: "none" };
      return;
    }
    ensureObject(r.card);
    const id = r.card.id;
    if (!mine) {
      // 이미 다른 동작으로 넘어간 경우: 그 자리에 내려놓기
      act("obj:release", { moves: [{ id, x: r.card.x, y: r.card.y }] });
      return;
    }
    const w = toWorld(cur.cx, cur.cy);
    const x = w.x + cur.off.dx;
    const y = w.y + cur.off.dy;
    if (cur.released) {
      g.current = { kind: "none" };
      anim.setTarget(id, x, y, r.card.rot);
      if (overHand(cur.cx, cur.cy)) act("hand:take", { ids: [id] });
      else {
        const mt = findMergeTarget([id], x, y);
        act("obj:release", { moves: [{ id, x, y }], mergeInto: mt });
      }
      return;
    }
    anim.setLocal(id, x, y);
    g.current = { kind: "drag", pid: cur.pid, ids: [id], off: new Map([[id, cur.off]]), primary: id, lastSent: 0, cx: cur.cx, cy: cur.cy };
    setDragging(new Set([id]));
    setSelection(new Set([id]));
  };

  const movePlaceholder = (cx: number, cy: number) => {
    const cur = g.current;
    const el = placeholderRef.current;
    if (!el || cur.kind !== "pending" || cur.what !== "take") return;
    const w = toWorld(cx, cy);
    el.style.transform = `translate3d(${w.x + cur.off.dx}px, ${w.y + cur.off.dy}px, 0) translate(-50%,-50%)`;
  };

  const moveGhost = (cx: number, cy: number, gx: number, gy: number) => {
    const el = ghostRef.current;
    if (el) el.style.transform = `translate3d(${cx - gx}px, ${cy - gy}px, 0)`;
  };

  useLayoutEffect(() => {
    const cur = g.current;
    if (placeholder && cur.kind === "pending") movePlaceholder(cur.cx, cur.cy);
    if (ghost && cur.kind === "handDrag") moveGhost(cur.cx, cur.cy, cur.gx, cur.gy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholder, ghost]);

  // ------------------------------------------------------------------
  // 드래그 중 / 끝
  // ------------------------------------------------------------------
  const moveDrag = (cx: number, cy: number) => {
    const cur = g.current;
    if (cur.kind !== "drag") return;
    cur.cx = cx;
    cur.cy = cy;
    const w = toWorld(cx, cy);
    const moves: Move[] = [];
    for (const id of cur.ids) {
      const o = cur.off.get(id)!;
      const x = w.x + o.dx;
      const y = w.y + o.dy;
      anim.setLocal(id, x, y);
      moves.push({ id, x, y });
    }
    const now = performance.now();
    if (now - cur.lastSent >= DRAG_SEND_MS) {
      cur.lastSent = now;
      sendVolatile("obj:drag", { moves });
    }
    const allCards = cur.ids.every((id) => objOf(id)?.kind === "card");
    const hh = allCards && overHand(cx, cy);
    if (hh !== handHoverRef.current) {
      handHoverRef.current = hh;
      setHandHover(hh);
    }
    const p = anim.shown(cur.primary);
    const mt = hh || !p ? null : findMergeTarget(cur.ids, p.x, p.y);
    if (mt !== mergeRef.current) {
      mergeRef.current = mt;
      setMergeTarget(mt);
    }
  };

  const endDrag = () => {
    const cur = g.current;
    if (cur.kind !== "drag") return;
    g.current = { kind: "none" };
    const w = toWorld(cur.cx, cur.cy);
    const moves: Move[] = cur.ids.map((id) => {
      const o = cur.off.get(id)!;
      return { id, x: w.x + o.dx, y: w.y + o.dy };
    });
    for (const m of moves) {
      const o = objOf(m.id);
      anim.setTarget(m.id, m.x, m.y, o?.rot ?? 0);
      anim.clearLocal(m.id);
      if (o) {
        o.x = m.x;
        o.y = m.y;
      }
    }
    const toHand = handHoverRef.current;
    const merge = mergeRef.current;
    handHoverRef.current = false;
    mergeRef.current = null;
    setHandHover(false);
    setMergeTarget(null);
    setDragging(new Set());
    sound.sfx(toHand ? "draw" : "place");
    if (toHand) {
      request("hand:take", { ids: cur.ids }).then((r) => {
        if (!r.ok) {
          toast(r.error, "warn");
          act("obj:release", { moves });
        } else setSelection(new Set());
      });
    } else {
      request("obj:release", { moves, mergeInto: merge }).then((r) => {
        if (!r.ok) toast(r.error, "warn");
        else if (merge) setSelection(new Set());
      });
    }
  };

  // ------------------------------------------------------------------
  // 손패에서 끌기
  // ------------------------------------------------------------------
  /** 손패 안에서 놓을 자리 (손패가 두 줄이면 가까운 줄 기준) */
  const handIndexAt = (cx: number, cy: number, dragId: string) => {
    const els = [...(handCardsRef.current?.querySelectorAll<HTMLElement>("[data-hid]") ?? [])].filter((e) => e.dataset.hid !== dragId);
    const info = els.map((e) => ({ row: Number(e.dataset.row ?? 0), r: e.getBoundingClientRect() }));
    let prow = 0;
    let best = Infinity;
    for (const { row, r } of info) {
      const d = Math.abs(cy - (r.top + r.height / 2));
      if (d < best) {
        best = d;
        prow = row;
      }
    }
    let i = 0;
    for (const { row, r } of info) if (row < prow || (row === prow && cx > r.left + r.width / 2)) i++;
    return i;
  };

  const moveHandDrag = (cx: number, cy: number) => {
    const cur = g.current;
    if (cur.kind !== "handDrag") return;
    cur.cx = cx;
    cur.cy = cy;
    moveGhost(cx, cy, cur.gx, cur.gy);
    const hr = handRef.current?.getBoundingClientRect();
    if (hr && cy < hr.top - 10) {
      // 손패 영역 밖으로 → 테이블에 내놓고 계속 끌기
      const w = toWorld(cx, cy);
      const seq = ++pendingSeq;
      const cardId = cur.cardId;
      const sc = cam.current.z;
      g.current = { kind: "pending", pid: cur.pid, what: "play", off: { dx: 0, dy: 0 }, cx, cy, released: false, seq };
      setHandInsert(null);
      // 손패 고스트를 테이블 카드 크기에 맞춰 줄이기
      const gh = ghostRef.current;
      const hc = getState().hand.find((h) => h.id === cardId);
      if (gh) gh.style.setProperty("--gscale", String((sizeOf(hc).w * sc) / gh.getBoundingClientRect().width));
      request<"hand:play", { card: PubCard }>("hand:play", { cardId, x: w.x, y: w.y, faceUp: !getPrefs().playFaceDown, grab: true }).then((r) =>
        onPendingResult(seq, r),
      );
      return;
    }
    setHandInsert(handIndexAt(cx, cy, cur.cardId));
  };

  const endHandDrag = () => {
    const cur = g.current;
    if (cur.kind !== "handDrag") return;
    g.current = { kind: "none" };
    const hand = getState().hand;
    const idx = handIndexAt(cur.cx, cur.cy, cur.cardId);
    setGhost(null);
    setHandInsert(null);
    setHandDragId(null);
    const rest = hand.filter((h) => h.id !== cur.cardId);
    const moved = hand.find((h) => h.id === cur.cardId);
    if (!moved) return;
    rest.splice(idx, 0, moved);
    if (rest.map((h) => h.id).join() !== hand.map((h) => h.id).join()) {
      setState({ hand: rest });
      act("hand:reorder", { order: rest.map((h) => h.id) });
    }
  };

  // ------------------------------------------------------------------
  // 포인터 이벤트
  // ------------------------------------------------------------------
  const startPinch = () => {
    const ids = [...pointers.current.keys()];
    const a = pointers.current.get(ids[0])!;
    const b = pointers.current.get(ids[1])!;
    clearLongPress();
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const w = toWorld(mid.x, mid.y);
    g.current = { kind: "pinch", a: ids[0], b: ids[1], d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.current.z, ax: w.x, ay: w.y };
  };

  const onViewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (menu) setMenu(null);
    if (e.button === 2) return; // 우클릭은 contextmenu 에서 처리
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      viewRef.current?.setPointerCapture(e.pointerId); // 카드가 사라져도 드래그가 끊기지 않도록
    } catch {
      /* 무시 */
    }
    const k = g.current.kind;
    if (pointers.current.size === 2 && (k === "press" || k === "pan" || k === "none" || k === "select")) {
      setSelRect(null);
      startPinch();
      return;
    }
    if (pointers.current.size > 1) return;
    const el = e.target as HTMLElement;
    const grip = el.closest<HTMLElement>("[data-grip]");
    const oel = el.closest<HTMLElement>("[data-oid]");
    const target: Target = grip ? { t: "grip", id: grip.dataset.grip! } : oel ? { t: "obj", id: oel.dataset.oid! } : { t: "empty" };
    const touch = e.pointerType !== "mouse";
    if (e.button === 1) {
      g.current = { kind: "pan", pid: e.pointerId, sx: e.clientX, sy: e.clientY, camX: cam.current.x, camY: cam.current.y };
      return;
    }
    g.current = { kind: "press", pid: e.pointerId, sx: e.clientX, sy: e.clientY, target, shift: e.shiftKey || e.ctrlKey || e.metaKey, touch, button: e.button };
    clearLongPress();
    const tobj = target.t === "obj" ? objOf(target.id) : undefined;
    if (tobj?.kind === "stack" && !tobj.pinned && e.button === 0) {
      // 더미 꾹 누르기 → 더미 전체 들기 (끌면 더미 전체 이동, 터치로 그냥 떼면 메뉴)
      const pid = e.pointerId;
      const sid = tobj.id;
      longTimer.current = window.setTimeout(() => {
        longTimer.current = null;
        const cur = g.current;
        if (cur.kind !== "press" || cur.pid !== pid) return;
        if (lockedByOther(objOf(sid))) return;
        cur.held = true;
        setLiftId(sid);
        navigator.vibrate?.(20);
        sound.sfx("pick", 0.6);
      }, DECK_HOLD_MS);
      return;
    }
    if (touch) {
      const sx = e.clientX;
      const sy = e.clientY;
      longTimer.current = window.setTimeout(() => {
        const cur = g.current;
        if (cur.kind === "press" && cur.pid === e.pointerId) {
          g.current = { kind: "none" };
          navigator.vibrate?.(15);
          openMenuFor(sx, sy, target);
        }
      }, LONG_PRESS_MS);
    }
  };

  const onHandPointerDown = (e: React.PointerEvent<HTMLDivElement>, cardId: string) => {
    e.stopPropagation();
    if (menu) setMenu(null);
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      handRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    g.current = { kind: "press", pid: e.pointerId, sx: e.clientX, sy: e.clientY, target: { t: "hand", id: cardId }, shift: false, touch: e.pointerType !== "mouse", button: 0 };
  };

  const beginFromPress = (cur: Extract<G, { kind: "press" }>, cx: number, cy: number) => {
    const tgt = cur.target;
    if (tgt.t === "empty") {
      if (cur.shift || multiRef.current) {
        const w = toWorld(cur.sx, cur.sy);
        g.current = { kind: "select", pid: cur.pid, wx: w.x, wy: w.y, additive: cur.shift || multiRef.current };
      } else g.current = { kind: "pan", pid: cur.pid, sx: cur.sx, sy: cur.sy, camX: cam.current.x, camY: cam.current.y };
      return;
    }
    if (tgt.t === "hand") {
      const card = getState().hand.find((h) => h.id === tgt.id);
      const el = handCardsRef.current?.querySelector<HTMLElement>(`[data-hid="${CSS.escape(tgt.id)}"]`);
      if (!card || !el) {
        g.current = { kind: "none" };
        return;
      }
      const r = el.getBoundingClientRect();
      g.current = { kind: "handDrag", pid: cur.pid, cardId: tgt.id, cx, cy, gx: cur.sx - r.left, gy: cur.sy - r.top };
      setGhost(card);
      setHandDragId(tgt.id);
      return;
    }
    const o = objOf(tgt.id);
    if (!o) {
      g.current = { kind: "none" };
      return;
    }
    const sel = selRef.current;
    // 🔒 잠긴 것: 낱장·손잡이·여러 장 끌기는 화면 이동으로 (잠긴 더미 본체를 끌면 한 장 뽑기는 그대로)
    if (o.pinned && (o.kind === "card" || tgt.t === "grip" || (sel.has(o.id) && sel.size > 1))) {
      const now = performance.now();
      if (now - lastPinToast.current > 2500) {
        lastPinToast.current = now;
        toast("🔒 잠겨 있어요 · 메뉴에서 잠금을 풀 수 있어요");
      }
      g.current = { kind: "pan", pid: cur.pid, sx: cur.sx, sy: cur.sy, camX: cam.current.x, camY: cam.current.y };
      return;
    }
    if (cur.held && o.kind === "stack") {
      setLiftId(null);
      setSelection(new Set([o.id]));
      startDrag([o.id], cur.sx, cur.sy, cur.pid, o.id);
      moveDrag(cx, cy);
      return;
    }
    if (tgt.t === "obj" && o.kind === "stack" && !(sel.has(o.id) && sel.size > 1)) {
      startTake(o, cur.sx, cur.sy, cur.pid);
      const p = g.current;
      if (p.kind === "pending") {
        p.cx = cx;
        p.cy = cy;
      }
      return;
    }
    let ids = [o.id];
    if (sel.has(o.id)) ids = [...sel].filter((id) => getState().objects.has(id));
    else setSelection(new Set([o.id]));
    startDrag(ids, cur.sx, cur.sy, cur.pid, o.id);
    moveDrag(cx, cy);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const cur = g.current;
      // 내 커서 위치를 다른 사람에게 (테이블 위에 있을 때만)
      const now = performance.now();
      if (now - lastCursor.current > CURSOR_SEND_MS && viewRef.current && !overHand(e.clientX, e.clientY)) {
        const r = viewRef.current.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          lastCursor.current = now;
          const w = toWorld(e.clientX, e.clientY);
          sendVolatile("cursor", { x: w.x, y: w.y });
        }
      }
      switch (cur.kind) {
        case "pinch": {
          const a = pointers.current.get(cur.a);
          const b = pointers.current.get(cur.b);
          if (!a || !b) return;
          const r = viewRef.current!.getBoundingClientRect();
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const c = cam.current;
          c.z = Math.max(0.12, Math.min(3, (cur.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / cur.d0));
          c.x = mid.x - r.left - cur.ax * c.z;
          c.y = mid.y - r.top - cur.ay * c.z;
          clampCam();
          applyCam();
          return;
        }
        case "press": {
          if (e.pointerId !== cur.pid) return;
          const dist = Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy);
          if (dist < (cur.touch ? 9 : 4)) return;
          clearLongPress();
          setLiftId(null);
          beginFromPress(cur, e.clientX, e.clientY);
          return;
        }
        case "drag":
          if (e.pointerId === cur.pid) moveDrag(e.clientX, e.clientY);
          return;
        case "pending":
          if (e.pointerId !== cur.pid) return;
          cur.cx = e.clientX;
          cur.cy = e.clientY;
          if (cur.what === "take") movePlaceholder(e.clientX, e.clientY);
          else {
            const gh = ghostRef.current;
            if (gh) moveGhost(e.clientX, e.clientY, gh.offsetWidth / 2, gh.offsetHeight / 2);
          }
          return;
        case "handDrag":
          if (e.pointerId === cur.pid) moveHandDrag(e.clientX, e.clientY);
          return;
        case "pan": {
          if (e.pointerId !== cur.pid) return;
          cam.current.x = cur.camX + (e.clientX - cur.sx);
          cam.current.y = cur.camY + (e.clientY - cur.sy);
          clampCam();
          applyCam();
          return;
        }
        case "select": {
          if (e.pointerId !== cur.pid) return;
          const w = toWorld(e.clientX, e.clientY);
          setSelRect({ x0: cur.wx, y0: cur.wy, x1: w.x, y1: w.y });
          return;
        }
      }
    };

    const onUp = (e: PointerEvent, cancelled: boolean) => {
      pointers.current.delete(e.pointerId);
      clearLongPress();
      const cur = g.current;
      switch (cur.kind) {
        case "pinch":
          if (pointers.current.size < 2) g.current = { kind: "none" };
          return;
        case "press": {
          if (e.pointerId !== cur.pid) return;
          g.current = { kind: "none" };
          setLiftId(null);
          if (cancelled) return;
          const tgt = cur.target;
          if (cur.held) {
            // 꾹 눌렀다가 움직이지 않고 뗌: 터치는 메뉴, 마우스는 선택만
            if (cur.touch) openMenuFor(e.clientX, e.clientY, tgt);
            else setSelection(new Set([tgt.t === "obj" || tgt.t === "grip" ? tgt.id : ""].filter(Boolean)));
            return;
          }
          if (tgt.t === "obj" || tgt.t === "grip") {
            const now = performance.now();
            const lt = lastTap.current;
            const additive = cur.shift || multiRef.current;
            if (lt && lt.id === tgt.id && now - lt.t < 330 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 30) {
              // 더블클릭 / 더블탭 → 뒤집기
              lastTap.current = null;
              const ids = selRef.current.has(tgt.id) && selRef.current.size > 1 ? [...selRef.current] : [tgt.id];
              act("obj:flip", { ids });
              return;
            }
            lastTap.current = { id: tgt.id, t: now, x: e.clientX, y: e.clientY };
            if (additive) {
              const s = new Set(selRef.current);
              if (s.has(tgt.id)) s.delete(tgt.id);
              else s.add(tgt.id);
              setSelection(s);
            } else setSelection(new Set([tgt.id]));
          } else if (tgt.t === "empty") {
            if (!cur.shift && !multiRef.current) setSelection(new Set());
          }
          return;
        }
        case "drag":
          if (e.pointerId === cur.pid) endDrag();
          return;
        case "pending":
          if (e.pointerId !== cur.pid) return;
          cur.released = true;
          cur.cx = e.clientX;
          cur.cy = e.clientY;
          return;
        case "handDrag":
          if (e.pointerId === cur.pid) endHandDrag();
          return;
        case "pan":
          if (e.pointerId === cur.pid) g.current = { kind: "none" };
          return;
        case "select": {
          if (e.pointerId !== cur.pid) return;
          g.current = { kind: "none" };
          const w = toWorld(e.clientX, e.clientY);
          const x0 = Math.min(cur.wx, w.x);
          const x1 = Math.max(cur.wx, w.x);
          const y0 = Math.min(cur.wy, w.y);
          const y1 = Math.max(cur.wy, w.y);
          const s = cur.additive ? new Set(selRef.current) : new Set<string>();
          for (const o of getState().objects.values()) if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) s.add(o.id);
          setSelection(s);
          setSelRect(null);
          return;
        }
      }
    };
    const up = (e: PointerEvent) => onUp(e, false);
    const cancel = (e: PointerEvent) => onUp(e, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 연결이 끊기면 진행 중인 드래그 정리 (서버가 잠금을 풀어 줌)
  useEffect(() => {
    if (st.status !== "online") {
      const cur = g.current;
      if (cur.kind === "drag") for (const id of cur.ids) anim.clearLocal(id);
      g.current = { kind: "none" };
      setDragging(new Set());
      setPlaceholder(null);
      setGhost(null);
    }
  }, [st.status]);

  // 사라진 카드는 선택에서 제거
  useEffect(() => {
    const s = selRef.current;
    let changed = false;
    const next = new Set<string>();
    for (const id of s) {
      if (st.objects.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelection(next);
  }, [st.objects, setSelection]);

  // ------------------------------------------------------------------
  // 키보드 (PC)
  // ------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const cur = g.current;
      const ids = cur.kind === "drag" ? cur.ids : [...selRef.current];
      const k = e.key.toLowerCase();
      if (k === "escape") {
        setMenu(null);
        setSelection(new Set());
        return;
      }
      if (!ids.length) return;
      if (k === "q" || k === "e") {
        e.preventDefault();
        act("obj:rotate", { ids, delta: k === "q" ? -15 : 15 });
      } else if (k === "f") {
        act("obj:flip", { ids });
      } else if (k === "delete" || k === "backspace") {
        e.preventDefault();
        request("obj:delete", { ids }).then((r) => {
          if (!r.ok) toast(r.error, "warn");
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelection]);

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.nativeEvent && (e.nativeEvent as PointerEvent).pointerType === "touch") return; // 터치는 길게 누르기로 처리
    // 포인터 캡처 때문에 e.target 이 테이블이 될 수 있어서 실제 좌표 아래 요소로 판정
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) ?? (e.target as HTMLElement);
    const grip = el.closest<HTMLElement>("[data-grip]");
    const oel = el.closest<HTMLElement>("[data-oid]");
    const target: Target = grip ? { t: "grip", id: grip.dataset.grip! } : oel ? { t: "obj", id: oel.dataset.oid! } : { t: "empty" };
    openMenuFor(e.clientX, e.clientY, target);
  };

  // ------------------------------------------------------------------
  // 화면
  // ------------------------------------------------------------------
  const objects = useMemo(() => [...st.objects.values()], [st.objects]);
  const selActions = useMemo(
    () =>
      selection.size
        ? buildActions({ ids: [...selection], openPrompt, clearSelection: () => setSelection(new Set()), openCustom: (stackId) => setCustom({ stackId }) })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, st.objects, st.room],
  );

  const hand = st.hand;
  const shortScreen = typeof window !== "undefined" && window.innerHeight < 500; // 가로 모드 휴대폰
  const handScale = shortScreen ? 0.5 : handW < 560 ? 0.62 : 0.84;
  const n = hand.length;
  const allL = n > 0 && hand.every((c) => c.shape === "L");
  const hcw = (hand.some((c) => c.shape === "L") ? 140 : 100) * handScale;
  const hch = (allL ? 100 : 140) * handScale;
  const fitSpacing = (cnt: number) => (cnt > 1 ? Math.min(hcw + 8, (handW - hcw - 8) / (cnt - 1)) : 0);
  // 손패가 많이 겹쳐 카드 내용이 가려지면 여러 줄로 펼침 (가로 모드 휴대폰은 높이가 낮아 최대 2줄)
  const maxRows = shortScreen ? 2 : 3;
  let handRows = 1;
  while (handRows < maxRows && n > handRows && fitSpacing(Math.ceil(n / handRows)) < hcw * 0.55) handRows++;
  const perRow = Math.ceil(n / handRows);
  const spacing = fitSpacing(perRow);
  const rowH = hch * 0.7;
  const slot = (k: number) => {
    const row = Math.min(handRows - 1, Math.floor(k / perRow));
    const cnt = row === handRows - 1 ? n - perRow * row : perRow;
    const sp = handRows > 1 ? fitSpacing(cnt) : spacing;
    const startX = Math.max(0, (handW - (hcw + sp * (cnt - 1))) / 2);
    return { x: startX + (k - row * perRow) * sp, y: row * rowH, row };
  };

  const players = room.players;

  return (
    <div className={`app bg-${room.settings.background} ${prefs.shadows ? "shadows" : "noshadows"} ${room.preset === "cockroach" && room.claim ? "has-claim" : ""}`}>
      <div
        className="view"
        ref={viewRef}
        onPointerDown={onViewPointerDown}
        onContextMenu={onContextMenu}
        onDragStart={(e: React.DragEvent) => e.preventDefault()}
      >
        <div className="world" ref={worldRef} style={{ "--cs": scale } as React.CSSProperties}>
          <div className="tabletop" style={{ width: TABLE_W, height: TABLE_H }} />
          {objects.map((o) => (
            <ObjView
              key={o.id}
              o={o}
              me={me}
              selected={selection.has(o.id)}
              dragging={dragging.has(o.id)}
              merge={mergeTarget === o.id}
              lifted={liftId === o.id}
            />
          ))}
          {placeholder && (
            <div className={`obj k-card dragging placeholder ${placeholder.shape === "L" ? "shape-L" : ""}`} ref={placeholderRef} style={{ zIndex: 999999 }}>
              <div className="lift">
                <CardFace face={placeholder.face} back={placeholder.back} />
              </div>
            </div>
          )}
          {selRect && (
            <div
              className="selrect"
              style={{
                left: Math.min(selRect.x0, selRect.x1),
                top: Math.min(selRect.y0, selRect.y1),
                width: Math.abs(selRect.x1 - selRect.x0),
                height: Math.abs(selRect.y1 - selRect.y0),
              }}
            />
          )}
          <CursorLayer me={me} />
        </div>
      </div>

      <GameBar onPickGame={() => setShowGame(true)} onCustom={() => setCustom({})} />
      <ClaimPanel />
      <TopBar onSettings={() => setShowSettings(true)} onHelp={() => setShowHelp(true)} onKick={(id, name) => setConfirm({ text: `${name}님을 내보낼까요?`, onOk: () => act("host:kick", { playerId: id }) })} />

      <div className="bottom" ref={bottomRef}>
        <UnoButton />
        {selActions.length > 0 && (
          <ActionBar
            count={selection.size}
            actions={selActions}
            onMore={(x, y) => setMenu({ x, y, actions: selActions, title: `${selection.size}개 선택됨` })}
            onClear={() => setSelection(new Set())}
          />
        )}
        <div className={`hand ${prefs.handCollapsed ? "collapsed" : ""} ${handHover ? "drop" : ""}`} ref={handRef}>
          <BottomBar
            handCount={n}
            multiMode={multiMode}
            zoomPct={zoomPct}
            onToggleHand={() => setPrefs({ handCollapsed: !prefs.handCollapsed })}
            onToggleMulti={() => {
              setMultiMode(!multiMode);
              toast(!multiMode ? "다중 선택 모드: 카드를 탭해서 여러 장 고르고, 빈 곳을 끌어 영역을 선택하세요" : "다중 선택 모드를 껐어요");
            }}
            onFit={() => fit()}
            onZoom={(f) => {
              const r = viewRef.current!.getBoundingClientRect();
              zoomAt(r.left + r.width / 2, r.top + r.height / 2, cam.current.z * f);
            }}
            onSettings={() => setShowSettings(true)}
            onHelp={() => setShowHelp(true)}
            onNewDeck={(x, y) =>
              setMenu({
                x,
                y,
                title: "덱 추가 (방장)",
                actions: [
                  { key: "d1", label: "트럼프 54장 (조커 포함)", icon: "🂠", run: () => act("host:newDeck", { deck: "standard54" }) },
                  { key: "d2", label: "우노 108장", icon: "🌈", run: () => act("host:newDeck", { deck: "uno108" }) },
                  { key: "d3", label: "프로포즈 카드 덱", icon: "💍", run: () => act("host:newDeck", { deck: "propose" }) },
                  { key: "d4", label: "바퀴벌레 포커 덱", icon: "🪳", run: () => act("host:newDeck", { deck: "cockroach" }) },
                ],
              })
            }
          />
          {!prefs.handCollapsed && (
            <div
              className={`hand-cards ${prefs.fan && handRows === 1 ? "fan" : ""} ${allL ? "all-L" : ""}`}
              ref={handCardsRef}
              style={{ "--cs": handScale, height: n === 0 ? 34 : hch + rowH * (handRows - 1) + (prefs.fan && handRows === 1 ? 22 : 10) } as React.CSSProperties}
            >
              {n === 0 && <div className="hand-empty">손패가 비어 있어요 · 테이블의 카드를 여기로 끌어오거나 더미 메뉴에서 뽑으세요</div>}
              {hand.map((c, i) => {
                const mid = (n - 1) / 2;
                const fan = prefs.fan && handRows === 1;
                const angle = fan ? (i - mid) * Math.min(6, 40 / Math.max(1, n)) : 0;
                const lift = fan ? Math.abs(i - mid) * Math.abs(i - mid) * 0.6 : 0;
                let k = i;
                if (handInsert !== null && handDragId) {
                  const without = hand.filter((h) => h.id !== handDragId);
                  const pos = without.findIndex((h) => h.id === c.id);
                  if (pos >= 0) k = pos >= handInsert ? pos + 1 : pos;
                }
                const sl = slot(k);
                const x = sl.x;
                return (
                  <div
                    key={c.id}
                    className={`hcard ${c.shape === "L" ? "shape-L" : ""} ${handDragId === c.id ? "hidden" : ""}`}
                    data-hid={c.id}
                    data-row={slot(i).row}
                    style={{ transform: `translate(${x}px, ${sl.y + lift}px) rotate(${angle}deg)`, zIndex: i + 1 }}
                    onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => onHandPointerDown(e, c.id)}
                  >
                    <CardFace face={c.face} back={c.back} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {ghost && (
        <div className={`hand-ghost ${ghost.shape === "L" ? "shape-L" : ""}`} ref={ghostRef} style={{ "--cs": handScale } as React.CSSProperties}>
          <div className="ghost-inner">
            <CardFace face={getPrefs().playFaceDown ? null : ghost.face} back={ghost.back} />
          </div>
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          askConfirm={(text, onOk) => setConfirm({ text, onOk })}
          onPickGame={() => {
            setShowSettings(false);
            setShowGame(true);
          }}
        />
      )}
      {showGame && <GameSelectModal onClose={() => setShowGame(false)} askConfirm={(text, onOk) => setConfirm({ text, onOk })} />}
      {custom && <CustomCardModal stackId={custom.stackId} onClose={() => setCustom(null)} />}
      {showHelp && (
        <HelpModal
          onClose={() => {
            setShowHelp(false);
            setPrefs({ helpSeen: true });
          }}
        />
      )}
      {prompt && (
        <PromptModal
          title={prompt.title}
          max={prompt.max}
          def={prompt.def}
          onOk={(v) => {
            prompt.onOk(v);
            setPrompt(null);
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
      {confirm && (
        <ConfirmModal
          text={confirm.text}
          onOk={() => {
            confirm.onOk();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <PeekModal />
      <Banner />
      <Toasts />
      {st.status !== "online" && <div className="conn-banner">⚡ 연결이 끊겼어요. 다시 연결하는 중…</div>}
      {players.length === 0 && null}
    </div>
  );
}

// =====================================================================
// 카드/더미 하나
// =====================================================================
// memo: 바뀐 카드만 다시 그림. 서버가 바꾼 카드만 새 객체로 보내므로(obj:upsert)
// 나머지 카드는 같은 객체라 다시 그리지 않습니다. 끄는 중 위치 변화는 anim.ts 가 직접 처리.
const ObjView = memo(function ObjView({ o, me, selected, dragging, merge, lifted }: { o: PubObj; me: string; selected: boolean; dragging: boolean; merge: boolean; lifted: boolean }) {
  count("objRenders");
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    anim.register(o.id, el);
    return () => anim.unregister(o.id, el);
  }, [o.id]);
  const holder = o.lockedBy && o.lockedBy !== me ? playerById(o.lockedBy) : undefined;
  const cls = ["obj", `k-${o.kind}`]; // ("card" 는 카드 그림 클래스와 겹치므로 k- 접두어 사용)
  if (selected) cls.push("sel");
  if (dragging) cls.push("dragging");
  if (holder) cls.push("held");
  if (merge) cls.push("merge");
  if (lifted) cls.push("lifted");
  if (o.shape === "L") cls.push("shape-L");
  if (o.pinned) cls.push("pinned");
  const empty = o.kind === "stack" && o.count === 0;
  if (empty) cls.push("empty");
  const thick = o.kind === "stack" ? Math.min(6, Math.ceil(o.count / 9)) : 0;
  return (
    <div ref={ref} className={cls.join(" ")} data-oid={o.id} style={{ zIndex: dragging ? 500000 + o.z : o.z }}>
      <div className={`lift thick-${thick}`}>
        {o.kind === "card" ? (
          <CardFace face={o.face} back={o.back} />
        ) : empty ? (
          <div className="pile-empty">{o.label ?? "빈 자리"}</div>
        ) : (
          <CardFace face={o.faceUp ? o.top : null} back={o.back} />
        )}
      </div>
      {o.kind === "stack" && o.label && !empty && <div className="pile-label">{o.label}</div>}
      {o.kind === "stack" && (
        <div className="grip" data-grip={o.id} title={o.pinned ? "잠긴 더미" : "여기를 끌거나, 더미를 꾹 누른 채 끌면 더미 전체 이동"}>
          {o.pinned ? "🔒" : "⠿"} {o.count}
        </div>
      )}
      {o.kind === "card" && o.pinned && <div className="pin-badge">🔒</div>}
      {holder && (
        <div className="holder" style={{ background: holder.color }}>
          {holder.nickname}
        </div>
      )}
    </div>
  );
});

// =====================================================================
// 다른 플레이어의 커서 (테이블 좌표로 표시)
// =====================================================================
function CursorLayer({ me }: { me: string }) {
  const [ids, setIds] = useState<string[]>([]);
  const els = useRef(new Map<string, HTMLDivElement>());
  const last = useRef(new Map<string, { x: number; y: number; t: number }>());
  useEffect(() => {
    const off = onCursor((by, x, y) => {
      if (by === me) return;
      last.current.set(by, { x, y, t: Date.now() });
      const el = els.current.get(by);
      if (el) {
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        el.style.opacity = "1";
      } else setIds((prev) => (prev.includes(by) ? prev : [...prev, by]));
    });
    const t = setInterval(() => {
      const now = Date.now();
      for (const [id, v] of last.current) {
        const el = els.current.get(id);
        if (el) el.style.opacity = now - v.t > 4000 ? "0" : "1";
      }
    }, 1000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [me]);
  return (
    <>
      {ids.map((id) => {
        const p = playerById(id);
        if (!p) return null;
        const v = last.current.get(id);
        return (
          <div
            key={id}
            className="cursor"
            ref={(el: HTMLDivElement | null) => {
              if (el) els.current.set(id, el);
              else els.current.delete(id);
            }}
            style={{ transform: v ? `translate3d(${v.x}px, ${v.y}px, 0)` : undefined, "--pc": p.color } as React.CSSProperties}
          >
            <div className="cur-in">
              <svg width="22" height="22" viewBox="0 0 22 22">
                <path d="M2 2 L2 18 L7 13 L11 21 L14 19.5 L10 11.5 L17 11.5 Z" fill={p.color} stroke="#fff" strokeWidth="1.5" />
              </svg>
              <span style={{ background: p.color }}>{p.nickname}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
