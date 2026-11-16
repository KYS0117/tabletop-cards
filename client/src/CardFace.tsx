// 카드 앞면/뒷면 그리기
// - 트럼프·우노 방식 카드는 CSS 로 그림 (어떤 화면 크기에서도 선명)
// - 이미지 카드는 decks/ 폴더의 그림, 글자 카드(직접 쓴 카드)는 글씨로 표시
import { memo } from "react";
import type { BackStyle, Face } from "../../shared/protocol";
import { parseFace, SAFE_ASSET_PATH } from "../../shared/cards";

// 숫자 카드의 무늬 배치 (열 0~2, 행 0~1)
const PIPS: Record<string, [number, number][]> = {
  "2": [[1, 0], [1, 1]],
  "3": [[1, 0], [1, 0.5], [1, 1]],
  "4": [[0, 0], [2, 0], [0, 1], [2, 1]],
  "5": [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
  "6": [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  "7": [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  "8": [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
  "9": [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, 0.5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
  "10": [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]],
};

/** 서버 주소를 따로 쓰는 경우(VITE_SERVER_URL) 카드 그림도 그 서버에서 받음 */
const ASSET_BASE = (import.meta.env.VITE_SERVER_URL || "").replace(/\/$/, "");

const UNO_SYMBOL: Record<string, string> = { S: "⊘", V: "⇄", D2: "+2", W: "✦", D4: "+4" };

function Back({ back }: { back: BackStyle }) {
  if (back.startsWith("IMG:")) {
    const path = back.slice(4);
    if (SAFE_ASSET_PATH.test(path))
      return (
        <div className="card back back-img">
          <img src={`${ASSET_BASE}/decks/${path}`} alt="" draggable={false} />
        </div>
      );
  }
  const style = /^[a-z0-9-]+$/.test(back) ? back : "blue";
  return (
    <div className={`card back back-${style}`}>
      <div className="back-inner">{style === "propose" ? <span>💍</span> : style === "cockroach" ? <span>🪳</span> : style === "uno" ? <span className="uno-back-logo">COLOR</span> : null}</div>
    </div>
  );
}

export const CardFace = memo(function CardFace({ face, back }: { face: Face | null; back: BackStyle }) {
  if (!face) return <Back back={back} />;
  const p = parseFace(face);
  if (p.type === "std") {
    const color = p.red ? "red" : "black";
    let center;
    if (p.rank === "A") center = <div className="ace">{p.symbol}</div>;
    else if (p.rank === "J" || p.rank === "Q" || p.rank === "K")
      center = (
        <div className="court">
          <span className="court-letter">{p.rank}</span>
          <span className="court-suit">{p.symbol}</span>
        </div>
      );
    else
      center = (
        <div className="pips">
          {(PIPS[p.rank] ?? []).map(([cx, cy], i) => (
            <span key={i} className={`pip ${cy > 0.5 ? "flip" : ""}`} style={{ left: `${cx * 50}%`, top: `${cy * 100}%` }}>
              {p.symbol}
            </span>
          ))}
        </div>
      );
    return (
      <div className={`card face ${color}`}>
        <div className="corner tl">
          <b>{p.rank}</b>
          <span>{p.symbol}</span>
        </div>
        {center}
        <div className="corner br">
          <b>{p.rank}</b>
          <span>{p.symbol}</span>
        </div>
      </div>
    );
  }
  if (p.type === "joker") {
    return (
      <div className={`card face joker ${p.red ? "red" : "black"}`}>
        <div className="jk-text">JOKER</div>
        <div className="jk-star">★</div>
        <div className="jk-text br">JOKER</div>
      </div>
    );
  }
  if (p.type === "uno") {
    const label = UNO_SYMBOL[p.value] ?? p.value;
    // 와일드: 손에 있을 땐 검은색, 내서 색을 고르면 그 색으로 칠해진 와일드 (U:B-W 처럼)
    const wild = p.value === "W" || p.value === "D4";
    return (
      <div className={`card face uno uno-${p.color}`}>
        <div className="uno-corner tl">{label}</div>
        <div className="uno-center">
          {wild ? (
            <span className="uno-wheel">
              <i />
              <i />
              <i />
              <i />
              <b>{p.value === "D4" ? "+4" : ""}</b>
            </span>
          ) : (
            <span className={`uno-big ${label.length > 1 ? "small" : ""}`}>{label}</span>
          )}
        </div>
        <div className="uno-corner br">{label}</div>
      </div>
    );
  }
  if (p.type === "image") {
    return (
      <div className="card face imgcard">
        <img src={ASSET_BASE + p.src} alt="" draggable={false} loading="lazy" decoding="async" />
      </div>
    );
  }
  if (p.type === "text") {
    return (
      <div className="card face textcard">
        <span>{p.text}</span>
      </div>
    );
  }
  return <div className="card face textcard">?</div>;
});
