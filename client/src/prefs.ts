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
  // 사운드 (0~100)
  volMaster: number;
  volBgm: number;
  volSfx: number;
  volAlert: number;
  muted: boolean;
  sfxOn: boolean;
  bgmOn: boolean;
}

const KEY = "tt-prefs";
let prefs: Prefs = {
  shadows: true,
  animations: true,
  fan: false,
  playFaceDown: false,
  handCollapsed: false,
  helpSeen: false,
  perfOverlay: false,
  volMaster: 80,
  volBgm: 50,
  volSfx: 80,
  volAlert: 90,
  muted: false,
  sfxOn: true,
  bgmOn: true,
};
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
let soundHook: (() => void) | null = null;
/** sound.ts 가 볼륨 변경을 받도록 연결 (순환 import 방지) */
export function onPrefsSound(fn: () => void) {
  soundHook = fn;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  anim.setAnimate(prefs.animations);
  soundHook?.();
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
