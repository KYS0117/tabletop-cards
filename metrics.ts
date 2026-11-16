// =====================================================================
// 서버 성능 측정 (개발자용)
// - 환경변수 ENABLE_METRICS=1 일 때만 켜집니다. 꺼져 있으면 아무 비용도 없어요.
// - 실제 네트워크로 오간 Socket.IO 패킷 크기를 연결마다 집계합니다.
// - 확인: GET /debug/metrics  또는  화면의 성능 창(Ctrl+Shift+P)
// =====================================================================
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Socket } from "socket.io";

export const metricsEnabled = process.env.ENABLE_METRICS === "1";

const RES_MS = 10;
const loopDelay = metricsEnabled ? monitorEventLoopDelay({ resolution: RES_MS }) : null;
loopDelay?.enable();

const total = { inEvents: 0, inBytes: 0, outPackets: 0, outBytes: 0 };
let last = { ...total, t: Date.now() };
let rate = { inEvents: 0, inKBs: 0, outPackets: 0, outKBs: 0 };
const startedAt = Date.now();

if (metricsEnabled) {
  setInterval(() => {
    const now = Date.now();
    const sec = (now - last.t) / 1000 || 1;
    rate = {
      inEvents: Math.round((total.inEvents - last.inEvents) / sec),
      inKBs: +((total.inBytes - last.inBytes) / 1024 / sec).toFixed(1),
      outPackets: Math.round((total.outPackets - last.outPackets) / sec),
      outKBs: +((total.outBytes - last.outBytes) / 1024 / sec).toFixed(1),
    };
    last = { ...total, t: now };
  }, 2000).unref?.();
}

function size(data: unknown): number {
  if (typeof data === "string") return Buffer.byteLength(data);
  if (data && typeof data === "object" && "length" in data) return Number((data as { length: number }).length) || 0;
  return 0;
}

interface PacketEmitter {
  on(ev: "packet" | "packetCreate", fn: (p: { data?: unknown }) => void): unknown;
}

/** 연결 하나의 송수신량 집계 시작 */
export function trackSocket(socket: Socket) {
  if (!metricsEnabled) return;
  const s = socket as Socket & { onAny?: (fn: () => void) => void; conn?: PacketEmitter };
  s.onAny?.(() => {
    total.inEvents++;
  });
  s.conn?.on("packet", (p) => {
    total.inBytes += size(p?.data);
  });
  s.conn?.on("packetCreate", (p) => {
    total.outPackets++;
    total.outBytes += size(p?.data);
  });
}

const lag = (ns: number) => Math.max(0, +(ns / 1e6 - RES_MS).toFixed(1));

export interface ServerCounts {
  rooms: number;
  connections: number;
  players: number;
  objects: number;
}

export function snapshot(counts: ServerCounts) {
  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    ...counts,
    perSecond: rate,
    eventLoopDelayMs: loopDelay
      ? // 측정값에는 샘플링 간격(RES_MS)이 포함되어 있어서 빼고 실제 지연만 표시
        { p50: lag(loopDelay.percentile(50)), p99: lag(loopDelay.percentile(99)), max: lag(loopDelay.max) }
      : null,
    memoryMB: { rss: +(mem.rss / 1048576).toFixed(1), heapUsed: +(mem.heapUsed / 1048576).toFixed(1) },
  };
}
