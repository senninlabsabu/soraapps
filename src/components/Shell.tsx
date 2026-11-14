import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { CATEGORY_LABEL, type Category } from "../types";
import { Icon } from "./Icon";

// 上部の検索バー・左のナビ・本文を組み立てる（Chrome ウェブストアに近い配置）
export function Shell() {
  const { me, loading, logout } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [points, setPoints] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qs = params.toString();

  useEffect(() => {
    setQuery(params.get("q") ?? "");
    setSearchOpen(false);
  }, [qs]); // 検索の条件が変わったら、入力欄を合わせて閉じる

  // 小さな画面で検索を開いたら、すぐ入力できるように
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!me?.linked) {
      setPoints(null);
      return;
    }
    api<{ points: number | null }>("/api/balance")
      .then((d) => setPoints(d.points))
      .catch(() => setPoints(null));
  }, [me]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setSearchOpen(false);
    const q = query.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : "/");
  };

  const category = params.get("category");

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="soraapps ホーム">
          <span className="brand-mark">S</span>
          <span className="brand-name">soraapps</span>
        </Link>
        <button type="button" className="icon-btn search-toggle" onClick={() => setSearchOpen(true)} aria-label="検索を開く">
          <Icon name="search" size={22} />
        </button>
        <form className={`search${searchOpen ? " open" : ""}`} onSubmit={search} role="search">
          <button type="button" className="icon-btn search-close" onClick={() => setSearchOpen(false)} aria-label="検索を閉じる">
            <Icon name="back" size={22} />
          </button>
          <Icon name="search" size={18} className="search-icon" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="拡張機能を検索"
            aria-label="拡張機能を検索"
          />
        </form>
        <div className="topbar-right">
          {me?.linked && points !== null && <span className="points-chip" title="仙人アカウントのポイント">{points.toLocaleString("ja-JP")} pt</span>}
          {loading ? null : me ? (
            <div className="account">
              <span className="avatar" aria-hidden="true">{me.displayName.slice(0, 1)}</span>
              <span className="account-name">{me.displayName}</span>
              <button
                type="button"
                className="btn ghost small"
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
              >
                ログアウト
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn primary small">
              仙人アカウントでログイン
            </Link>
          )}
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="メニュー">
          <NavLink to="/" end className={({ isActive }) => `nav-item${isActive && !category ? " active" : ""}`}>
            <Icon name="home" /> <span>ホーム</span>
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            <Icon name="grid" /> <span>マイアプリ</span>
          </NavLink>
          <div className="nav-heading">カテゴリ</div>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((key) => (
            <Link
              key={key}
              to={`/?category=${key}`}
              className={`nav-item sub${category === key ? " active" : ""}`}
            >
              <span>{CATEGORY_LABEL[key]}</span>
            </Link>
          ))}
          <div className="nav-heading">作る・運営</div>
          <NavLink to="/dev" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            <Icon name="code" /> <span>開発者ダッシュボード</span>
          </NavLink>
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
