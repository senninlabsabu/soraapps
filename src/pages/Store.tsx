import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, errorText } from "../api";
import { AppCard, Shelf } from "../components/AppCard";
import { Featured } from "../components/Featured";
import { CATEGORY_LABEL, type AppCardData, type Category, type FeaturedItem } from "../types";

const SORTS = [
  { value: "new", label: "新着順" },
  { value: "rating", label: "評価順" },
  { value: "users", label: "利用者が多い順" }
];

// ストアのホーム。条件（カテゴリ・検索）がなければ棚で見せ、あれば一覧にする
export function Store() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") as Category | null;
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "new";
  const [apps, setApps] = useState<AppCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);

  const loadFeatured = () =>
    api<{ items: FeaturedItem[] }>("/api/store/featured")
      .then((d) => setFeatured(d.items))
      .catch(() => setFeatured([]));

  useEffect(() => {
    void loadFeatured();
  }, []);

  useEffect(() => {
    setApps(null);
    setError(null);
    const search = new URLSearchParams();
    if (category) search.set("category", category);
    if (q) search.set("q", q);
    search.set("sort", sort);
    api<{ apps: AppCardData[] }>(`/api/store/apps?${search}`)
      .then((d) => setApps(d.apps))
      .catch((e) => setError(errorText(e)));
  }, [category, q, sort]);

  const filtered = !!(category || q);
  const shelves = useMemo(() => {
    if (!apps) return null;
    const newest = apps.slice(0, 8);
    const best = [...apps].sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount).slice(0, 8);
    const popular = [...apps].sort((a, b) => b.users - a.users).slice(0, 8);
    return { newest, best, popular };
  }, [apps]);

  const title = category ? CATEGORY_LABEL[category] : q ? `「${q}」の検索結果` : "";

  return (
    <div className="store">
      {filtered ? (
        <>
          <div className="toolbar">
            <h1 className="page-title">{title}</h1>
            <label className="sort">
              <span className="small muted">並び順</span>
              <select value={sort} onChange={(e) => setParams((p) => { p.set("sort", e.target.value); return p; })}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="notice error">{error}</p>}
          {apps === null && !error && <p className="muted">読み込み中…</p>}
          {apps && apps.length === 0 && <p className="muted pad">該当する拡張機能はありません。</p>}
          {apps && apps.length > 0 && (
            <div className="grid">
              {apps.map((a) => (
                <AppCard key={a.id} app={a} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="hero">
            <h1>拡張機能</h1>
            <p className="muted">作者が作った小さなアプリを、ポイントで買ったり、無料で追加したりできます。</p>
          </div>
          <Featured items={featured} onChanged={loadFeatured} />
          {error && <p className="notice error">{error}</p>}
          {apps === null && !error && <p className="muted">読み込み中…</p>}
          {apps && apps.length === 0 && <p className="muted pad">まだ公開されている拡張機能はありません。</p>}
          {shelves && (
            <>
              <Shelf title="人気の拡張機能" apps={shelves.popular} />
              <Shelf title="評価の高いもの" apps={shelves.best} />
              <Shelf title="新着" apps={shelves.newest} />
            </>
          )}
        </>
      )}
    </div>
  );
}
