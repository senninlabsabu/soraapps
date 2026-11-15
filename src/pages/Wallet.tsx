import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { Icon } from "../components/Icon";
import type { Wallet as WalletData } from "../types";

// ウォレット：残高を大きく見せ、預かり中・入金待ちと、明細を並べる（Google Pay のような見た目）
export function Wallet() {
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<WalletData>("/api/wallet")
      .then(setData)
      .catch((e) => setError(errorText(e)));
  }, []);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  return (
    <div className="wallet">
      <section className="wallet-card">
        <div className="wallet-card-top">
          <span className="wallet-brand">soraapps ウォレット</span>
          <span className="wallet-logo" aria-hidden="true">pt</span>
        </div>
        <div className="wallet-balance">
          {data.linked && data.points !== null ? (
            <strong>{data.points.toLocaleString("ja-JP")}<span> pt</span></strong>
          ) : (
            <strong className="muted">—</strong>
          )}
          <span className="small">{data.linked ? "仙人ポイント残高" : "仙人アカウントと連携すると残高が見られます"}</span>
        </div>
        <div className="wallet-actions">
          <Link to="/" className="wallet-action"><Icon name="store" size={20} /><span>ストア</span></Link>
          <Link to="/library" className="wallet-action"><Icon name="grid" size={20} /><span>本棚</span></Link>
          <Link to="/orders" className="wallet-action"><Icon name="orders" size={20} /><span>取引</span></Link>
        </div>
      </section>

      <div className="wallet-tiles">
        <div className="wallet-tile">
          <span className="small muted">預かり中（手渡し）</span>
          <strong>{data.holdAsBuyer.toLocaleString("ja-JP")} pt</strong>
          <span className="small muted">受け取り確認が済むまで</span>
        </div>
        <div className="wallet-tile">
          <span className="small muted">入金待ち（作者）</span>
          <strong>{data.receivableAsSeller.toLocaleString("ja-JP")} pt</strong>
          <span className="small muted">両者が受け取り済みで入金されます</span>
        </div>
      </div>

      <section className="activity">
        <h2 className="section-title">最近の明細</h2>
        {data.activity.length === 0 && <p className="muted small">まだ明細はありません。</p>}
        <ul className="activity-list">
          {data.activity.map((a) => (
            <li key={a.id} className="activity-row">
              <span className={`activity-icon t-${a.type}`} aria-hidden="true">
                <Icon name={a.type === "payment" ? "minus" : "plus"} size={16} />
              </span>
              <div className="activity-body">
                <strong>{a.title}</strong>
                <span className="small muted">{new Date(a.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <span className={`activity-amount${a.amount > 0 ? " plus" : ""}`}>
                {a.amount > 0 ? "+" : ""}{a.amount.toLocaleString("ja-JP")} pt
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
