import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 /socket.io 요청과 카드 그림(/decks)을 로컬 실시간 서버(3001번 포트)로 넘겨 줍니다.
// 그래서 휴대폰에서 http://<내PC IP>:5173 으로 접속해도 같은 서버에 연결돼요.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    fs: { allow: [".."] }, // ../shared 폴더 사용 허용
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true, changeOrigin: true },
      "/decks": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
