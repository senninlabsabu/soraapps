import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, errorText } from "../api";
import { AppCard } from "../components/AppCard";
import type { AppCardData } from "../types";

export function AuthorPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<{ author: { name: string }; apps: AppCardData[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ author: { name: string }; apps: AppCardData[] }>(`/api/store/authors/${id}`)
      .then(setData)
      .catch((e) => setError(errorText(e)));
  }, [id]);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;
  return (
    <div className="store">
      <h1 className="page-title">{data.author.name}</h1>
      <p className="muted small">公開中の拡張機能：{data.apps.length} 件</p>
      <div className="grid">
        {data.apps.map((a) => (
          <AppCard key={a.id} app={a} />
        ))}
      </div>
    </div>
  );
}
