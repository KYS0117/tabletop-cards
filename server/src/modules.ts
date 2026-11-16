// =====================================================================
// 서버 기능 모듈 목록
// 새 게임(예: 야추, 그림 퀴즈)을 추가할 때:
//   1) server/src/handlers/<게임>.ts 에 registerXxxHandlers(r, deps) 작성
//   2) 아래 목록에 한 줄 추가
// 기존 모듈(sandbox 등)은 수정할 필요가 없습니다.
// =====================================================================
import type { Router } from "./router";
import type { ServerCounts } from "./metrics";
import { registerSandboxHandlers } from "./handlers/sandbox";
import { registerDebugHandlers } from "./handlers/debug";
import { registerToolHandlers } from "./handlers/tools";

export interface ModuleDeps {
  counts: () => ServerCounts;
}

export interface HandlerModule {
  id: string;
  register: (r: Router, deps: ModuleDeps) => void;
}

export const HANDLER_MODULES: HandlerModule[] = [
  { id: "sandbox", register: (r) => registerSandboxHandlers(r) },
  { id: "tools", register: (r) => registerToolHandlers(r) },
  { id: "debug", register: registerDebugHandlers },
];
