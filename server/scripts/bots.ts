// =====================================================================
// 부하 테스트용 봇 (개발자용)
// 실제 Socket.IO 로 방에 들어가 사람처럼 카드를 계속 집어서 움직입니다.
// 사람 1~2명이 브라우저로 접속해 성능 창(Ctrl+Shift+P)을 보면서 체감 성능을 확인하세요.
//
// 사용법 (루트 폴더에서):
//   npm run bots -- <서버주소> <방코드> [봇 수=7] [초=60]
//   예) npm run bots -- http://localhost:3001 AB7K92 7 60
// =====================================================================
import { io, type Socket } from "socket.io-client";

const [url = "http://localhost:3001", code = "", nArg = "7", secArg = "60"] = process.argv.slice(2);
if (!code) {
  console.log("사용법: npm run bots -- <서버주소> <방코드> [봇 수] [초]");
  process.exit(1);
}
const nBots = Math.max(1, Math.min(7, Number(nArg) || 7));
const seconds = Number(secArg) || 60;

interface Obj {
  id: string;
  kind: string;
  x: number;
  y: number;
  lockedBy: string | null;
}

const call = (s: Socket, ev: string, data: unknown) =>
  new Promise<any>((resolve) => s.timeout(8000).emit(ev, data, (err: unknown, r: unknown) => resolve(err ? { ok: false } : r)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bot(i: number) {
  const s = io(url, { transports: ["websocket"] });
  const objs = new Map<string, Obj>();
  let rx = 0;
  s.onAny(() => rx++);
  s.on("state:full", (d: { objects: Obj[] }) => d.objects.forEach((o) => objs.set(o.id, o)));
  s.on("obj:upsert", (d: { objects: Obj[] }) => d.objects.forEach((o) => objs.set(o.id, o)));
  s.on("obj:remove", (d: { ids: string[] }) => d.ids.forEach((id) => objs.delete(id)));
  s.on("obj:moving", (d: { moves: { id: string; x: number; y: number }[] }) =>
    d.moves.forEach((m) => {
      const o = objs.get(m.id);
      if (o) Object.assign(o, m);
    }),
  );
  await new Promise<void>((r) => s.on("connect", () => r()));
  const j = await call(s, "room:join", { code, nickname: `봇${i + 1}`, tabId: `bot-${i}-${Date.now()}` });
  if (!j.ok) {
    console.log(`봇${i + 1} 입장 실패:`, j.error);
    s.disconnect();
    return 0;
  }
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const free = [...objs.values()].filter((o) => o.kind === "card" && !o.lockedBy);
    let o: Obj;
    if (free.length) {
      o = free[Math.floor(Math.random() * free.length)];
      const g = await call(s, "obj:grab", { ids: [o.id] });
      if (!g.ok || !g.granted?.length) continue;
    } else {
      // 낱장 카드가 없으면 더미에서 한 장 뽑아서 움직임
      const stack = [...objs.values()].find((x) => x.kind === "stack" && !x.lockedBy);
      if (!stack) {
        await sleep(200);
        continue;
      }
      const t = await call(s, "stack:take", { stackId: stack.id });
      if (!t.ok) continue;
      o = t.card as Obj;
      objs.set(o.id, o);
    }
    const cx = o.x;
    const cy = o.y;
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) {
      const t = (Date.now() - t0) / 1500;
      const x = cx + Math.sin(t * Math.PI * 2 + i) * 120;
      const y = cy + Math.cos(t * Math.PI * 2 + i) * 80;
      s.volatile.emit("obj:drag", { moves: [{ id: o.id, x, y }] }); // 실제 화면과 같은 초당 약 25회
      await sleep(40);
    }
    // 원래 자리 근처에 내려놓기 (더미에서 뽑은 카드는 더미 옆으로)
    await call(s, "obj:release", { moves: [{ id: o.id, x: cx + (free.length ? 0 : 160 + i * 30), y: cy }] });
  }
  s.disconnect();
  return rx;
}

console.log(`봇 ${nBots}명이 ${seconds}초 동안 방 ${code} 에서 카드를 움직입니다…`);
const results = await Promise.all(Array.from({ length: nBots }, (_, i) => bot(i)));
console.log(`끝. 봇 1명당 받은 메시지: 평균 ${Math.round(results.reduce((a, b) => a + b, 0) / nBots / seconds)}개/초`);
process.exit(0);
