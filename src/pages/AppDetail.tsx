import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorText } from "../api";
import { Icon } from "../components/Icon";
import { PaySheet } from "../components/PaySheet";
import { Stars, priceLabel } from "../components/Stars";
import { useSession } from "../session";
import type { AppCardData, Contents, ProductInfo, Review } from "../types";

type Detail = {
  app: AppCardData & { description: string };
  images: string[];
  products: ProductInfo[];
  isCreator: boolean;
  reviews: Review[];
  myReview: Review | null;
  canReview: boolean;
  contents: Contents;
};

// 注文の番号（同じ確認シートの中で押し直しても、二重に注文しないために使う）
const newRequestId = () => `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// 作品の詳細。種類ごとに、ボタンと概要が変わる
//  拡張機能：追加・購入 → 開く　／　マンガ・画像・小説：追加・購入 → 読む　／　手渡しグッズ：注文（代金は両者の受け取り確認まで預かる）
export function AppDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { me } = useSession();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "reviews">("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"buy" | "order" | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const orderRequest = useRef<string>(newRequestId());

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
  const isGoods = app.kind === "goods";
  const isReading = app.kind === "image" || app.kind === "manga" || app.kind === "novel";
  const soldOut = isGoods && app.stock === 0;
  const listed = app.status === "published";

  // 支払いの確認シートを開く（残高も読み直す）
  const openSheet = (kind: "buy" | "order") => {
    if (!me) {
      navigate("/login");
      return;
    }
    setMessage(null);
    if (kind === "order") orderRequest.current = newRequestId();
    setSheet(kind);
    api<{ points: number | null }>("/api/balance")
      .then((d) => setBalance(d.points))
      .catch(() => setBalance(null));
  };

  // 無料の追加（支払いなし）・有料の購入（確認シートの「支払う」で呼ぶ）
  const addApp = async () => {
    await api(`/api/store/apps/${id}/add`, { method: "POST" });
    setSheet(null);
    await load();
    setMessage(app.price === 0 ? "追加しました。本棚（マイアプリ）から開けます。" : `${app.price.toLocaleString("ja-JP")}pt で購入しました。`);
  };

  // 手渡しグッズの注文：代金を預かり、取引のページ（DM）へ進む
  const placeOrder = async () => {
    const d = await api<{ orderId: string }>(`/api/store/apps/${id}/order`, {
      method: "POST",
      json: { requestId: orderRequest.current }
    });
    setSheet(null);
    navigate(`/orders/${d.orderId}`);
  };

  const report = async () => {
    if (!me) return navigate("/login");
    if (!window.confirm("この作品を通報しますか？（1人1回。通報が多いと自動で非公開になります）")) return;
    try {
      const d = await api<{ hidden: boolean }>(`/api/store/apps/${id}/report`, { method: "POST" });
      setMessage(d.hidden ? "通報を受け付けました。この作品は非公開になりました。" : "通報を受け付けました。");
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
          <span className="kind-chip">{app.kindLabel}</span>
          <h1>{app.name}</h1>
          <Link to={`/authors/${app.creatorId}`} className="link small">{app.creatorName}</Link>
          <div className="detail-meta small">
            {app.kind === "extension" ? <Stars value={app.ratingAvg} count={app.ratingCount} /> : null}
            {isGoods ? <span className="muted">在庫 {app.stock}</span> : <span className="muted">{app.users.toLocaleString("ja-JP")} 人が利用</span>}
          </div>
          {app.status !== "published" && (
            <p className="notice warn">
              {app.status === "hidden" ? "この作品は非公開です。" : "この作品は作者が公開をやめています。"}
              {app.hiddenReason ? `（${app.hiddenReason}）` : ""}
            </p>
          )}
          <div className="detail-actions">
            {data.isCreator ? (
              <>
                {isGoods ? <Link to="/orders" className="btn primary pill">注文・取引を見る</Link> : null}
                <Link to={`/dev/apps/${app.id}/edit`} className="btn ghost pill">編集する</Link>
              </>
            ) : isGoods ? (
              <button type="button" className="btn primary pill big" onClick={() => openSheet("order")} disabled={!listed || soldOut}>
                {soldOut ? "売り切れ" : `${priceLabel(app.price)}で注文する`}
              </button>
            ) : owned ? (
              <Link to={isReading ? `/read/${app.id}` : `/run/${app.id}`} className="btn primary pill big">
                {isReading ? "読む" : "開く"}
              </Link>
            ) : (
              <button
                type="button"
                className="btn primary pill big"
                onClick={() => (app.price === 0 ? addApp().catch((e) => setMessage(errorText(e))) : openSheet("buy"))}
                disabled={!listed}
              >
                {app.price === 0 ? "追加" : `${priceLabel(app.price)}で購入`}
              </button>
            )}
            {app.owned && !isGoods && <span className="badge ok">追加済み</span>}
            {me && !data.isCreator && (
              <button type="button" className="btn ghost small pill" onClick={report}>通報</button>
            )}
          </div>
          {message && <p className="notice">{message}</p>}
        </div>
      </header>

      {!isGoods && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "tab on" : "tab"} onClick={() => setTab("overview")}>概要</button>
          <button role="tab" aria-selected={tab === "reviews"} className={tab === "reviews" ? "tab on" : "tab"} onClick={() => setTab("reviews")}>
            レビュー（{app.ratingCount}）
          </button>
        </div>
      )}

      {tab === "overview" || isGoods ? (
        <>
          {data.images.length > 0 && <Gallery images={data.images} name={app.name} />}
          <section className="prose">
            <p>{app.description || "説明はありません。"}</p>

            {app.kind === "novel" && data.contents.chapters.length > 0 && (
              <div className="toc">
                <h2 className="section-title">目次（{data.contents.chapters.length}章）</h2>
                <ol>
                  {data.contents.chapters.map((c) => (
                    <li key={c.index}>{c.title}</li>
                  ))}
                </ol>
                <p className="small muted">本文は、購入した人が読めます。</p>
              </div>
            )}

            {(app.kind === "manga" || app.kind === "image") && (
              <p className="small muted">全 {data.contents.pageCount} ページ。購入した人が、ページ順に読めます。</p>
            )}

            {isGoods && (
              <div className="handover-card">
                <h2 className="section-title">手渡しで受け渡します</h2>
                <p className="small">
                  注文すると、出品者とのDMで受け渡しの日時と場所を相談できます。
                  <strong>購入者と出品者の両方が「受け取り済み」にしたときだけ、作者へ入金されます。</strong>
                  それまでは代金を預かり、確認前ならキャンセルして返金できます。
                </p>
                {app.handoverNote && (
                  <p className="small"><span className="muted">受け渡しの目安：</span>{app.handoverNote}</p>
                )}
              </div>
            )}

            <dl className="facts small">
              <dt>種類</dt><dd>{app.kindLabel}</dd>
              {app.kind === "extension" && (<><dt>カテゴリ</dt><dd>{app.categoryLabel}</dd></>)}
              <dt>価格</dt><dd>{priceLabel(app.price)}</dd>
              <dt>更新</dt><dd>{new Date(app.editedAt ?? app.createdAt).toLocaleDateString("ja-JP")}</dd>
            </dl>
          </section>

          {app.kind === "extension" && data.products.length > 0 && (
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

      {sheet === "buy" && (
        <PaySheet
          open
          title={app.name}
          amount={app.price}
          balance={balance}
          note="購入すると本棚に入り、いつでも使えます。"
          actionLabel="支払う"
          onConfirm={addApp}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "order" && (
        <PaySheet
          open
          title={`${app.name} を注文`}
          amount={app.price}
          balance={balance}
          note="代金は、両者が受け取り済みにするまで預かります。受け渡しはDMで相談します。"
          actionLabel="注文して支払う"
          onConfirm={placeOrder}
          onClose={() => setSheet(null)}
        />
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
            <button type="button" className="btn primary small pill" onClick={save}>{detail.myReview ? "直す" : "投稿"}</button>
            {detail.myReview && <button type="button" className="btn ghost small pill" onClick={remove}>削除</button>}
          </div>
        </div>
      )}
      {!detail.canReview && !detail.isCreator && <p className="muted small">レビューは、この作品を追加した人が付けられます。</p>}
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
    <section className="gallery" aria-label="紹介画像">
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
