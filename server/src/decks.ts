// =====================================================================
// 이미지 카드 덱 읽기 (decks/<덱 이름>/ 폴더)
//
// 폴더에 그림 파일만 넣으면 자동으로 덱이 됩니다.
//   back.png (또는 .jpg/.webp)      → 카드 뒷면 (없으면 기본 뒷면 무늬)
//   base-01.png, base-02.png …       → 기본 카드 (게임 시작 때 모든 사람이 한 벌씩 받음)
//   그 밖의 그림 파일                → 덱에 들어가는 카드 (파일 이름 순서)
//   deck.json                        → 이름, 카드 모양(가로/세로), 같은 카드 여러 장 등 설정 (선택)
// 그림이 하나도 없으면 deck.json 의 임시 글자 카드(fallbackText)를 사용합니다.
//
// 파일 이름은 영문·숫자·-_. 만 사용하세요. 그림 한 장 최대 5MB.
// 그림을 바꾼 뒤에는 게임을 다시 선택하면 바로 반영됩니다 (서버 재시작 불필요).
// =====================================================================
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_ASSET_PATH } from "../../shared/cards";
import type { BackStyle, Face, Shape } from "../../shared/protocol";

const here = dirname(fileURLToPath(import.meta.url));
export const DECKS_DIR = resolve(process.env.DECKS_DIR || join(here, "../../decks"));

const IMG = /\.(png|jpe?g|webp)$/i;
const SAFE_DECK = /^[A-Za-z0-9_-]+$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageDeck {
  id: string;
  name: string;
  shape: Shape;
  back: BackStyle;
  /** 덱에 들어갈 카드 (같은 카드 여러 장이면 여러 번 들어 있음) */
  cards: Face[];
  /** 모든 사람이 한 벌씩 받는 기본 카드 */
  base: Face[];
  /** 그림이 없어서 임시 글자 카드를 쓰는 중인지 */
  placeholder: boolean;
}

interface DeckJson {
  name?: string;
  shape?: Shape;
  /** 그림 파일별 장수 (예: { "023.png": 2 }) — 없으면 1장 */
  counts?: Record<string, number>;
  /** 덱 전체 장수 목표 (예: 64) — 그림 종류가 적으면 종류마다 같은 장수로 채움 (8종 → 8장씩) */
  fillTo?: number;
  fallbackText?: string[];
  fallbackBase?: string[];
  fallbackBack?: string;
}

export function loadImageDeck(id: string): ImageDeck | string {
  if (!SAFE_DECK.test(id)) return "덱 이름이 올바르지 않아요";
  const dir = join(DECKS_DIR, id);
  if (!existsSync(dir)) return `decks/${id} 폴더가 없어요`;
  let cfg: DeckJson = {};
  const cfgPath = join(dir, "deck.json");
  if (existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    } catch {
      return `decks/${id}/deck.json 형식이 잘못됐어요`;
    }
  }
  const files = readdirSync(dir)
    .filter((f) => IMG.test(f) && SAFE_ASSET_PATH.test(`${id}/${f}`))
    .filter((f) => statSync(join(dir, f)).size <= MAX_IMAGE_BYTES)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const backFile = files.find((f) => /^back\./i.test(f));
  const baseFiles = files.filter((f) => /^base/i.test(f));
  const cardFiles = files.filter((f) => !/^back\./i.test(f) && !/^base/i.test(f));
  const shape: Shape = cfg.shape === "P" ? "P" : "L";
  const name = cfg.name || id;

  /** 종류마다 몇 장 넣을지: counts 에 적힌 값 > fillTo 로 계산한 값 > 1장 */
  const copiesFor = (kinds: number) => (cfg.fillTo && kinds ? Math.max(1, Math.round(cfg.fillTo / kinds)) : 1);
  const countOf = (key: string, kinds: number) => Math.max(1, Math.min(20, Math.floor(cfg.counts?.[key] ?? copiesFor(kinds))));

  if (cardFiles.length) {
    const cards: Face[] = [];
    for (const f of cardFiles) {
      const n = countOf(f, cardFiles.length);
      for (let i = 0; i < n; i++) cards.push(`IMG:${id}/${f}`);
    }
    return {
      id,
      name,
      shape,
      back: backFile ? `IMG:${id}/${backFile}` : cfg.fallbackBack || id,
      cards,
      base: baseFiles.map((f) => `IMG:${id}/${f}`),
      placeholder: false,
    };
  }
  // 아직 그림이 없으면 임시 글자 카드
  const text = (cfg.fallbackText ?? []).filter((t) => typeof t === "string" && t.trim());
  if (!text.length) return `decks/${id} 폴더에 카드 그림이 없어요`;
  return {
    id,
    name,
    shape,
    back: backFile ? `IMG:${id}/${backFile}` : cfg.fallbackBack || id,
    cards: text.flatMap((t) => Array.from({ length: countOf(t, text.length) }, () => `T:${t}`)),
    base: baseFiles.length ? baseFiles.map((f) => `IMG:${id}/${f}`) : (cfg.fallbackBase ?? []).map((t) => `T:${t}`),
    placeholder: true,
  };
}

/** HTTP 로 덱 그림 파일 제공: /decks/<덱>/<파일> (안전한 경로만) */
export function resolveDeckFile(urlPath: string): string | null {
  const m = /^\/decks\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+\.(?:png|jpe?g|webp))$/i.exec(urlPath);
  if (!m) return null;
  const file = resolve(DECKS_DIR, m[1], m[2]);
  if (!file.startsWith(DECKS_DIR) || !existsSync(file)) return null;
  return file;
}
