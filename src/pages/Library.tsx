import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { AppCard } from "../components/AppCard";
import type { AppCardData } from "../types";

// マイアプリ：追加した拡張機能の一覧。開くと全画面で使える
export function Library() {
  const [apps, setApps] = useState<AppCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ apps: AppCardData[] }>("/api/library")
      .then((d) => setApps(d.apps))
      .catch((e) => setError(errorText(e)));
  }, []);

  return (
    <div className="store">
      <h1 className="page-title">マイアプリ</h1>
      {error && <p className="notice error">{error}</p>}
      {apps === null && !error && <p className="muted">読み込み中…</p>}
      {apps && apps.length === 0 && (
        <p className="muted pad">まだ追加した拡張機能はありません。<Link to="/" className="link">ストアで探す</Link></p>
      )}
      {apps && apps.length > 0 && (
        <div className="grid">
          {apps.map((a) => (
            <AppCard
              key={a.id}
              app={a}
              action={
                a.status === "hidden" ? (
                  <span className="muted small">非公開のため使えません</span>
                ) : (
                  <Link to={`/run/${a.id}`} className="btn primary small block">開く</Link>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
