// =====================================================================
// 기능 모듈: 게임 선택, 커스텀 카드, 점수(반지), 공용 타이머, 배경음악, 규칙 자동 게임(우노·바퀴벌레 포커·프로포즈 라운드)
// =====================================================================
import type { Ctx, Router } from "../router";
import { ProposeGame } from "../games/propose";
import { RoachGame } from "../games/roach";
import { UnoGame } from "../games/uno";
import { applyPreset } from "../presets";
import { isId } from "../util";

export function registerToolHandlers(r: Router) {
  r.hostOnly("game:preset", (c, p) => applyPreset(c.room, p.preset, c.player.nickname) ?? undefined);

  r.on("custom:create", (c, p) => c.room.customCreate(c.player, p.lines, p.target === "hand" ? "hand" : "deck", isId(p.stackId) ? p.stackId : undefined));

  r.hostOnly("score:add", (c, p) => (isId(p.playerId) ? (c.room.scoreAdd(c.player, p.playerId, Number(p.delta)) ?? undefined) : "잘못된 요청이에요"));

  // 타이머는 누구나 조작 (자유 진행)
  r.on("timer:set", (c, p) => c.room.timerSet(Number(p.seconds)) ?? undefined);
  r.on("timer:start", (c) => c.room.timerStart());
  r.on("timer:pause", (c) => c.room.timerPause());
  r.on("timer:reset", (c) => c.room.timerReset());

  // 배경음악은 방장만 (각자 볼륨은 개인 설정)
  r.hostOnly("bgm:set", (c, p) => c.room.setBgm(p.track ?? null) ?? undefined);

  // ---------------- 규칙 자동 게임 ----------------
  const uno = (c: Ctx) => (c.room.game instanceof UnoGame ? c.room.game : null);
  const roach = (c: Ctx) => (c.room.game instanceof RoachGame ? c.room.game : null);
  const propose = (c: Ctx) => (c.room.game instanceof ProposeGame ? c.room.game : null);
  const NO_UNO = "우노 게임 중이 아니에요";
  const NO_ROACH = "바퀴벌레 포커 게임 중이 아니에요";
  const NO_PROPOSE = "프로포즈 게임 중이 아니에요";

  r.on("uno:call", (c) => (!uno(c) ? NO_UNO : (uno(c)!.callUno(c.player) ?? undefined)));
  r.on("uno:play", (c, p) => (!uno(c) ? NO_UNO : isId(p.cardId) ? (uno(c)!.play(c.player, p.cardId, p.color) ?? undefined) : "잘못된 요청이에요"));
  r.on("uno:draw", (c) => (!uno(c) ? NO_UNO : (uno(c)!.drawOne(c.player) ?? undefined)));
  r.on("uno:pass", (c) => (!uno(c) ? NO_UNO : (uno(c)!.pass(c.player) ?? undefined)));
  r.on("uno:catch", (c, p) => (!uno(c) ? NO_UNO : isId(p.playerId) ? (uno(c)!.catchUno(c.player, p.playerId) ?? undefined) : "잘못된 요청이에요"));

  r.on("roach:give", (c, p) =>
    !roach(c) ? NO_ROACH : isId(p.cardId) && isId(p.to) ? (roach(c)!.give(c.player, p.cardId, p.to, p.creature) ?? undefined) : "잘못된 요청이에요",
  );
  r.on("roach:answer", (c, p) => (!roach(c) ? NO_ROACH : (roach(c)!.answer(c.player, p.answer) ?? undefined)));
  r.on("roach:peek", (c) => (!roach(c) ? NO_ROACH : (roach(c)!.peek(c.player) ?? undefined)));
  r.on("roach:pass", (c, p) => (!roach(c) ? NO_ROACH : isId(p.to) ? (roach(c)!.pass(c.player, p.to, p.creature) ?? undefined) : "잘못된 요청이에요"));

  r.on("propose:ring", (c, p) => (!propose(c) ? NO_PROPOSE : isId(p.to) ? (propose(c)!.giveRing(c.player, p.to) ?? undefined) : "잘못된 요청이에요"));
  r.on("propose:next", (c) => (!propose(c) ? NO_PROPOSE : (propose(c)!.next(c.player) ?? undefined)));
  r.on("propose:receiver", (c, p) => (!propose(c) ? NO_PROPOSE : isId(p.playerId) ? (propose(c)!.setReceiver(c.player, p.playerId) ?? undefined) : "잘못된 요청이에요"));

  r.hostOnly("game:skip", (c) => (c.room.game?.skip ? (c.room.game.skip(c.player) ?? undefined) : "진행 중인 규칙 게임이 없어요"));
}
