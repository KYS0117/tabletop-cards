import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./net";
import "./styles.css";

// 모바일에서 두 손가락 확대/당겨서 새로고침 등 브라우저 기본 동작 막기 (테이블은 직접 확대/축소)
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
