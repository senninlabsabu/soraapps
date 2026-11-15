import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { ImageViewer } from "../viewers/ImageViewer";
import { NovelViewer } from "../viewers/NovelViewer";
import type { AppCardData } from "../types";

// 閲覧の入口：作品の種類に合わせて、マンガ・画像のビュアーか小説のビュアーを開く
export function Read({ id }: { id: string }) {
  const [app, setApp] = useState<(AppCardData & { description: string }) | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ app: AppCardData & { description: string }; isCreator: boolean }>(`/api/store/apps/${id}`)
      .then((d) => {
        setApp(d.app);
        setIsCreator(d.isCreator);
      })
      .catch((e) => setError(errorText(e)));
  }, [id]);

  if (error) return <p className="notice error pad">{error}</p>;
  if (!app) return <p className="muted pad">読み込み中…</p>;

  if (!app.owned && !isCreator) {
    return (
      <div className="viewer-message">
        <p>この作品は、購入（追加）すると読めます。</p>
        <Link to={`/apps/${app.id}`} className="btn primary pill">作品ページを開く</Link>
      </div>
    );
  }

  if (app.kind === "manga" || app.kind === "image") {
    return <ImageViewer id={app.id} title={app.name} kind={app.kind} />;
  }
  if (app.kind === "novel") {
    return <NovelViewer id={app.id} title={app.name} />;
  }
  return (
    <div className="viewer-message">
      <p>この種類は、読むための画面がありません。</p>
      <Link to={`/run/${app.id}`} className="btn primary pill">開く</Link>
    </div>
  );
}
