import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { AppCardData } from "../types";
import { Stars, priceLabel } from "./Stars";

// 作品のカード（一覧・棚・マイアプリで共通）。種類ごとに、リンク先と見出しを少し変える
export function AppCard({ app, action }: { app: AppCardData; action?: ReactNode }) {
  const soldOut = app.kind === "goods" && app.stock === 0;
  return (
    <article className="app-card">
      <Link to={`/apps/${app.id}`} className="app-card-link" aria-label={app.name}>
        <div className="app-thumb">
          {app.thumbUrl ? <img src={app.thumbUrl} alt="" loading="lazy" /> : <span>{app.name.slice(0, 1)}</span>}
        </div>
        <div className="app-card-body">
          <h3 className="app-name">{app.name}</h3>
          <div className="app-author muted small">{app.creatorName}</div>
          {app.kind === "extension" ? <Stars value={app.ratingAvg} count={app.ratingCount} /> : null}
          <div className="app-meta small muted">
            <span className="kind-chip">{app.kindLabel}</span>
            {app.kind === "extension" ? <span>{app.categoryLabel}</span> : null}
            {app.kind === "goods" ? <span>在庫 {app.stock}</span> : <span>{app.users.toLocaleString("ja-JP")} 人が利用</span>}
          </div>
          <div className="app-price">
            {app.owned ? (
              <span className="badge ok">追加済み</span>
            ) : soldOut ? (
              <span className="badge warn">売り切れ</span>
            ) : (
              <span className={app.price === 0 ? "badge free" : "badge"}>{priceLabel(app.price)}</span>
            )}
          </div>
        </div>
      </Link>
      {action && <div className="app-card-action">{action}</div>}
    </article>
  );
}

// 横に並ぶ棚（おすすめ・新着など）
export function Shelf({ title, apps }: { title: string; apps: AppCardData[] }) {
  if (!apps.length) return null;
  return (
    <section className="shelf">
      <h2 className="section-title">{title}</h2>
      <div className="shelf-row">
        {apps.map((a) => (
          <div className="shelf-item" key={a.id}>
            <AppCard app={a} />
          </div>
        ))}
      </div>
    </section>
  );
}
