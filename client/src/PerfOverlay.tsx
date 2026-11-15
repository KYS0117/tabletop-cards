// =====================================================================
// 개발자용 성능 측정 창
// 켜는 법: 주소 끝에 ?perf  /  Ctrl+Shift+P  /  설정 → "개발자: 성능 측정 창 표시"
// 보여 주는 것: FPS, 프레임 시간, 끊김 횟수, 메모리, 렌더링 횟수·시간, 애니메이션 부하,
//              Socket.IO 송수신량(메시지 수·KB), 서버 왕복 지연, 서버 상태(ENABLE_METRICS=1 일 때)
// 창을 닫으면 측정도 멈춰서 평소 성능에는 영향이 없습니다.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { request, socket } from "./net";
import { perf } from "./perf";
import { getPrefs, setPrefs, usePrefs } from "./prefs";
import { getState } from "./store";

interface Stats {
  fps: number;
  frameAvg: number;
  frameP95: number;
  slow10s: number;
  worst10s: number;
  heapMB: number | null;
  heapLimitMB: number | null;
  tablePerSec: number;
  objPerSec: number;
  tableMsAvg: number;
  tableMsMax: number;
  animActive: number;
  animMsAvg: number;
  objects: number;
  domNodes: number;
  inMsgs: number;
  inKBs: number;
  outMsgs: number;
  outKBs: number;
  topIn: string;
  rttMs: number | null;
  connected: boolean;
}

