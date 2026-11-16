import { randomBytes, randomInt } from "node:crypto";

/** 추측하기 어려운 짧은 id */
export function newId(): string {
  return randomBytes(6).toString("base64url");
}

/** 재접속용 비밀 토큰 (소유자만 알고 있음) */
export function newToken(): string {
  return randomBytes(18).toString("base64url");
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newRoomCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

/** 서버에서 실행하는 공정한 셔플 (Fisher–Yates + 암호학적 난수) */
export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 0 이상 n 미만의 공정한 난수 */
export function randomIndex(n: number): number {
  return n <= 1 ? 0 : randomInt(n);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 40;
}

/** 요청으로 들어온 id 배열 검증: 문자열만, 중복 제거, 개수 제한 */
export function idList(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (!isId(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out.length ? out : null;
}

export function cleanText(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  const s = v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .trim();
  return Array.from(s).slice(0, maxLen).join("");
}

export function normRot(r: number): number {
  let x = r % 360;
  if (x < 0) x += 360;
  return Math.round(x * 100) / 100;
}

/** 간단한 초당 요청 수 제한 */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(private perSecond: number, private burst: number) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
