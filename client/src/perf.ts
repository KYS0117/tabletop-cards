// =====================================================================
// 개발자용 성능 측정 도구 (측정값 저장소)
// - 카운터 증가는 숫자 더하기 한 번이라 항상 켜 두어도 부담이 없습니다.
// - 통신량(바이트) 계산처럼 비용이 드는 측정은 성능 창을 열었을 때만 합니다.
// - 화면: PerfOverlay.tsx  /  켜는 법: 주소 끝에 ?perf 또는 Ctrl+Shift+P, 설정 → 개발자
// =====================================================================

export const perf = {
  /** 성능 창이 열려 있을 때만 true (바이트 계산 등 비싼 측정 활성화) */
  enabled: false,
  counters: {
    tableRenders: 0,
    objRenders: 0,
    netInMsgs: 0,
    netInBytes: 0,
    netOutMsgs: 0,
    netOutBytes: 0,
  },
  /** 테이블 컴포넌트 렌더+커밋 시간(ms) 최근 기록 */
  tableRenderMs: [] as number[],
  /** 애니메이션 루프 한 프레임 처리 시간(ms)과 처리한 카드 수 */
  animMs: [] as number[],
  animActive: 0,
  /** 이벤트별 수신 횟수 (어떤 메시지가 많은지 확인용) */
  inByEvent: new Map<string, number>(),
  outByEvent: new Map<string, number>(),
};

export type CounterName = keyof typeof perf.counters;

export function count(name: CounterName, n = 1) {
  perf.counters[name] += n;
}

function pushSample(arr: number[], v: number, max = 120) {
  arr.push(v);
  if (arr.length > max) arr.shift();
}

export function recordTableRender(ms: number) {
  pushSample(perf.tableRenderMs, ms);
}

export function recordAnim(ms: number, active: number) {
  if (!perf.enabled) return;
  pushSample(perf.animMs, ms);
  perf.animActive = active;
}

/** 통신량 기록 (성능 창이 열려 있을 때만 크기 계산) */
export function recordNet(dir: "in" | "out", event: string, payload: unknown) {
  if (dir === "in") perf.counters.netInMsgs++;
  else perf.counters.netOutMsgs++;
  if (!perf.enabled) return;
  const map = dir === "in" ? perf.inByEvent : perf.outByEvent;
  map.set(event, (map.get(event) ?? 0) + 1);
  let bytes = event.length + 8;
  try {
    bytes += payload === undefined ? 0 : JSON.stringify(payload).length;
  } catch {
    /* 무시 */
  }
  if (dir === "in") perf.counters.netInBytes += bytes;
  else perf.counters.netOutBytes += bytes;
}

// 개발자 도구 콘솔에서 window.__ttPerf 로 직접 확인할 수 있게 노출 (측정값만 있음, 게임 정보 없음)
if (typeof window !== "undefined") (window as unknown as { __ttPerf: typeof perf }).__ttPerf = perf;
