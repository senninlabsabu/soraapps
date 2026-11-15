import { useCallback, useEffect, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../api";
import { Icon } from "../components/Icon";

type Page = { index: number; url: string };

// 画像・マンガのビュアー。1ページずつ（タップ・スワイプ・矢印キー）と、縦に読む の2通り。
// マンガは「右から左」（既定）。画像は「左から右」。
export function ImageViewer({ id, title, kind }: { id: string; title: string; kind: "image" | "manga" }) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [scroll, setScroll] = useState(false);
  const [rtl, setRtl] = useState(kind === "manga");
  const [fit, setFit] = useState<"contain" | "width">("contain");
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    api<{ pages: Page[] }>(`/api/content/${id}/pages`)
      .then((d) => setPages(d.pages))
      .catch((e) => setError(errorText(e)));
  }, [id]);

  const total = pages?.length ?? 0;
  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(total - 1, 0))),
    [total]
  );
  // 読む向きでの「次」：右から左のときは、左へ送る（タップ・キーボードの向きだけを変える）
  const forward = rtl ? -1 : 1;

  useEffect(() => {
    if (scroll) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(rtl ? -1 : 1);
      if (e.key === "ArrowLeft") go(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, rtl, scroll]);

  // 次のページを先に読んでおく
  useEffect(() => {
    if (!pages) return;
    const next = pages[index + 1];
    if (next) new Image().src = next.url;
  }, [pages, index]);

  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const leftHalf = e.clientX - rect.left < rect.width / 2;
    go(leftHalf ? -forward : forward);
  };

  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 50) return;
    go(dx < 0 ? forward : -forward);
  };

  const bar = (
    <header className="viewer-bar">
      <Link to="/library" className="icon-btn" aria-label="本棚に戻る"><Icon name="back" size={22} /></Link>
      <span className="viewer-title">{title}</span>
      {pages && total > 0 && (
        <div className="viewer-tools">
          <button type="button" className={`chip-btn${scroll ? " on" : ""}`} onClick={() => setScroll((v) => !v)}>
            {scroll ? "1ページずつ" : "縦に読む"}
          </button>
          <button type="button" className={`chip-btn${rtl ? " on" : ""}`} aria-pressed={rtl} onClick={() => setRtl((v) => !v)}>
            {rtl ? "右から左" : "左から右"}
          </button>
          <button type="button" className="chip-btn" onClick={() => setFit((f) => (f === "contain" ? "width" : "contain"))}>
            {fit === "contain" ? "全体を表示" : "幅に合わせる"}
          </button>
        </div>
      )}
    </header>
  );

  if (error) return <div className="viewer image-viewer">{bar}<p className="notice error">{error}</p></div>;
  if (!pages) return <div className="viewer image-viewer">{bar}<p className="muted pad center">読み込み中…</p></div>;
  if (total === 0) return <div className="viewer image-viewer">{bar}<p className="muted pad center">ページがありません。</p></div>;

  const current = pages[index];
  // 画面の左右のボタンは、読む向きに合わせる（右から左なら、左が「次」）
  const leftIsNext = rtl;

  return (
    <div className="viewer image-viewer">
      {bar}
      {scroll ? (
        <div className="viewer-scroll">
          {pages.map((p) => (
            <img key={p.index} src={p.url} alt={`${p.index + 1}ページ`} loading="lazy" className="page-img width" draggable={false} />
          ))}
        </div>
      ) : (
        <>
          <div
            className="viewer-stage"
            onClick={onStageClick}
            onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
            onTouchEnd={onTouchEnd}
          >
            <img key={current.url} src={current.url} alt={`${index + 1}ページ`} className={`page-img ${fit}`} draggable={false} />
          </div>
          <footer className="viewer-foot">
            <button type="button" className="btn ghost pill small" onClick={() => go(leftIsNext ? 1 : -1)} disabled={leftIsNext ? index >= total - 1 : index === 0}>
              {leftIsNext ? "次へ" : "前へ"}
            </button>
            <input
              type="range"
              min={0}
              max={total - 1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              aria-label="ページ"
            />
            <span className="small">{index + 1} / {total}</span>
            <button type="button" className="btn ghost pill small" onClick={() => go(leftIsNext ? -1 : 1)} disabled={leftIsNext ? index === 0 : index >= total - 1}>
              {leftIsNext ? "前へ" : "次へ"}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
