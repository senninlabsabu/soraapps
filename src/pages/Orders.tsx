import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { ORDER_STATUS_LABEL, type OrderSummary } from "../types";

// 注文・取引の一覧。買った注文と、売った注文を並べる
export function Orders() {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ orders: OrderSummary[] }>("/api/orders")
      .then((d) => setOrders(d.orders))
      .catch((e) => setError(errorText(e)));
  }, []);

  return (
    <div className="store">
      <h1 className="page-title">注文・取引</h1>
      <p className="small muted">手渡しの注文は、ここから出品者とのDMを開けます。</p>
      {error && <p className="notice error">{error}</p>}
      {orders === null && !error && <p className="muted">読み込み中…</p>}
      {orders && orders.length === 0 && <p className="muted pad">まだ注文・取引はありません。</p>}
      {orders && orders.length > 0 && (
        <ul className="order-list">
          {orders.map((o) => (
            <li key={o.id}>
              <Link to={`/orders/${o.id}`} className="order-row">
                <div className="order-thumb">
                  {o.thumbUrl ? <img src={o.thumbUrl} alt="" /> : <span>{o.appName.slice(0, 1)}</span>}
                </div>
                <div className="order-body">
                  <strong className="order-title">{o.appName}</strong>
                  <span className="small muted">
                    {o.role === "buyer" ? `出品者：${o.counterpartName}` : `購入者：${o.counterpartName}`}・{new Date(o.createdAt).toLocaleDateString("ja-JP")}
                  </span>
                </div>
                <div className="order-side">
                  <span className="order-amount">{o.role === "buyer" ? "−" : "+"}{o.amount.toLocaleString("ja-JP")} pt</span>
                  <span className={`status-chip s-${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                  <span className="small muted">{o.role === "buyer" ? "購入" : "販売"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
