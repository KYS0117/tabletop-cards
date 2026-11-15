// 이 기기에서만 적용되는 개인 설정 (그림자, 애니메이션, 손패 모양 등)
import { useSyncExternalStore } from "react";
import * as anim from "./anim";

export interface Prefs {
  shadows: boolean;
  animations: boolean;
  fan: boolean;
  playFaceDown: boolean;
  handCollapsed: boolean;
  helpSeen: boolean;
  /** 개발자용 성능 측정 창 */
  perfOverlay: boolean;
}

const KEY = "tt-prefs";
let prefs: Prefs = { shadows: true, animations: true, fan: false, playFaceDown: false, handCollapsed: false, helpSeen: false, perfOverlay: false };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
} catch {
  /* 무시 */
}
anim.setAnimate(prefs.animations);

const subs = new Set<() => void>();
export function getPrefs() {
  return prefs;
}
export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  anim.setAnimate(prefs.animations);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* 무시 */
  }
  subs.forEach((f) => f());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => prefs,
    () => prefs,
  );
}
