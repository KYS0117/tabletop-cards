// 화면 위아래 도구 모음, 메뉴, 설정, 도움말, 확인창
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { MAX_PLAYERS, type Background } from "../../shared/protocol";
import type { Action } from "./actions";
import { act, leaveRoom } from "./net";
import { setPrefs, usePrefs } from "./prefs";
import { isHostMe, myId, toast, useStore } from "./store";

// ---------------------------------------------------------------------
// 상단 바: 방 이름, 초대 코드/링크, 접속 인원, 설정
// ---------------------------------------------------------------------
export function TopBar({ onSettings, onHelp, onKick }: { onSettings: () => void; onHelp: () => void; onKick: (id: string, name: string) => void }) {
  const st = useStore();
  const room = st.room!;
  const [open, setOpen] = useState(false);
  const online = room.players.filter((p) => p.connected).length;
  const me = myId();
  const host = isHostMe();

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("초대 링크를 복사했어요");
    } catch {
      toast(`초대 링크: ${url}`);
    }
  };

  return (
    <div className="topbar">
      <div className="tb-left">
        <span className="room-name" title={room.name}>
          🃏 {room.name}
        </span>
        <button className="chip code" onClick={copyLink} title="초대 링크 복사">
          <b>{room.code}</b> <span className="hide-sm">🔗 링크 복사</span>
          <span className="show-sm">🔗</span>
        </button>
      </div>
      <div className="tb-right">
        <div className="players-wrap">
          <button className="chip" onClick={() => setOpen(!open)}>
            👥 {online}/{room.players.length}
            <span className="avatars">
              {room.players.map((p) => (
                <i key={p.id} style={{ background: p.color, opacity: p.connected ? 1 : 0.35 }} title={p.nickname} />
              ))}
            </span>
          </button>
          {open && (
            <div className="players-pop" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
              <div className="pop-title">참가자 (최대 {MAX_PLAYERS}명)</div>
              {room.players.map((p) => (
                <div key={p.id} className={`prow ${p.connected ? "" : "off"}`}>
                  <i className="pdot" style={{ background: p.color }} />
                  <span className="pname">
                    {p.isHost && "👑 "}
                    {p.nickname}
                    {p.id === me && " (나)"}
                  </span>
                  <span className="pmeta">
                    🂠 {p.handCount}
                    {!p.connected && " · 연결 끊김"}
                  </span>
                  {host && p.id !== me && (
                    <button className="mini danger" onClick={() => onKick(p.id, p.nickname)}>
                      내보내기
                    </button>
                  )}
                </div>
              ))}
              <button className="btn wide" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
          )}
        </div>
        <span className={`status ${st.status}`} title={st.status === "online" ? "연결됨" : "재연결 중"} />
        <button className="icon-btn" onClick={onHelp} title="도움말">
          ?
        </button>
        <button className="icon-btn" onClick={onSettings} title="설정">
          ⚙
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 하단 바 (손패 위): 손패 접기, 다중 선택, 화면 맞춤, 덱 추가, 설정, 도움말
// ---------------------------------------------------------------------
export function BottomBar(props: {
  handCount: number;
  multiMode: boolean;
  zoomPct: number;
  onToggleHand: () => void;
  onToggleMulti: () => void;
  onFit: () => void;
  onZoom: (factor: number) => void;
  onSettings: () => void;
  onHelp: () => void;
  onNewDeck: (x: number, y: number) => void;
}) {
  const prefs = usePrefs();
  const host = isHostMe();
  return (
    <div className="bottombar" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
      <button className="tool hand-toggle" onClick={props.onToggleHand}>
        🂠 내 손패 {props.handCount}
        <span className="caret">{prefs.handCollapsed ? "▴" : "▾"}</span>
      </button>
      <label className="tool check" title="손패에서 테이블로 낼 때 뒷면으로 내려놓기">
        <input type="checkbox" checked={prefs.playFaceDown} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ playFaceDown: e.target.checked })} />
        뒷면으로 내기
      </label>
      <button className={`tool ${props.multiMode ? "on" : ""}`} onClick={props.onToggleMulti} title="여러 장 선택 모드">
        ☑ <span className="hide-xs">다중 선택</span>
      </button>
      <span className="grow" />
      <button className="tool" onClick={() => props.onZoom(1 / 1.25)} title="축소">
        −
      </button>
      <button className="tool zoom" onClick={props.onFit} title="화면 맞춤">
        {props.zoomPct}%
      </button>
      <button className="tool" onClick={() => props.onZoom(1.25)} title="확대">
        +
      </button>
      {host && (
        <button
          className="tool"
          onClick={(e: React.MouseEvent) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            props.onNewDeck(r.left, r.top);
          }}
          title="덱 추가 (방장)"
        >
          ＋<span className="hide-xs"> 덱</span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 선택한 카드 동작 바 (PC/모바일 공통, 손가락으로 누르기 좋은 크기)
// ---------------------------------------------------------------------
export function ActionBar({ count, actions, onMore, onClear }: { count: number; actions: Action[]; onMore: (x: number, y: number) => void; onClear: () => void }) {
  const primary = actions.filter((a) => a.primary).slice(0, 6);
  return (
    <div className="actionbar" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
      <span className="ab-count">{count}개 선택</span>
      {primary.map((a) => (
        <button key={a.key} className="ab-btn" onClick={a.run} title={a.label}>
          <span className="ab-icon">{a.icon}</span>
          <span className="ab-label">{a.short ?? a.label}</span>
        </button>
      ))}
      <button
        className="ab-btn"
        onClick={(e: React.MouseEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onMore(r.left, r.top);
        }}
      >
        <span className="ab-icon">⋯</span>
        <span className="ab-label">더보기</span>
      </button>
      <button className="ab-btn" onClick={onClear} title="선택 해제">
        <span className="ab-icon">✕</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// 우클릭 / 길게 누르기 메뉴
// ---------------------------------------------------------------------
export function ContextMenu({ x, y, actions, title, onClose }: { x: number; y: number; actions: Action[]; title?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({ left: Math.max(6, Math.min(x, vw - r.width - 6)), top: Math.max(6, Math.min(y, vh - r.height - 6)) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div className="ctxmenu" ref={ref} style={{ left: pos.left, top: pos.top }} onContextMenu={(e: React.MouseEvent) => e.preventDefault()}>
      {title && <div className="ctx-title">{title}</div>}
      {actions.map((a) => (
        <button
          key={a.key}
          className={`ctx-item ${a.danger ? "danger" : ""}`}
          onClick={() => {
            onClose();
            a.run();
          }}
        >
          <span className="ctx-icon">{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 숫자 입력 / 확인창
// ---------------------------------------------------------------------
export function PromptModal({ title, max, def, onOk, onCancel }: { title: string; max: number; def: number; onOk: (n: number) => void; onCancel: () => void }) {
  const [v, setV] = useState(String(Math.max(1, Math.min(max, def))));
  const n = Math.max(1, Math.min(max, Math.floor(Number(v)) || 1));
  return (
    <div className="modal-bg" onPointerDown={onCancel}>
      <div className="modal small" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="stepper">
          <button className="btn" onClick={() => setV(String(Math.max(1, n - 1)))}>
            −
          </button>
          <input type="number" inputMode="numeric" min={1} max={max} value={v} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value)} />
          <button className="btn" onClick={() => setV(String(Math.min(max, n + 1)))}>
            ＋
          </button>
        </div>
        <p className="muted">최대 {max}장</p>
        <div className="row">
          <button className="btn ghost" onClick={onCancel}>
            취소
          </button>
          <button className="btn primary" onClick={() => onOk(n)}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ text, onOk, onCancel }: { text: string; onOk: () => void; onCancel: () => void }) {
  return (
    <div className="modal-bg" onPointerDown={onCancel}>
      <div className="modal small" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
        <h3>확인</h3>
        <p>{text}</p>
        <div className="row">
          <button className="btn ghost" onClick={onCancel}>
            취소
          </button>
          <button className="btn danger" onClick={onOk}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------
const BGS: { id: Background; label: string }[] = [
  { id: "felt", label: "초록 펠트" },
  { id: "navy", label: "어두운 파랑" },
  { id: "black", label: "검정" },
  { id: "wood", label: "나무" },
];

export function SettingsModal({ onClose, askConfirm }: { onClose: () => void; askConfirm: (text: string, onOk: () => void) => void }) {
  const st = useStore();
  const prefs = usePrefs();
  const room = st.room!;
  const host = isHostMe();
  const [name, setName] = useState(room.name);
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
        <h2>설정</h2>

        <section>
          <h4>테이블 {host ? "" : <small>(방장만 변경 가능)</small>}</h4>
          <div className="seg">
            {BGS.map((b) => (
              <button key={b.id} disabled={!host} className={`swatch sw-${b.id} ${room.settings.background === b.id ? "on" : ""}`} onClick={() => act("host:settings", { background: b.id })}>
                {b.label}
              </button>
            ))}
          </div>
          <h4>카드 크기</h4>
          <div className="seg">
            {[
              [0.8, "작게"],
              [1, "보통"],
              [1.25, "크게"],
            ].map(([v, l]) => (
              <button key={String(v)} disabled={!host} className={room.settings.cardScale === v ? "on" : ""} onClick={() => act("host:settings", { cardScale: v as number })}>
                {l}
              </button>
            ))}
          </div>
          {host && (
            <>
              <label className="check-row">
                <input type="checkbox" checked={room.settings.allowEveryoneDelete} onChange={(e: React.ChangeEvent<HTMLInputElement>) => act("host:settings", { allowEveryoneDelete: e.target.checked })} />
                모든 사람에게 카드 삭제·복제 허용
              </label>
              <div className="row">
                <input className="grow" value={name} maxLength={24} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="방 이름" />
                <button className="btn" onClick={() => act("host:settings", { name })}>
                  이름 변경
                </button>
              </div>
            </>
          )}
        </section>

        <section>
          <h4>내 화면 (이 기기에만 적용)</h4>
          <label className="check-row">
            <input type="checkbox" checked={prefs.shadows} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ shadows: e.target.checked })} />
            카드 그림자 효과
          </label>
          <label className="check-row">
            <input type="checkbox" checked={prefs.animations} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ animations: e.target.checked })} />
            카드 움직임 부드럽게 (끄면 즉시 이동)
          </label>
          <label className="check-row">
            <input type="checkbox" checked={prefs.fan} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ fan: e.target.checked })} />
            손패를 부채꼴로 펼치기
          </label>
          <label className="check-row">
            <input type="checkbox" checked={prefs.perfOverlay} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ perfOverlay: e.target.checked })} />
            개발자: 성능 측정 창 표시 (Ctrl+Shift+P)
          </label>
        </section>

        {host && (
          <section>
            <h4>방장 도구</h4>
            <div className="grid2">
              <button className="btn" onClick={() => act("host:newDeck", { deck: "standard54" })}>
                🂠 트럼프 54장 추가
              </button>
              <button className="btn" onClick={() => act("host:newDeck", { deck: "amumal" })}>
                💍 단어 카드 덱 추가
              </button>
              <button className="btn" onClick={() => askConfirm("테이블의 모든 카드(더미 포함)를 한 더미로 모을까요? 손패는 그대로예요.", () => act("host:gather", {}))}>
                🧺 모든 카드 모으기
              </button>
              <button
                className="btn danger"
                onClick={() => askConfirm("테이블을 초기화할까요? 모든 카드와 모든 사람의 손패가 사라지고 새 덱 1개만 남아요.", () => act("host:reset", {}))}
              >
                ♻ 테이블 초기화
              </button>
            </div>
          </section>
        )}

        <section>
          <button
            className="btn ghost wide"
            onClick={() =>
              askConfirm("방에서 나갈까요? 내 손패는 테이블에 뒷면 더미로 내려놓아져요.", () => {
                onClose();
                leaveRoom();
              })
            }
          >
            🚪 방 나가기
          </button>
          <p className="muted small">※ 게임방은 서버 메모리에만 저장돼요. 서버가 재시작되면 방과 카드가 모두 사라집니다.</p>
        </section>
        <button className="btn primary wide" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 도움말
