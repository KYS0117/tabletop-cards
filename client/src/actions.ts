// =====================================================================
// 선택한 카드/더미에 대해 할 수 있는 동작 목록
// - PC 우클릭 메뉴, 모바일 길게 누르기 메뉴, 모바일 하단 동작 바가 모두 이 목록을 공유합니다.
//   그래서 PC 와 모바일에서 같은 기능을 쓸 수 있어요.
// =====================================================================
import type { PubObj } from "../../shared/protocol";
import { act, request } from "./net";
import { canEditMe, getState, myId, toast } from "./store";

export interface Action {
  key: string;
  label: string;
  /** 동작 바에 표시할 짧은 이름 */
  short?: string;
  icon: string;
  run: () => void;
  danger?: boolean;
  /** 모바일 하단 동작 바에 바로 보이는 주요 동작 */
  primary?: boolean;
}

export interface ActionCtx {
  ids: string[];
  openPrompt: (title: string, max: number, def: number, onOk: (n: number) => void) => void;
  clearSelection: () => void;
  selectBelow?: () => void;
  /** 직접 쓰는 카드 창 열기 (이 더미에 섞기) */
  openCustom?: (stackId: string) => void;
}

export function buildActions(ctx: ActionCtx): Action[] {
  const objs = ctx.ids.map((id) => getState().objects.get(id)).filter((o): o is PubObj => !!o);
  const me = myId();
  const usable = objs.filter((o) => !o.lockedBy || o.lockedBy === me);
  if (!usable.length) return [];
  const ids = usable.map((o) => o.id);
  // 🔒 잠긴 것은 옮기기·뒤집기·회전·삭제·손패로 가져오기 대상에서 뺌
  const movable = usable.filter((o) => !o.pinned);
  const mids = movable.map((o) => o.id);
  const stacks = movable.filter((o) => o.kind === "stack");
  const single = usable.length === 1 ? usable[0] : null;
  const out: Action[] = [];

  if (single && single.kind === "stack" && single.count > 0) {
    const s = single;
    out.push(
      { key: "draw1", label: "1장 뽑아 손패로", short: "1장 뽑기", icon: "🂠", primary: true, run: () => act("stack:draw", { stackId: s.id, count: 1 }) },
      {
        key: "drawN",
        label: "여러 장 뽑아 손패로…",
        icon: "🂠+",
        run: () => ctx.openPrompt("몇 장 뽑을까요?", s.count, Math.min(5, s.count), (n) => act("stack:draw", { stackId: s.id, count: n })),
      },
      {
        key: "deal",
        label: "모두에게 나눠주기…",
        icon: "🤲",
        run: () =>
          ctx.openPrompt("한 사람당 몇 장씩 나눠줄까요?", Math.max(1, Math.floor(s.count / Math.max(1, getState().room?.players.filter((p) => p.connected).length ?? 1))), 5, (n) =>
            act("stack:deal", { stackId: s.id, count: n }),
          ),
      },
      { key: "shuffle", label: "섞기", short: "섞기", icon: "🔀", primary: true, run: () => act("stack:shuffle", { stackId: s.id }) },
      { key: "spread", label: "펼치기", icon: "↔", run: () => act("stack:spread", { stackId: s.id }) },
    );
  }
  if (single && single.kind === "stack" && ctx.openCustom && !single.keep) {
    const s = single;
    out.push({ key: "custom", label: "직접 쓴 카드 섞어 넣기…", icon: "✍", run: () => ctx.openCustom!(s.id) });
  }

  // 👁 몰래 보기: 뒷면 낱장 카드 (나만 보고, 모두에게 "봤다"는 알림)
  if (single && single.kind === "card" && !single.faceUp) {
    out.push({ key: "peek", label: "몰래 보기 (나만)", short: "몰래 보기", icon: "👁", primary: true, run: () => act("obj:peek", { id: single.id }) });
  }

  if (movable.length) {
    out.push(
      { key: "flip", label: "뒤집기", short: "뒤집기", icon: "🔄", primary: true, run: () => act("obj:flip", { ids: mids }) },
      { key: "rotL", label: "왼쪽으로 15°", short: "왼쪽 15°", icon: "⟲", primary: true, run: () => act("obj:rotate", { ids: mids, delta: -15 }) },
      { key: "rotR", label: "오른쪽으로 15°", short: "오른쪽 15°", icon: "⟳", primary: true, run: () => act("obj:rotate", { ids: mids, delta: 15 }) },
      { key: "rot90", label: "90° 회전", icon: "↻", run: () => act("obj:rotate", { ids: mids, delta: 90 }) },
    );
  }
  out.push({ key: "top", label: "맨 위로 올리기", icon: "⬆", run: () => act("obj:toTop", { ids }) });

  // 🔒 잠금 (잠그기는 누구나, 풀기는 잠근 사람 또는 방장 — 서버가 확인)
  if (movable.length) out.push({ key: "pin", label: "잠그기 (움직이지 않게)", short: "잠그기", icon: "🔒", run: () => act("obj:pin", { ids: mids, pinned: true }) });
  if (usable.some((o) => o.pinned)) {
    out.push({ key: "unpin", label: "잠금 풀기", short: "잠금 풀기", icon: "🔓", primary: !movable.length, run: () => act("obj:pin", { ids: usable.filter((o) => o.pinned).map((o) => o.id), pinned: false }) });
  }

  if (movable.length >= 2) {
    out.push(
      { key: "arrange", label: "한 줄로 정렬", icon: "▤", run: () => act("obj:arrange", { ids: mids }) },
      {
        key: "stack",
        label: "묶어서 더미 만들기",
        short: "묶기",
        icon: "🗂",
        primary: true,
        run: () =>
          request("stack:create", { ids: mids }).then((r) => {
            if (!r.ok) toast(r.error, "warn");
            else ctx.clearSelection();
          }),
      },
    );
  }

  if (movable.length) out.push({
    key: "toHand",
    label: stacks.length ? "통째로 손패로 가져오기" : "손패로 가져오기",
    short: "손패로",
    icon: "✋",
    primary: !stacks.length,
    run: () =>
      request("hand:take", { ids: mids }).then((r) => {
        if (!r.ok) toast(r.error, "warn");
        else ctx.clearSelection();
      }),
  });

  if (ctx.selectBelow) out.push({ key: "below", label: "겹친 아래 카드 선택", icon: "⤓", run: ctx.selectBelow });

  if (canEditMe()) {
    out.push({ key: "dup", label: "복제", icon: "⧉", run: () => act("obj:duplicate", { ids }) });
    if (movable.length)
      out.push({
        key: "del",
        label: "삭제",
        icon: "🗑",
        danger: true,
        run: () =>
          request("obj:delete", { ids: mids }).then((r) => {
            if (!r.ok) toast(r.error, "warn");
            else ctx.clearSelection();
          }),
      });
  }
  return out;
}
