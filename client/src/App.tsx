import { Suspense, useState } from "react";
import type * as React from "react";
import { MAX_PLAYERS } from "../../shared/protocol";
import { modeFor } from "./modes/registry";
import { createRoom, joinRoom } from "./net";
import { PerfOverlay } from "./PerfOverlay";
import { setState, useStore } from "./store";
import { Toasts } from "./ui";

export function App() {
  const st = useStore();
  const Mode = st.session && st.room ? modeFor(st.room.mode).component : null;
  return (
    <>
      {Mode ? (
        <Suspense fallback={<div className="mode-loading">테이블 불러오는 중…</div>}>
          <Mode />
        </Suspense>
      ) : (
        <Lobby />
      )}
      <PerfOverlay />
    </>
  );
}

function Lobby() {
  const st = useStore();
  const params = new URLSearchParams(location.search);
  const [nick, setNick] = useState(() => {
    try {
      return localStorage.getItem("tt-nick") || "";
    } catch {
      return "";
    }
  });
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState((params.get("room") || "").toUpperCase());
  const [err, setErr] = useState("");

  const saveNick = () => {
    const n = nick.trim();
    if (!n) {
      setErr("닉네임을 입력해 주세요");
      return null;
    }
    try {
      localStorage.setItem("tt-nick", n);
    } catch {
      /* 무시 */
    }
    return n;
  };

  const onCreate = async () => {
    const n = saveNick();
    if (!n) return;
    setErr("");
    const e = await createRoom(n, roomName.trim());
    if (e) setErr(e);
  };
  const onJoin = async () => {
    const n = saveNick();
    if (!n) return;
    if (!/^[A-Z0-9]{6}$/.test(code.trim().toUpperCase())) {
      setErr("방 코드 6자리를 입력해 주세요");
      return;
    }
    setErr("");
    const e = await joinRoom(code, n);
    if (e) setErr(e);
  };

  const waiting = st.session && !st.room;

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="lobby-cards" aria-hidden>
          <span className="lc lc1">A♠</span>
          <span className="lc lc2">K♥</span>
          <span className="lc lc3">★</span>
        </div>
        <h1>테이블탑 카드</h1>
        <p className="muted">친구들과 같은 테이블에서 카드를 직접 집고, 뒤집고, 섞으면서 원하는 규칙으로 놀아요.</p>
        {st.kicked && (
          <div className="err" onClick={() => setState({ kicked: null })}>
            {st.kicked}
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {st.status !== "online" && <div className="note">서버에 연결하는 중…</div>}
        {waiting && <div className="note">테이블에 들어가는 중…</div>}

        <label className="lbl">닉네임</label>
        <input value={nick} maxLength={16} placeholder="예: 카드마스터" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNick(e.target.value)} />

        <div className="lobby-split">
          <div className="box">
            <h3>방 만들기</h3>
            <input value={roomName} maxLength={24} placeholder="방 이름 (선택)" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomName(e.target.value)} />
            <button className="btn primary wide" disabled={st.status !== "online" || st.joining} onClick={onCreate}>
              새 테이블 만들기
            </button>
          </div>
          <div className="box">
            <h3>방 참가</h3>
            <input
              className="code-input"
              value={code}
              maxLength={6}
              placeholder="AB7K92"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && onJoin()}
            />
            <button className="btn wide" disabled={st.status !== "online" || st.joining} onClick={onJoin}>
              참가하기
            </button>
          </div>
        </div>
        <p className="muted small">최대 {MAX_PLAYERS}명 · PC, 안드로이드, 아이폰 브라우저에서 함께 할 수 있어요 · 게임방은 서버가 재시작되면 사라져요</p>
      </div>
      <Toasts />
    </div>
  );
}
