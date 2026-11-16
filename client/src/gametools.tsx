// =====================================================================
// 게임 도구: 게임 선택 · 공용 타이머 · 반지판 · 직접 쓰는 카드 · 소리 · 승리 배너 · 몰래 보기
// 타이머는 누구나, 게임 선택·배경음악 곡은 방장, 반지는 프로포즈 받는 사람만 (방장은 고치기 가능)
// =====================================================================
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { CUSTOM_LINES_MAX, CUSTOM_TEXT_MAX, TIMER_MAX_SEC, type BgmTrack, type PresetId } from "../../shared/protocol";
import { CardFace } from "./CardFace";
import { peekHandledByGame } from "./games";
import { act, request } from "./net";
import { setPrefs, usePrefs } from "./prefs";
import * as sound from "./sound";
import { isHostMe, myId, serverNow, setState, toast, useStore } from "./store";

export const GAMES: { id: PresetId; icon: string; name: string; desc: string }[] = [
  {
    id: "propose",
    icon: "💍",
    name: "방금 떠올린 프로포즈의 말을 너에게 바칠게",
    desc: "라운드마다 한 명이 프로포즈를 받아요. 나머지는 기본 카드 6장 + 단어 카드 6장으로 문장을 만들어 프로포즈하고, 받는 사람만 가장 마음에 든 한 명에게 반지를 줘요. 반지 3개면 승리! (✍ 직접 쓴 카드 가능)",
  },
  { id: "uno", icon: "🌈", name: "우노 (규칙 자동)", desc: "차례·낼 수 있는 카드·스킵·리버스·+2·+4·색 고르기·우노 안 외치면 잡기까지 자동이에요. 손패를 다 내면 승리!" },
  {
    id: "cockroach",
    icon: "🪳",
    name: "바퀴벌레 포커 (규칙 자동)",
    desc: "64장을 모두 나눠 갖고, 차례인 사람이 카드를 뒷면으로 넘기며 \"이건 ○○야!\" 선언. 받은 사람은 진짜/거짓말을 맞히거나 몰래 보고 다른 사람에게 넘겨요. 같은 벌레 벌칙 카드 4장이면 패배!",
  },
  { id: "free", icon: "🂠", name: "자유 테이블 (트럼프)", desc: "트럼프 54장 덱 하나만 놓고 마음대로 놀아요. 규칙 없음." },
];

const gameOf = (id: PresetId | undefined) => GAMES.find((g) => g.id === id) ?? GAMES.find((g) => g.id === "free")!;

