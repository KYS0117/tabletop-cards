// =====================================================================
// 카드 화면 위치 애니메이터
// - target  : 서버(또는 다른 플레이어)가 알려 준 위치
// - local   : 내가 지금 끌고 있는 카드의 위치 (지연 없이 바로 반영)
// - 화면 위치는 매 프레임 target 쪽으로 부드럽게 따라가며(보간) 다른 사람의 드래그도 끊기지 않게 보임
// - 성능: 움직이는 카드(active)만 매 프레임 계산합니다. 멈춘 카드는 건드리지 않아요.
// =====================================================================
import { recordAnim } from "./perf";

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
/** 아직 목표 위치에 도착하지 않았거나, 내가 끌고 있는 카드 */
const active = new Set<string>();
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
  active.add(id);
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
  active.add(id);
}

export function setLocal(id: string, x: number, y: number) {
  local.set(id, { x, y });
  active.add(id);
}

export function clearLocal(id: string) {
  local.delete(id);
  active.add(id);
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
  active.delete(id);
}

export function clearAll() {
  target.clear();
  disp.clear();
  local.clear();
  written.clear();
  active.clear();
}

function frame() {
  const t0 = performance.now();
  let n = 0;
  for (const id of active) {
    const el = els.get(id);
    const t = target.get(id);
    if (!el || !t) {
      if (!t) active.delete(id); // 화면에 다시 나타나면 register 가 다시 넣어 줌
      continue;
    }
    n++;
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
    // 목표에 도착했고 끌고 있지 않으면 다음 프레임부터 계산하지 않음
    if (!l && d.x === tx && d.y === ty && d.rot === t.rot) active.delete(id);
  }
  recordAnim(performance.now() - t0, n);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
