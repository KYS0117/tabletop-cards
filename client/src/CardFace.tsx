// 카드 앞면/뒷면 그리기 (이미지 없이 CSS 로 그림 → 어떤 화면 크기에서도 선명)
import type { BackStyle, Face } from "../../shared/protocol";
import { parseFace } from "../../shared/cards";

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

export function CardFace({ face, back }: { face: Face | null; back: BackStyle }) {
  if (!face) {
    return (
      <div className={`card back back-${back}`}>
        <div className="back-inner">{back === "amumal" ? <span>💍</span> : null}</div>
      </div>
    );
  }
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
  if (p.type === "text") {
    return (
      <div className="card face textcard">
        <span>{p.text}</span>
      </div>
    );
  }
  return <div className="card face textcard">?</div>;
}
