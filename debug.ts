// =====================================================================
// 기능 모듈: 개발자용 측정 (지연 시간 측정, 서버 상태)
// - perf:ping 은 항상 사용 가능 (왕복 지연 시간 측정, 게임 정보 없음)
// - debug:stats 는 ENABLE_METRICS=1 일 때만 응답 (방 개수, 연결 수, 통신량, 메모리 등 숫자만)
// =====================================================================
import type { Router } from "../router";
import { metricsEnabled, snapshot, type ServerCounts } from "../metrics";

export function registerDebugHandlers(r: Router, deps: { counts: () => ServerCounts }) {
  r.on("perf:ping", (_c, p) => ({ t: typeof p.t === "number" ? p.t : 0 }));
  r.on("debug:stats", (c) => {
    if (!metricsEnabled) return "서버 측정이 꺼져 있어요 (서버 환경변수 ENABLE_METRICS=1)";
    return { stats: { ...snapshot(deps.counts()), thisRoom: { objects: c.room.objs.size, players: c.room.playerCount() } } };
  });
}
