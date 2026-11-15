// =====================================================================
// 카드 화면 위치 애니메이터
// - target  : 서버(또는 다른 플레이어)가 알려 준 위치
// - local   : 내가 지금 끌고 있는 카드의 위치 (지연 없이 바로 반영)
// - 화면 위치는 매 프레임 target 쪽으로 부드럽게 따라가며(보간) 다른 사람의 드래그도 끊기지 않게 보임
// =====================================================================

interface P {
  x: number;
  y: number;
  rot: number;
}

const els = new Map<string, HTMLElement>();
const disp = new Map<string, P>();
const target = new Map<string, P>();
const local = new Map<string, { x: number; y: number }>();
const written = new Map<string, string>();
let animate = true;

export function setAnimate(v: boolean) {
  animate = v;
}

function write(id: string, el: HTMLElement, p: P) {
  const s = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) translate(-50%,-50%) rotate(${p.rot.toFixed(1)}deg)`;
  if (written.get(id) !== s) {
    el.style.transform = s;
    written.set(id, s);
  }
}

export function register(id: string, el: HTMLElement) {
  els.set(id, el);
  written.delete(id);
  const t = target.get(id);
  if (t) {
    const d = disp.get(id) ?? { ...t };
    disp.set(id, d);
    write(id, el, d);
  }
}

export function unregister(id: string, el: HTMLElement) {
  if (els.get(id) === el) {
    els.delete(id);
    written.delete(id);
  }
}

export function setTarget(id: string, x: number, y: number, rot: number, snap = false) {
  target.set(id, { x, y, rot });
  if (snap || !disp.has(id)) disp.set(id, { x, y, rot });
}

export function setLocal(id: string, x: number, y: number) {
  local.set(id, { x, y });
}

export function clearLocal(id: string) {
  local.delete(id);
}

export function hasLocal(id: string) {
  return local.has(id);
}

/** 지금 화면에 보이는 위치 (드래그 시작 기준점 계산용) */
export function shown(id: string): P | undefined {
  const l = local.get(id);
  const d = disp.get(id) ?? target.get(id);
  if (!d) return undefined;
  return l ? { x: l.x, y: l.y, rot: d.rot } : d;
}

export function forget(id: string) {
  target.delete(id);
  disp.delete(id);
  local.delete(id);
  written.delete(id);
}

export function clearAll() {
  target.clear();
  disp.clear();
  local.clear();
  written.clear();
}

function frame() {
  for (const [id, el] of els) {
    const t = target.get(id);
    if (!t) continue;
    let d = disp.get(id);
    if (!d) {
      d = { ...t };
      disp.set(id, d);
    }
    const l = local.get(id);
    const tx = l ? l.x : t.x;
    const ty = l ? l.y : t.y;
    if (l || !animate) {
      d.x = tx;
      d.y = ty;
      d.rot = t.rot;
    } else {
      const k = 0.32;
      d.x += (tx - d.x) * k;
      d.y += (ty - d.y) * k;
      const dr = ((((t.rot - d.rot) % 360) + 540) % 360) - 180; // 가까운 방향으로 회전
      d.rot += dr * k;
      if (Math.abs(tx - d.x) < 0.3) d.x = tx;
      if (Math.abs(ty - d.y) < 0.3) d.y = ty;
      if (Math.abs(dr) < 0.3) d.rot = t.rot;
    }
    write(id, el, d);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
