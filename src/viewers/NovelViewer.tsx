import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { Icon } from "../components/Icon";

type Chapter = { index: number; title: string; body: string; total: number };
type Theme = "white" | "sepia" | "dark";

// 読む位置・文字の大きさ・背景の色は、この端末に覚えておく（本文はサーバーから、購入した人だけに届く）
const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 保存できない環境では、覚えないだけ */
  }
};

// 小説のビュアー：章ごとに読む。目次、前後の章、文字の大きさ、背景の色
export function NovelViewer({ id, title }: { id: string; title: string }) {
  const [toc, setToc] = useState<{ index: number; title: string }[] | null>(null);
  const [current, setCurrent] = useState<number>(() => Number(read(`sa-read-${id}`)) || 0);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number>(() => Number(read("sa-novel-size")) || 17);
  const [theme, setTheme] = useState<Theme>(() => (read("sa-novel-theme") as Theme) || "white");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    api<{ chapters: { index: number; title: string }[] }>(`/api/content/${id}/chapters`)
      .then((d) => setToc(d.chapters))
      .catch((e) => setError(errorText(e)));
  }, [id]);

  useEffect(() => {
    setChapter(null);
    api<Chapter>(`/api/content/${id}/chapters/${current}`)
      .then((d) => {
        setChapter(d);
        write(`sa-read-${id}`, String(current));
        window.scrollTo({ top: 0 });
      })
      .catch((e) => setError(errorText(e)));
  }, [id, current]);

  useEffect(() => write("sa-novel-size", String(size)), [size]);
  useEffect(() => write("sa-novel-theme", theme), [theme]);

  const total = chapter?.total ?? toc?.length ?? 0;
  const lines = chapter ? chapter.body.split("\n").filter((line) => line.trim() !== "") : [];

  return (
    <div className={`viewer novel-viewer theme-${theme}`} style={{ "--novel-size": `${size}px` } as CSSProperties}>
      <header className="viewer-bar">
        <Link to="/library" className="icon-btn" aria-label="本棚に戻る"><Icon name="back" size={22} /></Link>
        <span className="viewer-title">{title}</span>
        <button type="button" className={`chip-btn${menu ? " on" : ""}`} onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
          目次
        </button>
      </header>

      {menu && toc && (
        <ul className="toc-panel">
          {toc.map((c) => (
            <li key={c.index}>
              <button
                type="button"
                className={c.index === current ? "toc-item on" : "toc-item"}
                onClick={() => {
                  setCurrent(c.index);
                  setMenu(false);
                }}
              >
                {c.index + 1}. {c.title}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="novel-page">
        {error && <p className="notice error">{error}</p>}
        {!chapter && !error && <p className="muted center">読み込み中…</p>}
        {chapter && (
          <article>
            <p className="small muted">{chapter.index + 1} / {chapter.total}章</p>
            <h1 className="chapter-title">{chapter.title}</h1>
            <div className="novel-body">
              {lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <nav className="chapter-nav">
              <button type="button" className="btn ghost pill" disabled={current <= 0} onClick={() => setCurrent(current - 1)}>前の章</button>
              <button type="button" className="btn primary pill" disabled={current >= total - 1} onClick={() => setCurrent(current + 1)}>次の章</button>
            </nav>
          </article>
        )}
      </div>

      <footer className="viewer-foot novel-tools">
        <button type="button" className="chip-btn" onClick={() => setSize((s) => Math.max(13, s - 1))} aria-label="文字を小さく">A−</button>
        <span className="small">{size}px</span>
        <button type="button" className="chip-btn" onClick={() => setSize((s) => Math.min(26, s + 1))} aria-label="文字を大きく">A＋</button>
        {(["white", "sepia", "dark"] as Theme[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`swatch swatch-${t}${theme === t ? " on" : ""}`}
            aria-pressed={theme === t}
            aria-label={t === "white" ? "白" : t === "sepia" ? "セピア" : "夜"}
            onClick={() => setTheme(t)}
          />
        ))}
      </footer>
    </div>
  );
}
