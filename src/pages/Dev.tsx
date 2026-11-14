import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorText } from "../api";
import { Stars, priceLabel } from "../components/Stars";
import type { AppCardData } from "../types";

type DevData = {
  suspended: boolean;
  suspendedReason: string | null;
  earned: number;
  pending: number;
  apps: AppCardData[];
};

// 開発者ダッシュボード：自分の拡張機能・利用者数・受け取ったポイント・保留中
export function Dev() {
  const navigate = useNavigate();
  const [data, setData] = useState<DevData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accountUrl, setAccountUrl] = useState<string | null>(null);

  useEffect(() => {
    api<{ accountUrl: string | null }>("/api/auth/options")
      .then((d) => setAccountUrl(d.accountUrl))
      .catch(() => setAccountUrl(null));
  }, []);

  const load = () =>
    api<DevData>("/api/dev/apps")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    void load();
  }, []);

  const remove = async (app: AppCardData) => {
    if (!window.confirm(`「${app.name}」の公開をやめますか？ すでに追加した人は引き続き使えます。`)) return;
    try {
      await api(`/api/dev/apps/${app.id}`, { method: "DELETE" });
      setMessage("公開をやめました。");
      await load();
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  return (
    <div className="dev">
      <div className="toolbar">
        <h1 className="page-title">開発者ダッシュボード</h1>
        <button type="button" className="btn primary" onClick={() => navigate("/dev/new")} disabled={data?.suspended}>
          新しい拡張機能を公開
        </button>
      </div>

      {accountUrl && (
        <p className="small muted">
          アプリの登録（開発者設定）は、<a href={accountUrl} target="_blank" rel="noreferrer">仙人アカウントの画面</a>で行います。
        </p>
      )}
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice">{message}</p>}
      {data?.suspended && (
        <p className="notice error">この作者アカウントは公開を停止されています。{data.suspendedReason ? `（理由: ${data.suspendedReason}）` : ""}</p>
      )}

      {data && (
        <>
          <div className="stat-row">
            <div className="stat"><span className="muted small">公開中・非公開</span><strong>{data.apps.length}</strong></div>
            <div className="stat"><span className="muted small">利用者（合計）</span><strong>{data.apps.reduce((s, a) => s + a.users, 0).toLocaleString("ja-JP")}</strong></div>
            <div className="stat"><span className="muted small">受け取った pt</span><strong>{data.earned.toLocaleString("ja-JP")}</strong></div>
            <div className="stat"><span className="muted small">保留中の pt</span><strong>{data.pending.toLocaleString("ja-JP")}</strong></div>
          </div>
          <p className="small muted">
            売上は購入額の全額が、作者の仙人アカウントに入ります（手数料はありません）。保留中の分は、次にこの画面を開いたときに払い直します。
          </p>

          {data.apps.length === 0 ? (
            <p className="muted pad">まだ拡張機能がありません。「新しい拡張機能を公開」から作れます。</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>状態</th>
                    <th>価格</th>
                    <th>利用者</th>
                    <th>評価</th>
                    <th>受け取った pt</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {data.apps.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/apps/${a.id}`} className="link">{a.name}</Link>
                        {a.hiddenReason && <div className="small muted">{a.hiddenReason}</div>}
                      </td>
                      <td>
                        <span className={`badge ${a.status === "published" ? "ok" : "warn"}`}>
                          {a.status === "published" ? "公開中" : "非公開"}
                        </span>
                      </td>
                      <td>{priceLabel(a.price)}</td>
                      <td>{a.users.toLocaleString("ja-JP")}</td>
                      <td><Stars value={a.ratingAvg} count={a.ratingCount} /></td>
                      <td>{(a.earned ?? 0).toLocaleString("ja-JP")}</td>
                      <td className="table-actions">
                        <Link to={`/dev/apps/${a.id}/edit`} className="btn ghost small">編集</Link>
                        <button type="button" className="btn ghost small danger" onClick={() => remove(a)}>公開をやめる</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
