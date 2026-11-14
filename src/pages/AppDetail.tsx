import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorText } from "../api";
import { Icon } from "../components/Icon";
import { Stars, priceLabel } from "../components/Stars";
import { useSession } from "../session";
import type { AppCardData, ProductInfo, Review } from "../types";

type Detail = {
  app: AppCardData & { description: string };
  images: string[];
  products: ProductInfo[];
  isCreator: boolean;
  reviews: Review[];
  myReview: Review | null;
  canReview: boolean;
};

// 拡張機能の詳細（ストアの掲載ページ）。概要・レビューのタブ、追加・購入、開く
export function AppDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { me } = useSession();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "reviews">("overview");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/api/store/apps/${id}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const { app } = data;
  const owned = app.owned || data.isCreator;

  const add = async () => {
    if (!me) {
      navigate("/login");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/store/apps/${id}/add`, { method: "POST" });
      await load();
      setMessage(app.price === 0 ? "追加しました。マイアプリから開けます。" : `${app.price.toLocaleString("ja-JP")}pt で購入しました。`);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    if (!me) return navigate("/login");
    if (!window.confirm("この拡張機能を通報しますか？（1人1回。通報が多いと自動で非公開になります）")) return;
    try {
      const d = await api<{ hidden: boolean }>(`/api/store/apps/${id}/report`, { method: "POST" });
      setMessage(d.hidden ? "通報を受け付けました。この拡張機能は非公開になりました。" : "通報を受け付けました。");
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  return (
    <div className="detail">
      <Link to="/" className="back small"><Icon name="back" size={16} /> ストアに戻る</Link>

      <header className="detail-head">
        <div className="detail-thumb">
          {app.thumbUrl ? <img src={app.thumbUrl} alt="" /> : <span>{app.name.slice(0, 1)}</span>}
        </div>
        <div className="detail-info">
          <h1>{app.name}</h1>
          <Link to={`/authors/${app.creatorId}`} className="link small">{app.creatorName}</Link>
          <div className="detail-meta small">
            <span>{app.categoryLabel}</span>
            <Stars value={app.ratingAvg} count={app.ratingCount} />
            <span className="muted">{app.users.toLocaleString("ja-JP")} 人が利用</span>
          </div>
          {app.status !== "published" && (
            <p className="notice warn">
              {app.status === "hidden" ? "この拡張機能は非公開です。" : "この拡張機能は作者が公開をやめています。"}
              {app.hiddenReason ? `（${app.hiddenReason}）` : ""}
            </p>
          )}
          <div className="detail-actions">
            {owned ? (
              <Link to={`/run/${app.id}`} className="btn primary">開く</Link>
            ) : (
              <button type="button" className="btn primary" onClick={add} disabled={busy || app.status !== "published"}>
                {busy ? "処理中…" : app.price === 0 ? "追加" : `${priceLabel(app.price)}で購入`}
              </button>
            )}
            {app.owned && <span className="badge ok">追加済み</span>}
            {me && !data.isCreator && (
              <button type="button" className="btn ghost small" onClick={report}>通報</button>
            )}
          </div>
          {message && <p className="notice">{message}</p>}
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "tab on" : "tab"} onClick={() => setTab("overview")}>概要</button>
        <button role="tab" aria-selected={tab === "reviews"} className={tab === "reviews" ? "tab on" : "tab"} onClick={() => setTab("reviews")}>
          レビュー（{app.ratingCount}）
        </button>
      </div>

      {tab === "overview" ? (
        <>
          {data.images.length > 0 && (
            <Gallery images={data.images} name={app.name} />
          )}
          <section className="prose">
          <p>{app.description || "説明はありません。"}</p>
          <dl className="facts small">
            <dt>カテゴリ</dt><dd>{app.categoryLabel}</dd>
            <dt>価格</dt><dd>{priceLabel(app.price)}</dd>
            <dt>更新</dt><dd>{new Date(app.editedAt ?? app.createdAt).toLocaleDateString("ja-JP")}</dd>
          </dl>
          </section>
          {data.products.length > 0 && (
            <section className="products">
              <h2 className="section-title">アプリ内で買えるもの</h2>
              <p className="small muted">購入は、拡張機能の中から行います。買った商品は、アプリが「持っている」と判断できます。</p>
              <ul className="product-list">
                {data.products.map((p) => (
                  <li key={p.sku} className="product">
                    <div>
                      <strong>{p.title}</strong>
                      {p.description && <div className="small muted">{p.description}</div>}
                    </div>
                    <div className="product-side">
                      <span>{priceLabel(p.price)}</span>
                      {p.owned && <span className="badge ok">購入済み</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <ReviewsPanel detail={data} appId={id} onChanged={load} />
      )}
    </div>
  );
}

function ReviewsPanel({ detail, appId, onChanged }: { detail: Detail; appId: string; onChanged: () => Promise<void> }) {
  const [rating, setRating] = useState(detail.myReview?.rating ?? 5);
  const [comment, setComment] = useState(detail.myReview?.comment ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await api(`/api/store/apps/${appId}/review`, { method: "POST", json: { rating, comment } });
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await api(`/api/store/apps/${appId}/review`, { method: "DELETE" });
      setComment("");
      setRating(5);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="reviews">
      {detail.canReview && (
        <div className="review-form">
          <h2 className="section-title">{detail.myReview ? "あなたのレビュー" : "レビューを書く"}</h2>
          <div className="star-picker" role="radiogroup" aria-label="星の数">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} className={n <= rating ? "star-btn on" : "star-btn"} onClick={() => setRating(n)}>
                <Icon name="star" size={22} />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
            placeholder="感想（1000文字まで。URL・連絡先は書けません）"
            rows={3}
          />
          {error && <p className="notice error">{error}</p>}
          <div className="row">
            <button type="button" className="btn primary small" onClick={save}>{detail.myReview ? "直す" : "投稿"}</button>
            {detail.myReview && <button type="button" className="btn ghost small" onClick={remove}>削除</button>}
          </div>
        </div>
      )}
      {!detail.canReview && !detail.isCreator && <p className="muted small">レビューは、この拡張機能を追加した人が付けられます。</p>}
      {error && !detail.canReview && <p className="notice error">{error}</p>}
      <ul className="review-list">
        {detail.reviews.map((r, i) => (
          <li key={`${r.authorName}-${i}`} className="review">
            <div className="review-head">
              <Stars value={r.rating} count={1} />
              <span className="small">{r.authorName}{r.mine ? "（あなた）" : ""}</span>
              <span className="small muted">{new Date(r.updatedAt).toLocaleDateString("ja-JP")}</span>
            </div>
            {r.comment && <p className="review-text">{r.comment}</p>}
          </li>
        ))}
        {detail.reviews.length === 0 && <li className="muted small">まだレビューはありません。</li>}
      </ul>
    </section>
  );
}

// 商品紹介画像（クリックで大きく見られる）
function Gallery({ images, name }: { images: string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="gallery" aria-label="商品紹介画像">
      {images.map((src, i) => (
        <button key={src} type="button" className="shot" onClick={() => setOpen(i)} aria-label={`${name} の画像 ${i + 1}`}>
          <img src={src} alt="" loading="lazy" />
        </button>
      ))}
      {open !== null && (
        <div className="lightbox" role="dialog" aria-label="画像" onClick={() => setOpen(null)}>
          <img src={images[open]} alt="" />
        </div>
      )}
    </section>
  );
}