// ---------------------------------------------------------------------
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal help" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
        <h2>조작 방법</h2>
        <div className="help-cols">
          <div>
            <h4>🖱 PC</h4>
            <ul>
              <li><b>왼쪽 드래그</b> 카드 집어서 옮기기</li>
              <li><b>더미 드래그</b> 맨 위 1장 뽑기 · <b>⠿ 손잡이</b>를 끌면 더미 전체 이동</li>
              <li><b>더블클릭</b> 뒤집기 (F 키도 가능)</li>
              <li><b>Q / E</b> 15° 회전 (들고 있는 중에도 가능)</li>
              <li><b>Shift+클릭</b> 여러 장 선택 · <b>Shift+빈 곳 드래그</b> 영역 선택</li>
              <li><b>빈 곳 드래그</b> 화면 이동 · <b>휠</b> 확대/축소</li>
              <li><b>우클릭</b> 메뉴 (섞기, 뽑기, 펼치기, 묶기…)</li>
              <li><b>Delete</b> 삭제 (방장 또는 허용된 경우)</li>
            </ul>
          </div>
          <div>
            <h4>📱 모바일</h4>
            <ul>
              <li><b>한 손가락 드래그</b> 카드 이동 · 빈 곳이면 화면 이동</li>
              <li><b>더블탭</b> 뒤집기</li>
              <li><b>길게 누르기</b> 메뉴</li>
              <li><b>두 손가락</b> 확대/축소 + 화면 이동</li>
              <li><b>카드를 탭</b>하면 아래에 회전·뒤집기 버튼이 나와요</li>
              <li><b>☑ 다중 선택</b>을 켜면 탭으로 여러 장 선택, 빈 곳 드래그로 영역 선택</li>
              <li>가로 화면을 추천해요</li>
            </ul>
          </div>
        </div>
        <h4>✋ 손패</h4>
        <ul>
          <li>테이블 카드를 아래 <b>손패 영역으로 끌어 놓으면</b> 내 손패가 돼요. 내용은 나만 볼 수 있어요.</li>
          <li>손패 카드를 <b>위로 끌어 올리면</b> 테이블에 내려놓아져요. "뒷면으로 내기"를 켜면 뒷면으로 놓여요.</li>
          <li>손패 안에서 좌우로 끌면 순서가 바뀌어요.</li>
          <li>카드를 <b>더미 위에 놓으면</b> 더미에 합쳐져요. 그냥 겹쳐 두려면 더미가 아닌 곳에 놓으세요.</li>
        </ul>
        <button className="btn primary wide" onClick={onClose}>
          시작하기
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 알림
// ---------------------------------------------------------------------
export function Toasts() {
  const st = useStore();
  return (
    <div className="toasts">
      {st.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
