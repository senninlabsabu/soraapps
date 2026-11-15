import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { CATEGORY_LABEL, KIND_LABEL, type Category, type Kind } from "../types";
import { Icon } from "./Icon";

const KINDS: Kind[] = ["extension", "manga", "image", "novel", "goods"];

// 上部の検索・左のナビ（Google Pay のような白基調のカード型）・スマホでは下部のタブ
export function Shell() {
  const { me, loading, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
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

  // 残高は、画面を移るたびに読み直す（支払いの後に、ウォレットの金額が古いままにならないように）
  useEffect(() => {
    if (!me?.linked) {
      setPoints(null);
      return;
    }
    api<{ points: number | null }>("/api/balance")
      .then((d) => setPoints(d.points))
      .catch(() => setPoints(null));
  }, [me, location.pathname]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setSearchOpen(false);
    const q = query.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : "/");
  };

  const category = params.get("category");
  const kind = params.get("kind");

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="soraapps ホーム">
          <span className="brand-mark"><img src="/icons/icon-192.png" alt="" /></span>
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
            placeholder="作品を検索"
            aria-label="作品を検索"
          />
        </form>
        <div className="topbar-right">
          {me?.linked && points !== null && (
            <Link to="/wallet" className="points-chip" title="ウォレットを開く">
              {points.toLocaleString("ja-JP")} pt
            </Link>
          )}
          {loading ? null : me ? (
            <div className="account">
              <span className="avatar" aria-hidden="true">{me.displayName.slice(0, 1)}</span>
              <span className="account-name">{me.displayName}</span>
              <button
                type="button"
                className="btn ghost small pill"
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
              >
                ログアウト
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn primary small pill">
              仙人アカウントでログイン
            </Link>
          )}
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="メニュー">
          <NavLink to="/" end className={({ isActive }) => `nav-item${isActive && !category && !kind ? " active" : ""}`}>
            <Icon name="home" /> <span>ホーム</span>
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            <Icon name="grid" /> <span>マイアプリ・本棚</span>
          </NavLink>
          <NavLink to="/orders" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            <Icon name="orders" /> <span>注文・取引（DM）</span>
          </NavLink>
          <NavLink to="/wallet" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            <Icon name="wallet" /> <span>ウォレット</span>
          </NavLink>

          <div className="nav-heading">作品の種類</div>
          {KINDS.map((k) => (
            <Link key={k} to={`/?kind=${k}`} className={`nav-item sub${kind === k ? " active" : ""}`}>
              <span>{KIND_LABEL[k]}</span>
            </Link>
          ))}

          <div className="nav-heading">拡張機能のカテゴリ</div>
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

      {/* スマホ向けの下部タブ（Google Pay のアプリのように、主な4つを下に置く） */}
      <nav className="bottom-nav" aria-label="主なメニュー">
        <NavLink to="/" end className={({ isActive }) => `bn-item${isActive ? " active" : ""}`}>
          <Icon name="home" /><span>ホーム</span>
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => `bn-item${isActive ? " active" : ""}`}>
          <Icon name="grid" /><span>本棚</span>
        </NavLink>
        <NavLink to="/orders" className={({ isActive }) => `bn-item${isActive ? " active" : ""}`}>
          <Icon name="orders" /><span>取引</span>
        </NavLink>
        <NavLink to="/wallet" className={({ isActive }) => `bn-item${isActive ? " active" : ""}`}>
          <Icon name="wallet" /><span>ウォレット</span>
        </NavLink>
      </nav>
    </div>
  );
}
