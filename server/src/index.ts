// =====================================================================
// 서버 시작점
// - Socket.IO 실시간 서버
// - client/dist 가 있으면 웹사이트 파일도 같이 제공 (배포를 서비스 1개로 끝낼 수 있음)
//
// 환경변수
//   PORT         : 서버 포트 (기본 3001, Render 같은 호스팅은 자동으로 넣어 줌)
//   CORS_ORIGIN  : 프론트엔드를 다른 주소에 따로 올렸을 때 허용할 주소 (쉼표로 여러 개)
//                  예) https://my-cards.netlify.app
//                  비워 두면 모든 주소 허용 (개발용)
//   STATIC_DIR   : 웹사이트 빌드 폴더 위치 (기본 ../client/dist)
//   ENABLE_METRICS : 1 이면 개발자용 서버 측정 켜기 (/debug/metrics, 화면 성능 창의 서버 항목)
//
// ※ 게임방은 메모리에만 저장됩니다. 서버를 재시작하거나 다시 배포하면 모든 방이 사라집니다.
// =====================================================================
import { APP_VERSION } from "../../shared/version";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { resolveDeckFile } from "./decks";
import { metricsEnabled, snapshot } from "./metrics";
import { RoomManager } from "./rooms";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const STATIC_DIR = resolve(process.env.STATIC_DIR || join(here, "../../client/dist"));
const CORS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://x");
  if (url.pathname === "/version") {
    // 배포 확인용: 브라우저로 https://내주소/version 을 열면 지금 실행 중인 서버 버전
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(APP_VERSION);
    return;
  }
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (url.pathname === "/debug/metrics") {
    // ENABLE_METRICS=1 일 때만 (숫자 통계만 있고 게임 내용은 없음)
    res.writeHead(metricsEnabled ? 200 : 404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(metricsEnabled ? JSON.stringify(snapshot(manager.counts()), null, 2) : '{"error":"ENABLE_METRICS=1 로 서버를 실행하면 볼 수 있어요"}');
    return;
  }
  if (url.pathname.startsWith("/decks/")) {
    // 이미지 카드 그림 (decks/ 폴더). 뒷면으로 놓인 카드는 어떤 그림인지 전송되지 않으므로 그림 파일 자체는 공개해도 안전
    const f = resolveDeckFile(decodeURIComponent(url.pathname));
    if (!f) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(f).toLowerCase()] || "application/octet-stream", "cache-control": "public, max-age=86400" });
    createReadStream(f).pipe(res);
    return;
  }
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("실시간 서버가 실행 중입니다. (웹사이트 화면은 client 폴더에서 npm run dev 로 실행하거나, npm run build 후 이 주소로 접속하세요)");
    return;
  }
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, "index.html"); // SPA
  const type = MIME[extname(file)] || "application/octet-stream";
  const cache = file.includes(`${join(STATIC_DIR, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  createReadStream(file).pipe(res);
}

const http = createServer(serveStatic);
const io = new Server(http, {
  cors: { origin: CORS.length ? CORS : true, methods: ["GET", "POST"] },
  pingInterval: 10_000,
  pingTimeout: 12_000,
  maxHttpBufferSize: 200_000,
});

const manager = new RoomManager(io);
io.on("connection", (socket) => manager.handle(socket));

http.listen(PORT, () => {
  console.log(`\n🃏 테이블탑 카드 서버 실행 중: http://localhost:${PORT}  (버전 ${APP_VERSION})`);
  console.log(`   서버 측정: ${metricsEnabled ? "켜짐 (/debug/metrics)" : "꺼짐 (ENABLE_METRICS=1 로 켜기)"}`);
  console.log(`   CORS 허용: ${CORS.length ? CORS.join(", ") : "모든 주소 (개발 모드)"}`);
  console.log(`   웹사이트 파일: ${existsSync(STATIC_DIR) ? STATIC_DIR : "없음 (개발 중에는 Vite 개발 서버 사용)"}`);
  console.log("   ※ 게임방은 메모리에만 저장돼요. 서버를 재시작하면 모든 방이 사라집니다.\n");
});
