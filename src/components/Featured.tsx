import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorText } from "../api";
import { useSession } from "../session";
import type { AppCardData, FeaturedItem } from "../types";
import { Stars, priceLabel } from "./Stars";

// おすすめ：画像をクリックすると、紹介文と、その下にアプリのアイコン・名前・購入ボタンが出る
export function Featured({ items, onChanged }: { items: FeaturedItem[]; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { me } = useSession();
  const navigate = useNavigate();
  const current = items.find((i) => i.id === selected) ?? null;

  if (!items.length) return null;

  const add = async (app: AppCardData) => {
    if (!me) {
      navigate("/login");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/store/apps/${app.id}/add`, { method: "POST" });
      setMessage(app.price === 0 ? "追加しました。マイアプリから開けます。" : `${priceLabel(app.price)}で購入しました。`);
      await onChanged();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="featured" aria-label="おすすめ">
      <h2 className="section-title">おすすめ</h2>
      <div className="featured-row">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`featured-tile${selected === item.id ? " on" : ""}`}
            onClick={() => {
              setMessage(null);
              setSelected(selected === item.id ? null : item.id);
            }}
            aria-expanded={selected === item.id}
            aria-label={`${item.app.name} のおすすめ`}
          >
            <img src={item.imageUrl} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {current && (
        <div className="featured-panel" key={current.id}>
          <p className="promo">{current.promoText || "紹介文はありません。"}</p>
          <div className="featured-app">
            <div className="icon-chip" aria-hidden="true">
              {current.app.thumbUrl ? <img src={current.app.thumbUrl} alt="" /> : <span>{current.app.name.slice(0, 1)}</span>}
            </div>
            <div className="featured-app-body">
              <strong>{current.app.name}</strong>
              <span className="small muted">{current.app.creatorName}・{current.app.categoryLabel}</span>
              <Stars value={current.app.ratingAvg} count={current.app.ratingCount} />
            </div>
            <div className="featured-buy">
              {current.app.owned ? (
                <Link to={`/run/${current.app.id}`} className="btn primary">開く</Link>
              ) : (
                <button type="button" className="btn primary" onClick={() => add(current.app)} disabled={busy}>
                  {busy ? "処理中…" : current.app.price === 0 ? "追加" : `${priceLabel(current.app.price)}で購入`}
                </button>
              )}
              <Link to={`/apps/${current.app.id}`} className="small link">詳しく見る</Link>
            </div>
          </div>
          {message && <p className="notice">{message}</p>}
        </div>
      )}
    </section>
  );
}
