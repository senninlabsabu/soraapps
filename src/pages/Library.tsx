import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { AppCard } from "../components/AppCard";
import type { AppCardData } from "../types";

// マイアプリ・本棚：追加した作品の一覧。拡張機能は「開く」、マンガ・画像・小説は「読む」
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
      <h1 className="page-title">マイアプリ・本棚</h1>
      {error && <p className="notice error">{error}</p>}
      {apps === null && !error && <p className="muted">読み込み中…</p>}
      {apps && apps.length === 0 && (
        <p className="muted pad">まだ追加した作品はありません。<Link to="/" className="link">ストアで探す</Link></p>
      )}
      {apps && apps.length > 0 && (
        <div className="grid">
          {apps.map((a) => {
            const reading = a.kind !== "extension";
            return (
              <AppCard
                key={a.id}
                app={a}
                action={
                  a.status === "hidden" ? (
                    <span className="muted small">非公開のため使えません</span>
                  ) : (
                    <Link to={reading ? `/read/${a.id}` : `/run/${a.id}`} className="btn primary small block pill">
                      {reading ? "読む" : "開く"}
                    </Link>
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