export function PerfOverlay() {
  const prefs = usePrefs();
  const urlOn = useMemo(() => new URLSearchParams(location.search).has("perf"), []);
  const [closedUrl, setClosedUrl] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        setPrefs({ perfOverlay: !getPrefs().perfOverlay });
        setClosedUrl(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const visible = prefs.perfOverlay || (urlOn && !closedUrl);
  if (!visible) return null;
  return (
    <PerfPanel
      onClose={() => {
        setPrefs({ perfOverlay: false });
        setClosedUrl(true);
      }}
    />
  );
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function PerfPanel({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [server, setServer] = useState<string>("");
  const [showServer, setShowServer] = useState(false);
  const [mini, setMini] = useState(false);
  const rtt = useRef<number | null>(null);
  const frames = useRef<number[]>([]);
  const slowAt = useRef<{ t: number; ms: number }[]>([]);

  useEffect(() => {
    perf.enabled = true;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      frames.current.push(dt);
      if (frames.current.length > 300) frames.current.shift();
      if (dt > 50) slowAt.current.push({ t, ms: dt });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    let prev = { ...perf.counters, t: performance.now() };
    let prevIn = new Map(perf.inByEvent);
    const tick = setInterval(() => {
      const now = performance.now();
      const sec = (now - prev.t) / 1000 || 1;
      const c = perf.counters;
      const f = frames.current;
      const sorted = [...f].sort((a, b) => a - b);
      slowAt.current = slowAt.current.filter((s) => now - s.t < 10_000);
      const recent = f.slice(-120);
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      // 이번 1초 동안 가장 많이 받은 이벤트
      const deltas: [string, number][] = [];
      for (const [k, v] of perf.inByEvent) deltas.push([k, v - (prevIn.get(k) ?? 0)]);
      deltas.sort((a, b) => b[1] - a[1]);
      prevIn = new Map(perf.inByEvent);
      setStats({
        fps: Math.round(1000 / (avg(recent) || 16.7)),
        frameAvg: +avg(recent).toFixed(1),
        frameP95: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
        slow10s: slowAt.current.length,
        worst10s: Math.round(Math.max(0, ...slowAt.current.map((s) => s.ms))),
        heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
        heapLimitMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
        tablePerSec: +((c.tableRenders - prev.tableRenders) / sec).toFixed(1),
        objPerSec: +((c.objRenders - prev.objRenders) / sec).toFixed(1),
        tableMsAvg: +avg(perf.tableRenderMs.slice(-30)).toFixed(1),
        tableMsMax: +Math.max(0, ...perf.tableRenderMs.slice(-30)).toFixed(1),
        animActive: perf.animActive,
        animMsAvg: +avg(perf.animMs.slice(-60)).toFixed(2),
        objects: getState().objects.size,
        domNodes: document.getElementsByTagName("*").length,
        inMsgs: Math.round((c.netInMsgs - prev.netInMsgs) / sec),
        inKBs: +((c.netInBytes - prev.netInBytes) / 1024 / sec).toFixed(1),
        outMsgs: Math.round((c.netOutMsgs - prev.netOutMsgs) / sec),
        outKBs: +((c.netOutBytes - prev.netOutBytes) / 1024 / sec).toFixed(1),
        topIn: deltas
          .filter((d) => d[1] > 0)
          .slice(0, 3)
          .map(([k, v]) => `${k} ${Math.round(v / sec)}`)
          .join(", "),
        rttMs: rtt.current,
        connected: socket.connected,
      });
      prev = { ...c, t: now };
    }, 1000);

    const ping = setInterval(() => {
      if (!socket.connected || !getState().session) return;
      const t0 = performance.now();
      request("perf:ping", { t: t0 }, 4000).then((r) => {
        if (r.ok) rtt.current = Math.round(performance.now() - t0);
      });
    }, 2000);

    return () => {
      perf.enabled = false;
      cancelAnimationFrame(raf);
      clearInterval(tick);
      clearInterval(ping);
    };
  }, []);

  useEffect(() => {
    if (!showServer) return;
    const load = () => {
      if (!getState().session) return setServer("방에 들어가면 볼 수 있어요");
      request<"debug:stats", { stats: unknown }>("debug:stats", {}).then((r) => setServer(r.ok ? JSON.stringify(r.stats, null, 1) : r.error));
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [showServer]);

  const copy = () => {
    const report = {
      time: new Date().toISOString(),
      userAgent: navigator.userAgent,
      viewport: `${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
      players: getState().room?.players.filter((p) => p.connected).length,
      stats,
      server: showServer ? server : undefined,
    };
    navigator.clipboard?.writeText(JSON.stringify(report, null, 2)).catch(() => {});
  };

  const s = stats;
  const lvl = (v: number, warn: number, bad: number, higherIsBetter = false) =>
    higherIsBetter ? (v < bad ? "bad" : v < warn ? "warn" : "") : v > bad ? "bad" : v > warn ? "warn" : "";

  return (
    <div className={`perf ${mini ? "mini" : ""}`} onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
      <div className="perf-head">
        <b>성능</b>
        {s && <span className={lvl(s.fps, 50, 30, true)}>{s.fps} FPS</span>}
        <span className="grow" />
        <button onClick={() => setMini(!mini)}>{mini ? "▾" : "▴"}</button>
        <button onClick={onClose}>✕</button>
      </div>
      {!mini && s && (
        <>
          <div className="perf-sec">화면</div>
          <Row k="프레임 평균 / 95%" v={`${s.frameAvg} / ${s.frameP95} ms`} c={lvl(s.frameP95, 25, 40)} />
          <Row k="끊김(50ms↑) 10초" v={`${s.slow10s}회${s.slow10s ? ` · 최대 ${s.worst10s}ms` : ""}`} c={lvl(s.slow10s, 2, 6)} />
          <Row k="JS 메모리" v={s.heapMB === null ? "이 브라우저 미지원" : `${s.heapMB} / ${s.heapLimitMB} MB`} />
          <div className="perf-sec">렌더링</div>
          <Row k="테이블 렌더/초" v={`${s.tablePerSec} · 평균 ${s.tableMsAvg}ms (최대 ${s.tableMsMax})`} c={lvl(s.tableMsMax, 8, 16)} />
          <Row k="카드 렌더/초" v={`${s.objPerSec}`} />
          <Row k="움직이는 카드" v={`${s.animActive}개 · ${s.animMsAvg}ms/프레임`} c={lvl(s.animMsAvg, 2, 5)} />
          <Row k="오브젝트 / DOM" v={`${s.objects}개 / ${s.domNodes}`} />
          <div className="perf-sec">네트워크 (Socket.IO)</div>
          <Row k="받음" v={`${s.inMsgs}개/초 · ${s.inKBs} KB/초`} c={lvl(s.inKBs, 50, 150)} />
          <Row k="보냄" v={`${s.outMsgs}개/초 · ${s.outKBs} KB/초`} />
          <Row k="왕복 지연" v={s.connected ? (s.rttMs === null ? "측정 중" : `${s.rttMs} ms`) : "연결 끊김"} c={s.rttMs === null ? "" : lvl(s.rttMs, 150, 400)} />
          {s.topIn && <Row k="많이 받은 메시지" v={s.topIn} />}
          <div className="perf-actions">
            <button onClick={() => setShowServer(!showServer)}>{showServer ? "서버 숨기기" : "서버 상태"}</button>
            <button onClick={copy}>📋 기록 복사</button>
          </div>
          {showServer && <pre className="perf-server">{server || "불러오는 중…"}</pre>}
        </>
      )}
    </div>
  );
}

function Row({ k, v, c = "" }: { k: string; v: string; c?: string }) {
  return (
    <div className="perf-row">
      <span>{k}</span>
      <b className={c}>{v}</b>
    </div>
  );
}
