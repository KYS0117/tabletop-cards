// =====================================================================
// 규칙 자동 게임 화면: 우노 · 바퀴벌레 포커 · 프로포즈 라운드
//  - 게임 판정은 모두 서버가 합니다. 이 파일은 상태를 보여 주고 버튼으로 요청만 보냅니다.
//  - 손패 카드 탭(클릭) → handTap(): 우노는 내기, 바퀴벌레 포커는 넘기기 창
// =====================================================================
import { useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { CREATURES, type CreatureId, type PubLobby, type PubRoach, type PubUno, type UnoColor } from "../../shared/protocol";
import { CardFace } from "./CardFace";
import { request } from "./net";
import { getPrefs } from "./prefs";
import { getState, isHostMe, myId, playerById, setState, toast, useStore } from "./store";

const stop = (e: React.PointerEvent) => e.stopPropagation();
const COLOR_NAME: Record<UnoColor, string> = { R: "빨강", Y: "노랑", G: "초록", B: "파랑" };
const nick = (id: string | null | undefined) => (id ? (playerById(id)?.nickname ?? "?") : "?");
const cr = (id: CreatureId) => CREATURES.find((c) => c.id === id)!;

function send(ev: Parameters<typeof request>[0], data: Record<string, unknown>) {
  return request(ev, data as never).then((r) => {
    if (!r.ok) toast(r.error, "warn");
    return r.ok;
  });
}

// ---------------------------------------------------------------------
// 우노 도우미
// ---------------------------------------------------------------------
export function parseUno(face: string): { color: UnoColor | "W"; value: string } | null {
  const m = /^U:([RYGBW])-(\w+)$/.exec(face);
  return m ? { color: m[1] as UnoColor | "W", value: m[2] } : null;
}

function unoTop(g: PubUno): string | null {
  const pile = getState().objects.get(g.pileId);
  return pile && pile.kind === "stack" ? pile.top : null;
}

/** 우노 1장 뽑기: 뽑은 카드 id 를 기억 (그 카드만 낼 수 있어서 화면에 표시) */
export function unoDraw() {
  const before = new Set(getState().hand.map((h) => h.id));
  return send("uno:draw", {}).then((ok) => {
    if (ok) setState({ drawnCardId: getState().hand.find((h) => !before.has(h.id))?.id ?? null });
  });
}

/** 내 손패 카드가 지금 낼 수 있는 카드인지 (화면 표시용 — 최종 판정은 서버) */
export function unoPlayable(face: string, g: PubUno, cardId: string): boolean {
  if (g.turn !== myId() || g.winner) return false;
  const drawn = getState().drawnCardId;
  if (g.drew && drawn && cardId !== drawn) return false;
  const c = parseUno(face);
  if (!c) return false;
  // 와일드 +4: 지금 색 카드가 손에 없을 때만 (공식 규칙)
  if (c.value === "D4") return !getState().hand.some((h) => h.id !== cardId && parseUno(h.face)?.color === g.color);
  if (c.color === "W") return true;
  const t = unoTop(g);
  const tv = t ? parseUno(t)?.value : null;
  return c.color === g.color || c.value === tv;
}

// ---------------------------------------------------------------------
// 손패·덱 탭
// ---------------------------------------------------------------------
/** 손패 카드를 탭했을 때 (true 를 돌려주면 게임이 처리함) */
export function handTap(cardId: string): boolean {
  const st = getState();
  const g = st.room?.game;
  const card = st.hand.find((h) => h.id === cardId);
  if (!g || !card) return false;
  if (g.kind === "uno") {
    if (g.winner) return true;
    if (g.turn !== myId()) {
      toast(`지금은 ${nick(g.turn)}님 차례예요`);
      return true;
    }
    if (parseUno(card.face)?.color === "W") setState({ gameModal: { kind: "color", cardId } });
    else send("uno:play", { cardId });
    return true;
  }
  if (g.kind === "roach") {
    if (g.phase === "give" && g.active === myId()) setState({ gameModal: { kind: "roachGive", cardId } });
    else if (g.phase === "give") toast(`지금은 ${nick(g.active)}님이 카드를 넘길 차례예요`);
    else toast("지금 오가는 카드가 끝나면 진행돼요");
    return true;
  }
  return false;
}

/** 테이블의 게임 덱을 탭했을 때 (우노: 1장 뽑기) */
export function deckTap(objId: string): boolean {
  const g = getState().room?.game;
  if (g?.kind === "uno" && objId === g.deckId) {
    if (g.turn === myId() && !g.drew && !g.winner) unoDraw();
    else if (g.turn !== myId()) toast(`지금은 ${nick(g.turn)}님 차례예요`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// 화면 위쪽 게임 진행 표시줄
// ---------------------------------------------------------------------
export function GamePanel() {
  const room = useStore().room!;
  const g = room.game;
  if (!g) return null;
  if (g.kind === "lobby") return <LobbyPanel g={g} />;
  if (g.kind === "uno") return <UnoPanel g={g} />;
  if (g.kind === "roach") return <RoachPanel g={g} />;
  return <ProposePanel />;
}

function PlayerChip({ id, active, extra }: { id: string; active?: boolean; extra?: React.ReactNode }) {
  const p = playerById(id);
  return (
    <span data-pid={id} className={`pchip ${active ? "active" : ""} ${p?.connected ? "" : "off"}`} style={{ "--pc": p?.color ?? "#999" } as React.CSSProperties}>
      <i />
      {p?.nickname ?? "?"}
      {id === myId() && " (나)"}
      {extra}
    </span>
  );
}

function RestartButton({ label = "🔄 다시 하기" }: { label?: string }) {
  const room = useStore().room!;
  if (!isHostMe()) return <span className="muted small">방장이 다시 시작할 수 있어요</span>;
  return (
    <button className="mini cl-yes" onClick={() => send("game:preset", { preset: room.preset })}>
      {label}
    </button>
  );
}

/** 대기실: 사람이 다 모이면 방장이 "게임 시작" → 순서는 무작위 */
function LobbyPanel({ g }: { g: PubLobby }) {
  const host = isHostMe();
  const enough = g.players.length >= g.min;
  const title = g.game === "uno" ? "🌈 우노" : "🪳 바퀴벌레 포커";
  return (
    <div className={`game-panel lobby ${host && enough ? "mine" : ""}`} onPointerDown={stop}>
      <div className="gp-row">
        <b>{title} 대기실</b>
        <span className="muted small">· 참가 {g.players.length}명</span>
      </div>
      <div className="gp-row">
        {g.players.map((id) => (
          <PlayerChip key={id} id={id} />
        ))}
      </div>
      <div className="gp-row">
        {host ? (
          <button className="gbtn start" disabled={!enough} onClick={() => send("game:start", {})}>
            ▶ 게임 시작{enough ? "" : ` (${g.min}명 이상 필요)`}
          </button>
        ) : (
          <span className="muted small">방장이 "게임 시작"을 누르면 카드를 나누고 순서를 무작위로 정해요</span>
        )}
      </div>
    </div>
  );
}

function UnoPanel({ g }: { g: PubUno }) {
  const st = useStore();
  const me = myId();
  const mine = g.turn === me;
  return (
    <div className={`game-panel uno ${mine && !g.winner ? "mine" : ""}`} onPointerDown={stop}>
      <div className="gp-row">
        <span className={`uno-color c-${g.color}`} title="지금 색">
          {COLOR_NAME[g.color]}
        </span>
        <span className="gp-order">
          {g.order.map((id, i) => (
            <span key={id} className="gp-seat">
              {i > 0 && <span className="gp-arrow">{g.dir === 1 ? "→" : "←"}</span>}
              <PlayerChip id={id} active={g.turn === id} extra={<b className="cnt">{playerById(id)?.handCount ?? 0}{playerById(id)?.uno ? " 🔔" : ""}</b>} />
            </span>
          ))}
        </span>
      </div>
      <div className="gp-row small">
        {g.winner ? (
          <>
            <b>🎉 {nick(g.winner)}님 승리!</b>
            <RestartButton />
          </>
        ) : (
          <>
            <b>{mine ? (g.drew ? "뽑은 카드를 내거나 넘기세요" : "내 차례! 낼 카드를 탭하거나 덱을 눌러 뽑기") : `${nick(g.turn)}님 차례`}</b>
            {g.last && <span className="muted">· {g.last}</span>}
          </>
        )}
        {isHostMe() && !g.winner && st.room!.players.some((p) => p.id === g.turn && !p.connected) && (
          <button className="mini" onClick={() => send("game:skip", {})}>
            ⏭ 차례 넘기기
          </button>
        )}
      </div>
    </div>
  );
}

function RoachPanel({ g }: { g: PubRoach }) {
  const me = myId();
  const last = g.chain[g.chain.length - 1];
  const holder = g.phase === "respond" ? last?.to : null;
  const iHold = holder === me;
  const seen = new Set(g.chain.flatMap((c) => [c.from, c.to]));
  const canPass = iHold && g.order.some((id) => !seen.has(id) && playerById(id)?.connected);
  return (
    <div className={`game-panel roach ${(g.phase === "give" && g.active === me) || iHold ? "mine" : ""}`} onPointerDown={stop}>
      <div className="gp-row small">
        {g.phase === "give" && (
          <b>{g.active === me ? "내 차례! 넘길 카드를 손패에서 탭하세요" : `${nick(g.active)}님이 카드를 넘길 차례`}</b>
        )}
        {g.phase === "respond" &&
          g.chain.map((c, i) => (
            <span key={i} className={`claim ${i === g.chain.length - 1 ? "last" : "old"}`}>
              {nick(c.from)} → {c.to === me ? "나" : nick(c.to)}: "{cr(c.creature).icon} {cr(c.creature).name}야!"
            </span>
          ))}
        {g.phase === "reveal" && g.reveal && (
          <b className="reveal">
            {g.reveal.said === "yes" ? "🙆 진짜!" : "🙅 거짓말!"} → 정답 {cr(g.reveal.creature).icon} {cr(g.reveal.creature).name}{" "}
            {g.reveal.truth ? "(진짜였어요)" : "(거짓말이었어요)"} — {nick(g.reveal.taker)}님 벌칙
          </b>
        )}
        {g.phase === "over" && (
          <>
            <b>{g.loser ? `😱 ${nick(g.loser)}님 패배! (${g.loseReason})` : `게임 끝 (${g.loseReason})`}</b>
            <RestartButton />
          </>
        )}
      </div>
      {iHold && (
        <div className="gp-row">
          <span className="muted small">정말 {cr(last.creature).name}일까?</span>
          <button className="mini cl-yes" onClick={() => send("roach:answer", { answer: "yes" })}>
            🙆 진짜!
          </button>
          <button className="mini cl-no" onClick={() => send("roach:answer", { answer: "no" })}>
            🙅 거짓말!
          </button>
          {canPass && (
            <button className="mini" onClick={() => send("roach:peek", {})}>
              👁 몰래 보고 넘기기
            </button>
          )}
        </div>
      )}
      {holder && !iHold && <div className="gp-row small muted">{nick(holder)}님이 고민 중… {g.peekedBy === holder ? "(몰래 봤어요 → 넘길 거예요)" : ""}</div>}
      <div className="gp-row penalties">
        {g.order.map((id) => {
          const pen = g.penalties[id] ?? {};
          return (
            <span key={id} className={`pen ${g.loser === id ? "lost" : ""}`}>
              <PlayerChip id={id} active={(g.phase === "give" && g.active === id) || holder === id} extra={<b className="cnt">{playerById(id)?.handCount ?? 0}</b>} />
              {CREATURES.filter((c) => pen[c.id]).map((c) => (
                <span key={c.id} className={`pen-c ${(pen[c.id] ?? 0) >= 3 ? "danger" : ""}`} title={`${c.name} ${pen[c.id]}장`}>
                  {c.icon}
                  {pen[c.id]}
                </span>
              ))}
            </span>
          );
        })}
      </div>
      {isHostMe() && (g.phase === "respond" || g.phase === "give") && (
        <div className="gp-row small">
          <button className="mini" title="연결이 끊긴 사람 때문에 멈췄을 때" onClick={() => send("game:skip", {})}>
            ⏭ {g.phase === "respond" ? "오가는 카드 되돌리기" : "차례 넘기기"} (방장)
          </button>
        </div>
      )}
    </div>
  );
}

function ProposePanel() {
  const room = useStore().room!;
  const g = room.game?.kind === "propose" ? room.game : null;
  if (!g) return null;
  const me = myId();
  const iRecv = g.receiver === me;
  const host = isHostMe();
  const others = room.players.filter((p) => p.id !== g.receiver);
  return (
    <div className={`game-panel propose ${iRecv && !g.given ? "mine" : ""}`} onPointerDown={stop}>
      <div className="gp-row small">
        <b>
          💌 {g.round}라운드 · {iRecv ? "내가 프로포즈를 받아요!" : `${nick(g.receiver)}님이 프로포즈를 받아요`}
        </b>
        {g.given ? <span>💍 → {nick(g.given)}</span> : <span className="muted">{iRecv ? "가장 마음에 든 사람에게 반지를 주세요" : "카드를 테이블에 내서 프로포즈하세요"}</span>}
      </div>
      {iRecv && !g.given && (
        <div className="gp-row">
          {others.map((p) => (
            <button key={p.id} className="mini give" onClick={() => send("propose:ring", { to: p.id })}>
              💍 {p.nickname}
            </button>
          ))}
        </div>
      )}
      {((iRecv && g.given) || host) && (
        <div className="gp-row">
          {(g.given || host) && (
            <button className={`mini ${g.given ? "cl-yes" : ""}`} onClick={() => send("propose:next", {})} title="테이블 정리 · 기본 카드 회수 · 단어 카드 6장 보충 · 받는 사람 교대">
              다음 라운드 ▶{!g.given && host ? " (방장)" : ""}
            </button>
          )}
          {host && (
            <select
              className="mini-select"
              value={g.receiver ?? ""}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => send("propose:receiver", { playerId: e.target.value })}
              title="방장: 받는 사람 바꾸기"
            >
              {room.players.map((p) => (
                <option key={p.id} value={p.id}>
                  받는 사람: {p.nickname}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 아래쪽 버튼 (우노: 뽑기·넘기기·우노!)
// ---------------------------------------------------------------------
export function GameButtons() {
  const st = useStore();
  const g = st.room?.game;
  if (!g || g.kind !== "uno" || !g.order.includes(myId())) return null;
  const mine = g.turn === myId() && !g.winner;
  const me = myId();
  // 1장 남은 사람이 있으면 모두에게 "우노!" 버튼 — 본인이 먼저 누르면 안전, 남이 먼저 누르면 그 사람이 1장
  const minePending = g.pending.includes(me);
  const others = g.pending.filter((id) => id !== me);
  const called = !!st.room!.players.find((p) => p.id === me)?.uno && st.hand.length === 1;
  return (
    <div className="game-buttons" onPointerDown={stop}>
      {mine && !g.drew && (
        <button className="gbtn draw" onClick={() => unoDraw()}>
          🂠 1장 뽑기
        </button>
      )}
      {mine && g.drew && (
        <button className="gbtn" onClick={() => send("uno:pass", {})}>
          ⏭ 넘기기
        </button>
      )}
      {!g.winner && minePending && (
        <button className="uno-btn last" onClick={() => send("uno:call", {})} title="1장 남았어요! 먼저 눌러야 안전">
          🔔 우노!<small>빨리 누르세요!</small>
        </button>
      )}
      {!g.winner && called && !minePending && (
        <span className="uno-btn called">
          🔔 우노!<small>안전해요</small>
        </span>
      )}
      {!g.winner &&
        others.map((id) => (
          <button key={id} className="uno-btn catch" onClick={() => send("uno:call", { target: id })} title={`${nick(id)}님이 1장! 먼저 누르면 ${nick(id)}님이 1장 받아요`}>
            🔔 우노!<small>{nick(id)} 1장! 먼저 누르기</small>
          </button>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 창: 우노 색 고르기 / 바퀴벌레 넘기기 / 바퀴벌레 몰래 본 뒤 넘기기
// ---------------------------------------------------------------------
export function GameModals() {
  const st = useStore();
  const m = st.gameModal;
  const g = st.room?.game;
  // 바퀴벌레: 몰래 본 뒤 넘기기 창 (내가 받은 사람이고 몰래 봤을 때)
  if (g?.kind === "roach" && g.phase === "respond" && g.peekedBy === myId() && g.chain[g.chain.length - 1]?.to === myId()) {
    return <RoachPassModal g={g} />;
  }
  if (!m) return null;
  const close = () => setState({ gameModal: null });
  if (m.kind === "color") {
    return (
      <div className="modal-bg" onPointerDown={close}>
        <div className="modal small" onPointerDown={stop}>
          <h3>🌈 무슨 색으로 바꿀까요?</h3>
          <div className="color-grid">
            {(["R", "Y", "G", "B"] as UnoColor[]).map((c) => (
              <button
                key={c}
                className={`color-btn c-${c}`}
                onClick={() => {
                  close();
                  send("uno:play", { cardId: m.cardId, color: c });
                }}
              >
                {COLOR_NAME[c]}
              </button>
            ))}
          </div>
          <button className="btn ghost wide" onClick={close}>
            취소
          </button>
        </div>
      </div>
    );
  }
  if (m.kind === "roachGive" && g?.kind === "roach") return <RoachGiveModal g={g} cardId={m.cardId} />;
  return null;
}

function CreaturePicker({ value, onChange }: { value: CreatureId | null; onChange: (c: CreatureId) => void }) {
  return (
    <div className="creature-grid">
      {CREATURES.map((c) => (
        <button key={c.id} className={value === c.id ? "on" : ""} onClick={() => onChange(c.id)}>
          <span>{c.icon}</span>
          {c.name}
        </button>
      ))}
    </div>
  );
}

function TargetPicker({ ids, value, onChange }: { ids: string[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div className="seg wrap">
      {ids.map((id) => (
        <button key={id} className={value === id ? "on" : ""} onClick={() => onChange(id)}>
          <i className="pdot" style={{ background: playerById(id)?.color, display: "inline-block", marginRight: 6 }} />
          {nick(id)}
        </button>
      ))}
    </div>
  );
}

function RoachGiveModal({ g, cardId }: { g: PubRoach; cardId: string }) {
  const st = useStore();
  const card = st.hand.find((h) => h.id === cardId);
  const targets = g.order.filter((id) => id !== myId() && playerById(id)?.connected);
  const [to, setTo] = useState<string | null>(targets.length === 1 ? targets[0] : null);
  const [creature, setCreature] = useState<CreatureId | null>(null);
  const close = () => setState({ gameModal: null });
  if (!card) return null;
  return (
    <div className="modal-bg" onPointerDown={close}>
      <div className="modal roach-modal" onPointerDown={stop}>
        <h3>🪳 이 카드를 넘겨요 (뒷면으로)</h3>
        <div className="roach-pick">
          <div className="mini-card" style={{ "--cs": 0.9 } as React.CSSProperties}>
            <CardFace face={card.face} back={card.back} />
          </div>
          <div className="grow">
            <div className="pop-sub">누구에게?</div>
            <TargetPicker ids={targets} value={to} onChange={setTo} />
          </div>
        </div>
        <div className="pop-sub">"이건 ○○야!" (진짜든 거짓말이든)</div>
        <CreaturePicker value={creature} onChange={setCreature} />
        <div className="row">
          <button className="btn ghost" onClick={close}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={!to || !creature}
            onClick={() => send("roach:give", { cardId, to, creature }).then((ok) => ok && close())}
          >
            넘기기
          </button>
        </div>
      </div>
    </div>
  );
}

function RoachPassModal({ g }: { g: PubRoach }) {
  const st = useStore();
  const seen = new Set(g.chain.flatMap((c) => [c.from, c.to]));
  const targets = g.order.filter((id) => !seen.has(id) && playerById(id)?.connected);
  const [to, setTo] = useState<string | null>(targets.length === 1 ? targets[0] : null);
  const [creature, setCreature] = useState<CreatureId | null>(null);
  const pk = st.peek;
  const last = g.chain[g.chain.length - 1];
  return (
    <div className="modal-bg">
      <div className="modal roach-modal" onPointerDown={stop}>
        <h3>👁 몰래 본 카드 (나만 보여요)</h3>
        <div className="roach-pick">
          <div className="mini-card" style={{ "--cs": 0.9 } as React.CSSProperties}>
            {pk ? <CardFace face={pk.face} back={pk.back} /> : <div className="muted small">불러오는 중…</div>}
          </div>
          <div className="grow">
            <p className="muted small">
              {nick(last.from)}님은 "{cr(last.creature).icon} {cr(last.creature).name}"라고 했어요. 아직 이 카드를 안 본 사람에게 넘기세요.
            </p>
            <div className="pop-sub">누구에게?</div>
            <TargetPicker ids={targets} value={to} onChange={setTo} />
          </div>
        </div>
        <div className="pop-sub">"이건 ○○야!"</div>
        <CreaturePicker value={creature} onChange={setCreature} />
        <div className="row">
          <button
            className="btn primary wide"
            disabled={!to || !creature}
            onClick={() =>
              send("roach:pass", { to, creature }).then((ok) => {
                if (ok) setState({ peek: null });
              })
            }
          >
            넘기기
          </button>
        </div>
      </div>
    </div>
  );
}

/** 몰래 보기 창을 게임 창이 대신 보여 주는 중인지 (바퀴벌레 포커에서 넘기기 전) */
export function peekHandledByGame(): boolean {
  const g = getState().room?.game;
  return g?.kind === "roach" && g.phase === "respond" && g.peekedBy === myId();
}


// ---------------------------------------------------------------------
// 🌈 우노 특수 카드 연출 (색 바꾸기 · 건너뛰기 · 방향 바꾸기 · +2/+4 공격)
//  - 버린 카드 더미는 늘 "지금 색"으로 빛남
//  - 특수 카드를 내면 화면 가운데 큰 효과 + 소리, 공격은 카드가 맞은 사람에게 날아감
// ---------------------------------------------------------------------
const COLOR_HEX: Record<UnoColor, string> = { R: "#e53935", Y: "#f9b81b", G: "#3a9d48", B: "#1e74d6" };

export function UnoFxLayer() {
  const st = useStore();
  const g = st.room?.game?.kind === "uno" ? st.room.game : null;
  const fx = st.unoFx;
  const me = myId();
  const flyRef = useRef<HTMLDivElement>(null);
  const anim = getPrefs().animations;

  // 공격: 덱 위치 → 맞은 사람 이름표(위쪽 진행 표시줄)까지 카드가 날아감
  useLayoutEffect(() => {
    const box = flyRef.current;
    if (!box || !fx || fx.effect !== "draw" || !g) return;
    const deck = document.querySelector(`[data-oid="${CSS.escape(g.deckId)}"] .lift`)?.getBoundingClientRect();
    const chip = fx.target ? document.querySelector(`.game-panel [data-pid="${CSS.escape(fx.target)}"]`)?.getBoundingClientRect() : undefined;
    if (!deck || !chip) return;
    const to = { x: chip.left + chip.width / 2, y: chip.top + chip.height / 2 };
    box.querySelectorAll<HTMLElement>(".ufx-card").forEach((el, i) => {
      el.style.left = `${deck.left + deck.width / 2}px`;
      el.style.top = `${deck.top + deck.height / 2}px`;
      el.style.setProperty("--dx", `${to.x - (deck.left + deck.width / 2)}px`);
      el.style.setProperty("--dy", `${to.y - (deck.top + deck.height / 2)}px`);
      el.style.animationDelay = `${i * 90}ms`;
    });
  }, [fx?.key]);

  const glow = g ? (
    <style>{`[data-oid="${CSS.escape(g.pileId)}"] .lift { box-shadow: 0 0 0 calc(5px * var(--cs)) ${COLOR_HEX[g.color]}, 0 0 calc(30px * var(--cs)) ${COLOR_HEX[g.color]} !important; transition: box-shadow 0.4s; }`}</style>
  ) : null;
  if (!fx || !g) return glow;

  const meHit = fx.target === me;
  const tName = fx.target ? nick(fx.target) : "";
  const hex = COLOR_HEX[fx.color];
  let big: React.ReactNode = null;
  let text = "";
  if (fx.effect === "wild") {
    big = <span className="ufx-wheel"><i /><i /><i /><i /></span>;
    text = `🌈 ${COLOR_NAME[fx.color]}으로 바꿈!`;
  } else if (fx.effect === "skip") {
    big = <span className="ufx-sym skip">⊘</span>;
    text = meHit ? "내 차례를 건너뛰어요!" : `${tName}님 건너뜀!`;
  } else if (fx.effect === "reverse") {
    big = <span className="ufx-sym rev">⇄</span>;
    text = fx.target ? (meHit ? "내 차례를 건너뛰어요! (2명이라)" : `${tName}님 건너뜀! (2명이라)`) : "방향 반대로!";
  } else {
    big = <span className="ufx-sym atk">+{fx.n}</span>;
    text = `${meHit ? "공격당했어요!" : `${tName}님에게 공격!`} +${fx.n}장${fx.recolor ? ` · ${COLOR_NAME[fx.color]}으로` : ""}`;
  }
  return (
    <>
      {glow}
      {/* 맞은 사람 이름표 흔들기 */}
      {fx.target && (fx.effect === "draw" || fx.effect === "skip") && (
        <style>{`.game-panel [data-pid="${CSS.escape(fx.target)}"] { animation: ufxShake 0.5s ease 2; ${fx.effect === "draw" ? "background: #ffe1e5; border-color: #e53935;" : "opacity: 0.55;"} }`}</style>
      )}
      <div key={fx.key} className={`ufx ufx-${fx.effect} ${anim ? "" : "still"}`} style={{ "--fx": hex } as React.CSSProperties} aria-live="polite">
        {anim && (fx.effect === "wild" || fx.recolor) && <div className="ufx-burst" />}
        {fx.effect === "draw" && fx.target === me && <div className="ufx-hit" />}
        <div className="ufx-center">
          {big}
          <b className="ufx-text">{text}</b>
        </div>
        {anim && fx.effect === "draw" && (
          <div className="ufx-fly" ref={flyRef}>
            {Array.from({ length: fx.n }, (_, i) => (
              <div key={i} className="ufx-card" />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
