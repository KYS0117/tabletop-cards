/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** 실시간 서버 주소. 프론트엔드와 서버를 다른 곳에 배포할 때만 설정 (예: https://my-card-server.onrender.com) */
  readonly VITE_SERVER_URL?: string;
}
