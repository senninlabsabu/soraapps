import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";

// ログイン：仙人アカウントだけ。ログインのときにポイントの許可も求める（購入・配布に必要）
export function Login() {
  const { me, loading } = useSession();
  const [params] = useSearchParams();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [accountUrl, setAccountUrl] = useState<string | null>(null);
  const error = params.get("auth_error");

  useEffect(() => {
    api<{ sennin: boolean; accountUrl: string | null }>("/api/auth/options")
      .then((d) => {
        setAvailable(d.sennin);
        setAccountUrl(d.accountUrl);
      })
      .catch(() => setAvailable(false));
  }, []);

  if (!loading && me) return <Navigate to="/" replace />;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand-mark large"><img src="/icons/icon-192.png" alt="" /></div>
        <h1>soraapps</h1>
        <p className="muted">拡張機能を探して、追加して、使えます。</p>
        {error && <p className="notice error">{error}</p>}
        {available === false && (
          <p className="notice">仙人アカウントの設定がまだ完了していません。管理者に確認してください。</p>
        )}
        <a
          className={`btn primary block${available ? "" : " disabled"}`}
          href={available ? "/api/auth/sennin/login" : undefined}
          aria-disabled={!available}
        >
          仙人アカウントで続行
        </a>
        <p className="small muted note">
          続行すると、仙人アカウントのポイントを使う許可（読み取り・増減）を求められます。ポイントは購入と、拡張機能の中の支払いのときだけ動きます。
        </p>
        {accountUrl && (
          <p className="small muted note">
            仙人アカウントをお持ちでない方は、<a href={accountUrl} target="_blank" rel="noreferrer">仙人アカウントの画面</a>で新規登録できます。
          </p>
        )}
      </div>
    </div>
  );
}
