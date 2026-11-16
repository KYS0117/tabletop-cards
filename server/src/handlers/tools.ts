// =====================================================================
// 기능 모듈: 게임 선택, 커스텀 카드, 점수(반지), 공용 타이머, 배경음악, 우노!, 바퀴벌레 포커 선언
// =====================================================================
import type { Router } from "../router";
import { applyPreset } from "../presets";
import { isId } from "../util";

export function registerToolHandlers(r: Router) {
  r.hostOnly("game:preset", (c, p) => applyPreset(c.room, p.preset, c.player.nickname) ?? undefined);

  r.on("custom:create", (c, p) => c.room.customCreate(c.player, p.lines, p.target === "hand" ? "hand" : "deck", isId(p.stackId) ? p.stackId : undefined));

  r.on("score:add", (c, p) => (isId(p.playerId) ? (c.room.scoreAdd(c.player, p.playerId, Number(p.delta)) ?? undefined) : "잘못된 요청이에요"));

  // 타이머는 누구나 조작 (자유 진행)
  r.on("timer:set", (c, p) => c.room.timerSet(Number(p.seconds)) ?? undefined);
  r.on("timer:start", (c) => c.room.timerStart());
  r.on("timer:pause", (c) => c.room.timerPause());
  r.on("timer:reset", (c) => c.room.timerReset());

  // 배경음악은 방장만 (각자 볼륨은 개인 설정)
  r.hostOnly("bgm:set", (c, p) => c.room.setBgm(p.track ?? null) ?? undefined);

  // 우노! 외치기
  r.on("uno:call", (c) => c.room.callUno(c.player) ?? undefined);

  // 바퀴벌레 포커: 선언 / 대답
  r.on("claim:say", (c, p) => (isId(p.to) && typeof p.creature === "string" ? (c.room.sayClaim(c.player, p.to, p.creature) ?? undefined) : "잘못된 요청이에요"));
  r.on("claim:answer", (c, p) => c.room.answerClaim(c.player, p.answer) ?? undefined);
}