const stop = (e: React.PointerEvent) => e.stopPropagation();

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 남은 시간 (서버 시계 기준이라 모두에게 같게 보임) */
function useRemaining() {
  const room = useStore().room!;
  const t = room.timer;
  const calc = () => (t.running && t.endsAt ? Math.max(0, t.endsAt - serverNow()) : t.remainingMs);
  const [ms, setMs] = useState(calc);
  useEffect(() => {
    setMs(calc());
    if (!t.running) return;
    const id = window.setInterval(() => setMs(calc()), 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.running, t.endsAt, t.remainingMs]);
  return { ms, t };
}

// ---------------------------------------------------------------------
// 화면 위쪽 게임 바
// ---------------------------------------------------------------------
type Pop = "timer" | "score" | "sound" | null;

export function GameBar({ onPickGame, onCustom }: { onPickGame: () => void; onCustom: () => void }) {
  const st = useStore();
  const room = st.room!;
  const prefs = usePrefs();
  const [pop, setPop] = useState<Pop>(null);
  const { ms, t } = useRemaining();
  const game = gameOf(room.preset);
  const host = isHostMe();
  const me = room.players.find((p) => p.id === myId());

  // 타이머 소리: 마지막 5초 똑딱, 0초 알람 (모든 사람 기기에서 동시에)
  // 서버가 끝난 타이머를 "멈춤·0초"로 정리해서 보내 줄 수도 있으므로 두 경우 모두 알람
  const lastSec = useRef<number | null>(null);
  const armed = useRef<number | null>(null);
  const finished = !t.running && t.remainingMs <= 0;
  useEffect(() => {
    if (t.running) {
      if (t.endsAt) armed.current = t.endsAt;
      const sec = Math.ceil(ms / 1000);
      if (sec !== lastSec.current) {
        lastSec.current = sec;
        if (sec > 0 && sec <= 5) sound.sfx("tick");
      }
    } else lastSec.current = null;
    if ((t.running && ms <= 0) || finished) {
      if (armed.current !== null) {
        armed.current = null;
        sound.sfx("alarm");
        navigator.vibrate?.([120, 80, 120]);
        toast("⏰ 시간이 다 됐어요!", "warn");
      }
    } else if (!t.running) armed.current = null; // 멈춤·처음부터
  }, [ms, t.running, t.endsAt, finished]);

  const timeUp = (t.running && ms <= 0) || finished;
  const urgent = t.running && ms > 0 && ms <= 5000;

  return (
    <div className="gamebar" onPointerDown={stop}>
      <button className="gchip game" onClick={host ? onPickGame : () => toast("게임은 방장이 고를 수 있어요")} title={game.name}>
        <span>{game.icon}</span>
        <span className="gname">{game.name}</span>
        {host && <span className="caret">▾</span>}
      </button>

      <div className="gpop-wrap">
        <button className={`gchip timer ${t.running ? "run" : ""} ${urgent ? "urgent" : ""} ${timeUp ? "up" : ""}`} onClick={() => setPop(pop === "timer" ? null : "timer")} title="타이머">
          ⏱ <b>{fmt(ms)}</b>
        </button>
        {pop === "timer" && <TimerPop ms={ms} onClose={() => setPop(null)} />}
      </div>

      {room.score && (
        <div className="gpop-wrap">
          <button className="gchip score" onClick={() => setPop(pop === "score" ? null : "score")} title={`${room.score.label} 현황`}>
            {room.score.icon} <b>{me?.score ?? 0}</b>/{room.score.goal}
          </button>
          {pop === "score" && <ScorePop onClose={() => setPop(null)} />}
        </div>
      )}

      {room.preset === "propose" && (
        <button className="gchip" onClick={onCustom} title="직접 쓰는 카드 만들기 (프로포즈 게임)">
          ✍<span className="hide-xs"> 카드 쓰기</span>
        </button>
      )}

      <div className="gpop-wrap">
        <button
          className={`gchip ${prefs.muted ? "muted" : ""}`}
          onClick={() => {
            sound.unlock();
            setPop(pop === "sound" ? null : "sound");
          }}
          title="소리"
        >
          {prefs.muted ? "🔇" : "🔊"}
        </button>
        {pop === "sound" && (
          <div className="gpop right" onPointerDown={stop}>
            <SoundSettings host={host} />
            <button className="btn wide" onClick={() => setPop(null)}>
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 타이머 창
// ---------------------------------------------------------------------
const TIMER_PRESETS = [10, 20, 30, 45, 60, 90, 120, 180, 240, 300];

function TimerPop({ ms, onClose }: { ms: number; onClose: () => void }) {
  const room = useStore().room!;
  const t = room.timer;
  const durS = Math.round(t.durationMs / 1000);
  const [custom, setCustom] = useState(String(durS));
  const setSec = (s: number) => act("timer:set", { seconds: s });
  return (
    <div className="gpop" onPointerDown={stop}>
      <div className="pop-title">⏱ 타이머 (모두에게 같이 보여요)</div>
      <div className="timer-big">{fmt(ms)}</div>
      <div className="row">
        {t.running ? (
          <button className="btn" onClick={() => act("timer:pause", {})}>
            ⏸ 멈춤
          </button>
        ) : (
          <button className="btn primary" onClick={() => act("timer:start", {})}>
            ▶ {t.remainingMs < t.durationMs && t.remainingMs > 0 ? "이어서" : "시작"}
          </button>
        )}
        <button className="btn" onClick={() => act("timer:reset", {})}>
          ↺ 처음부터
        </button>
      </div>
      <div className="pop-sub">시간 설정</div>
      <div className="seg wrap">
        {TIMER_PRESETS.map((s) => (
          <button key={s} className={durS === s ? "on" : ""} onClick={() => setSec(s)}>
            {s < 60 ? `${s}초` : s % 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s / 60}분`}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          type="number"
          inputMode="numeric"
          min={5}
          max={TIMER_MAX_SEC}
          value={custom}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustom(e.target.value)}
          aria-label="초 직접 입력"
        />
        <span className="muted">초</span>
        <button className="btn" onClick={() => setSec(Math.max(5, Math.min(TIMER_MAX_SEC, Math.floor(Number(custom)) || 60)))}>
          적용
        </button>
      </div>
      <div className="muted small" style={{ marginTop: -4 }}>
        최대 5분 (300초)
      </div>
      <button className="btn ghost wide" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// 반지(점수) 창
// ---------------------------------------------------------------------
function ScorePop({ onClose }: { onClose: () => void }) {
  const room = useStore().room!;
  const sc = room.score!;
  const me = myId();
  const host = isHostMe();
  const pg = room.game?.kind === "propose" ? room.game : null;
  const receiver = pg ? room.players.find((p) => p.id === pg.receiver) : undefined;
  const iAmReceiver = !!pg && pg.receiver === me;
  const players = [...room.players].sort((a, b) => b.score - a.score);
  return (
    <div className="gpop" onPointerDown={stop}>
      <div className="pop-title">
        {sc.icon} {sc.label} — {sc.goal}개 모으면 승리
      </div>
      {pg && (
        <p className="muted small">
          이번 라운드 받는 사람: <b>{receiver?.nickname ?? "?"}</b>
          {iAmReceiver ? (pg.given ? " · 반지를 줬어요" : " · 가장 마음에 든 프로포즈에 반지를 주세요 (한 번만)") : " · 반지는 받는 사람만 줄 수 있어요"}
        </p>
      )}
      {players.map((p) => (
        <div key={p.id} className={`srow ${p.connected ? "" : "off"} ${p.score >= sc.goal ? "won" : ""} ${pg?.given === p.id ? "got" : ""}`}>
          <i className="pdot" style={{ background: p.color }} />
          <span className="pname">
            {pg?.receiver === p.id && "💌 "}
            {p.nickname}
            {p.id === me && " (나)"}
          </span>
          <span className="rings">
            {Array.from({ length: Math.max(sc.goal, p.score) }, (_, i) => (
              <span key={i} className={i < p.score ? "on" : ""}>
                {sc.icon}
              </span>
            ))}
          </span>
          {iAmReceiver && !pg!.given && p.id !== me && (
            <button className="mini give" onClick={() => act("propose:ring", { to: p.id })} title={`${p.nickname}님에게 반지 주기`}>
              ＋{sc.icon} 주기
            </button>
          )}
          {host && (
            <>
              <button className="mini" onClick={() => act("score:add", { playerId: p.id, delta: -1 })} disabled={p.score <= 0} title="방장: 하나 빼기 (실수 바로잡기)">
                −
              </button>
              <button className="mini" onClick={() => act("score:add", { playerId: p.id, delta: 1 })} title="방장: 하나 더하기 (실수 바로잡기)">
                ＋
              </button>
            </>
          )}
        </div>
      ))}
      {host && <p className="muted small">방장은 − / ＋ 로 실수를 바로잡을 수 있어요.</p>}
      <button className="btn ghost wide" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// 소리 설정 (게임 바 + 설정 창에서 같이 사용)
// ---------------------------------------------------------------------
const TRACK_LIST: { id: BgmTrack | null; label: string }[] = [
  { id: null, label: "끄기" },
  ...(Object.keys(sound.TRACKS) as BgmTrack[]).map((id) => ({ id, label: sound.TRACKS[id].name })),
];

export function SoundSettings({ host }: { host: boolean }) {
  const prefs = usePrefs();
  const room = useStore().room!;
  const [ready, setReady] = useState(sound.soundReady());
  useEffect(() => sound.onSoundState(() => setReady(sound.soundReady())), []);
  const slider = (key: "volMaster" | "volBgm" | "volSfx" | "volAlert", label: string) => (
    <label className="vol-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={prefs[key]}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ [key]: Number(e.target.value) } as Partial<typeof prefs>)}
        onPointerUp={() => key !== "volBgm" && sound.sfx(key === "volAlert" ? "ring" : "place")}
      />
      <b>{prefs[key]}</b>
    </label>
  );
  return (
    <div className="sound-settings">
      {!ready && (
        <button className="btn primary wide" onClick={() => sound.unlock()}>
          🔈 소리 켜기 (브라우저가 처음 한 번 눌러야 소리를 허용해요)
        </button>
      )}
      <label className="check-row">
        <input type="checkbox" checked={prefs.muted} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ muted: e.target.checked })} />
        모든 소리 끄기
      </label>
      {slider("volMaster", "전체")}
      {slider("volBgm", "배경음악")}
      {slider("volSfx", "효과음")}
      {slider("volAlert", "알림")}
      <label className="check-row">
        <input type="checkbox" checked={prefs.bgmOn} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ bgmOn: e.target.checked })} />
        나는 배경음악 듣기
      </label>
      <label className="check-row">
        <input type="checkbox" checked={prefs.sfxOn} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ sfxOn: e.target.checked })} />
        카드 효과음 (집기·놓기·뒤집기·섞기)
      </label>
      <div className="pop-sub">배경음악 {host ? "(방장이 고르면 모두에게 나와요)" : "(방장이 골라요)"}</div>
      <div className="seg wrap">
        {TRACK_LIST.map((tr) => (
          <button key={tr.label} disabled={!host} className={room.bgm.track === tr.id ? "on" : ""} onClick={() => act("bgm:set", { track: tr.id })}>
            {tr.id ? "♪ " : ""}
            {tr.label}
          </button>
        ))}
      </div>
      <p className="muted small">볼륨은 이 기기에만 저장돼요. 배경음악은 브라우저가 직접 만들어 연주해서 음원 파일이 없어요.</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// 게임 선택 창 (방장)
// ---------------------------------------------------------------------
export function GameSelectModal({ onClose, askConfirm }: { onClose: () => void; askConfirm: (text: string, onOk: () => void) => void }) {
  const st = useStore();
  const room = st.room!;
  const busy = st.objects.size > 0 || room.players.some((p) => p.handCount > 0);
  const pick = (id: PresetId) => {
    const run = () => {
      request("game:preset", { preset: id }).then((r) => {
        if (!r.ok) toast(r.error, "warn");
      });
      onClose();
    };
    if (busy) askConfirm(`"${gameOf(id).name}" 게임을 준비할까요? 테이블의 카드와 모든 사람의 손패가 정리되고, ${room.score ? "반지도 0개로 돌아가요." : "새로 시작해요."}`, run);
    else run();
  };
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal" onPointerDown={stop}>
        <h2>🎲 게임 고르기</h2>
        <p className="muted">고르면 카드 배치와 나눠주기를 자동으로 해 줘요. 진행 규칙은 자유예요.</p>
        <div className="game-list">
          {GAMES.map((g) => (
            <button key={g.id} className={`game-item ${room.preset === g.id ? "on" : ""}`} onClick={() => pick(g.id)}>
              <span className="gi-icon">{g.icon}</span>
              <span className="gi-text">
                <b>{g.name}</b>
                <small>{g.desc}</small>
              </span>
            </button>
          ))}
        </div>
        <button className="btn ghost wide" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 직접 쓰는 카드 창
// ---------------------------------------------------------------------
export function CustomCardModal({ stackId, onClose }: { stackId?: string; onClose: () => void }) {
  const st = useStore();
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"deck" | "hand">("deck");
  const [busy, setBusy] = useState(false);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tooLong = lines.filter((l) => [...l].length > CUSTOM_TEXT_MAX).length;
  const deckName = stackId ? (st.objects.get(stackId) as { label?: string } | undefined)?.label : undefined;
  const submit = () => {
    if (!lines.length || busy) return;
    setBusy(true);
    request<"custom:create", { count: number }>("custom:create", { lines: lines.slice(0, CUSTOM_LINES_MAX), target, stackId }).then((r) => {
      setBusy(false);
      if (!r.ok) {
        toast(r.error, "warn");
        return;
      }
      toast(target === "deck" ? `✍ ${r.count}장을 덱에 섞었어요` : `✍ ${r.count}장을 손패에 넣었어요`);
      onClose();
    });
  };
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal" onPointerDown={stop}>
        <h2>✍ 직접 쓰는 카드</h2>
        <p className="muted">
          한 줄에 카드 한 장이에요 (한 장에 {CUSTOM_TEXT_MAX}자까지, 한 번에 {CUSTOM_LINES_MAX}장까지). 덱에 섞으면 뒷면이 같아서 누가 쓴 카드인지 몰라요.
        </p>
        <textarea
          className="custom-text"
          rows={6}
          autoFocus
          value={text}
          placeholder={"예)\n너의 웃음은\n세상에서 제일\n김치찌개처럼 따뜻해"}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
        />
        <div className="muted small">
          {lines.length}장{tooLong ? ` · ${tooLong}장은 ${CUSTOM_TEXT_MAX}자가 넘어서 뒷부분이 잘려요` : ""}
          {lines.length > CUSTOM_LINES_MAX ? ` · ${CUSTOM_LINES_MAX}장까지만 만들어요` : ""}
        </div>
        <div className="seg">
          <button className={target === "deck" ? "on" : ""} onClick={() => setTarget("deck")}>
            🔀 {deckName ? `"${deckName}"에` : "덱에"} 섞기
          </button>
          <button className={target === "hand" ? "on" : ""} onClick={() => setTarget("hand")}>
            ✋ 내 손패로
          </button>
        </div>
        {lines.length > 0 && (
          <div className="custom-preview">
            {lines.slice(0, 6).map((l, i) => (
              <div key={i} className="cp-card">
                {[...l].slice(0, CUSTOM_TEXT_MAX).join("")}
              </div>
            ))}
            {lines.length > 6 && <div className="cp-more">+{lines.length - 6}</div>}
          </div>
        )}
        <div className="row">
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!lines.length || busy} onClick={submit}>
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 승리 배너
// ---------------------------------------------------------------------
export function Banner() {
  const b = useStore().banner;
  if (!b) return null;
  return (
    <div className={`banner ${b.kind}`}>
      <div className="banner-in">{b.text}</div>
      {b.kind === "win" && (
        <div className="confetti" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <i key={i} style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 👁 몰래 본 카드 (나에게만)
// ---------------------------------------------------------------------
export function PeekModal() {
  const pk = useStore().peek;
  if (!pk || peekHandledByGame()) return null; // 바퀴벌레 포커는 넘기기 창에서 보여 줌
  const close = () => setState({ peek: null });
  return (
    <div className="modal-bg" onPointerDown={close}>
      <div className="modal small peek" onPointerDown={stop}>
        <h3>👁 몰래 본 카드</h3>
        <div className={`peek-card ${pk.shape === "L" ? "shape-L" : ""}`} style={{ "--cs": 1.8 } as React.CSSProperties}>
          <CardFace face={pk.face} back={pk.back} />
        </div>
        <p className="muted small">나에게만 보여요. 다른 사람들은 "몰래 봤다"는 것만 알아요. 카드는 테이블에 뒷면 그대로예요.</p>
        <button className="btn primary wide" onClick={close}>
          확인
        </button>
      </div>
    </div>
  );
}
