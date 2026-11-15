import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errorText } from "../api";
import { CATEGORY_LABEL, KIND_LABEL, type Category, type Kind } from "../types";

const CODE_MAX = 150_000;
const SHOTS_MAX = 5;
const PRODUCTS_MAX = 20;
const PAGES_MAX = 200;
const CHAPTERS_MAX = 300;
const CHAPTER_BODY_MAX = 20_000;
const CONTENT_TEXT_MAX = 300_000;
const STOCK_MAX = 99;

const EMPTY = {
  kind: "extension" as Kind,
  name: "",
  description: "",
  category: "tool" as Category,
  price: "0",
  stock: "1",
  handoverNote: "",
  html: "",
  css: "",
  js: ""
};

type Form = typeof EMPTY;
type Product = { sku: string; title: string; description: string; price: string };
type Chapter = { title: string; body: string };

const SKU_RE = /^[a-z0-9_-]{2,32}$/;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

// 作る・直すの画面。種類に合わせて、入力欄が変わる
//  拡張機能：コード・アプリ内課金の商品　／　マンガ・画像：ページ画像　／　小説：章の本文　／　手渡しグッズ：在庫・受け渡しの目安
export function DevEditor() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [thumb, setThumb] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);
  const [currentThumb, setCurrentThumb] = useState<string | null>(null);
  const [shots, setShots] = useState<File[]>([]);
  const [shotPreviews, setShotPreviews] = useState<string[]>([]);
  const [currentShots, setCurrentShots] = useState<string[]>([]);
  const [pages, setPages] = useState<File[]>([]);
  const [pagePreviews, setPagePreviews] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([{ title: "第一章", body: "" }]);
  const [products, setProducts] = useState<Product[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    if (!id) return;
    api<{
      app: { name: string; description: string; category: Category; kind: Kind; price: number; stock: number; handoverNote: string; thumbUrl: string | null };
      code: { html: string; css: string; js: string };
      images: string[];
      products: { sku: string; title: string; description: string; price: number }[];
      chapters: Chapter[];
      pageCount: number;
    }>(`/api/dev/apps/${id}`)
      .then((d) => {
        setForm({
          ...EMPTY,
          kind: d.app.kind,
          name: d.app.name,
          description: d.app.description,
          category: d.app.category,
          price: String(d.app.price),
          stock: String(d.app.stock),
          handoverNote: d.app.handoverNote,
          html: d.code.html,
          css: d.code.css,
          js: d.code.js
        });
        setCurrentThumb(d.app.thumbUrl);
        setCurrentShots(d.images);
        setPageCount(d.pageCount);
        setChapters(d.chapters.length ? d.chapters : [{ title: "第一章", body: "" }]);
        setProducts(d.products.map((p) => ({ ...p, price: String(p.price) })));
        setLoaded(true);
      })
      .catch((e) => setError(errorText(e)));
  }, [id]);

  useEffect(() => {
    if (!thumb) return setThumbPreview(null);
    const url = URL.createObjectURL(thumb);
    setThumbPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [thumb]);

  useEffect(() => {
    const urls = shots.map((f) => URL.createObjectURL(f));
    setShotPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [shots]);

  // ページの預かりは、先頭の数枚だけ見本として表示する（大量の画像を描き過ぎないように）
  useEffect(() => {
    const urls = pages.slice(0, 24).map((f) => URL.createObjectURL(f));
    setPagePreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [pages]);

  const kind = form.kind;
  const codeLength = useMemo(() => form.html.length + form.css.length + form.js.length, [form]);
  const chapterTotal = useMemo(() => chapters.reduce((sum, c) => sum + c.title.length + c.body.length, 0), [chapters]);

  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const setProduct = (index: number, key: keyof Product, value: string) =>
    setProducts((list) => list.map((p, i) => (i === index ? { ...p, [key]: value } : p)));

  const setChapter = (index: number, key: keyof Chapter, value: string) =>
    setChapters((list) => list.map((c, i) => (i === index ? { ...c, [key]: value } : c)));

  const moveChapter = (index: number, delta: number) =>
    setChapters((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const runPreview = async () => {
    setError(null);
    try {
      const d = await api<{ doc: string }>("/api/dev/preview", { method: "POST", json: { html: form.html, css: form.css, js: form.js } });
      setPreview(d.doc);
    } catch (e) {
      setError(errorText(e));
    }
  };

  // 送信前に、よくある間違いを画面で知らせる（最終的な検査はサーバーが行う）
  const clientCheck = (): string | null => {
    if (kind === "extension") {
      const badSku = products.find((p) => !SKU_RE.test(p.sku.trim()));
      if (badSku) return `商品ID「${badSku.sku}」は英小文字・数字・-・_ の2〜32文字で入力してください。`;
      if (new Set(products.map((p) => p.sku.trim())).size !== products.length) return "商品IDが重複しています。";
    }
    if (kind === "goods") {
      const n = Number(form.stock);
      if (!Number.isInteger(n) || n < 0 || n > STOCK_MAX) return `在庫は 0〜${STOCK_MAX} の整数で入力してください。`;
      if (Number(form.price) < 10) return "手渡しグッズの価格は 10〜1000pt にしてください。";
    }
    if (kind === "novel") {
      if (chapters.some((c) => !c.title.trim() || !c.body.trim())) return "章のタイトルと本文は、すべて入力してください。";
      if (chapters.some((c) => c.body.length > CHAPTER_BODY_MAX)) return `1章の本文は${CHAPTER_BODY_MAX.toLocaleString("ja-JP")}文字までです。`;
      if (chapterTotal > CONTENT_TEXT_MAX) return `小説の本文は合わせて${CONTENT_TEXT_MAX.toLocaleString("ja-JP")}文字までです。`;
    }
    return null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const problem = clientCheck();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (k === "kind" && editing) return; // 種類は公開したあとには変えられない
        body.append(k, String(v));
      });
      if (thumb) body.append("thumb", thumb);
      shots.forEach((file) => body.append("shots", file));
      if (kind === "image" || kind === "manga") pages.forEach((file) => body.append("pages", file));
      if (kind === "novel") body.append("chapters", JSON.stringify(chapters.map((c) => ({ title: c.title.trim(), body: c.body }))));
      if (kind === "extension") {
        body.append(
          "products",
          JSON.stringify(products.map((p) => ({ sku: p.sku.trim(), title: p.title.trim(), description: p.description.trim(), price: Number(p.price) })))
        );
      }
      await api(editing ? `/api/dev/apps/${id}` : "/api/dev/apps", { method: "POST", form: body });
      navigate("/dev");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return error ? <p className="notice error">{error}</p> : <p className="muted">読み込み中…</p>;

  const priceHelp = kind === "goods" ? "手渡しグッズは 10〜1000 pt" : "0 は無料。有料は 10〜1000 pt";

  return (
    <form className="dev-editor" onSubmit={submit}>
      <div className="toolbar">
        <h1 className="page-title">{editing ? "作品を編集" : "新しい作品"}</h1>
        <div className="row">
          <button type="button" className="btn ghost pill" onClick={() => navigate("/dev")}>戻る</button>
          <button type="submit" className="btn primary pill" disabled={saving}>{saving ? "保存中…" : editing ? "保存する" : "公開する"}</button>
        </div>
      </div>
      <p className="small muted">
        審査はありません。公開時に自動チェックをします（URL・メールアドレス・電話番号・禁止語は書けません）。
        {editing && " 保存すると、買った人の手元にも反映されます。"}
      </p>
      {error && <p className="notice error">{error}</p>}

      <section className="editor-card">
        <h2 className="section-title">種類</h2>
        <div className="kind-picker" role="radiogroup" aria-label="作品の種類">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              disabled={editing}
              className={`kind-option${kind === k ? " on" : ""}`}
              onClick={() => setForm((f) => ({ ...f, kind: k }))}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {editing && <p className="small muted">種類は公開したあとには変えられません。</p>}
      </section>

      <section className="editor-card">
        <h2 className="section-title">基本情報</h2>
        <div className="field-grid">
          <label className="field">
            <span>名前（40文字まで）</span>
            <input value={form.name} onChange={set("name")} maxLength={40} required />
          </label>
          {kind === "extension" && (
            <label className="field">
              <span>カテゴリ</span>
              <select value={form.category} onChange={set("category")}>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>価格（{priceHelp}）</span>
            <input type="number" min={0} max={1000} step={1} value={form.price} onChange={set("price")} required />
          </label>
          {kind === "goods" && (
            <label className="field">
              <span>在庫（0〜99。0 は売り切れ）</span>
              <input type="number" min={0} max={STOCK_MAX} step={1} value={form.stock} onChange={set("stock")} required />
            </label>
          )}
          <label className="field full">
            <span>説明（300文字まで）</span>
            <textarea value={form.description} onChange={set("description")} maxLength={300} rows={3} />
          </label>
          {kind === "goods" && (
            <label className="field full">
              <span>受け渡しの目安（任意・200文字まで。場所や時間の目安。連絡先は書けません）</span>
              <textarea value={form.handoverNote} onChange={set("handoverNote")} maxLength={200} rows={2} placeholder="例：都内の駅で、平日夜に手渡しできます。" />
            </label>
          )}
          <div className="field full">
            <span>サムネイル（PNG・JPEG・GIF・WebP、2MBまで）</span>
            <div className="row">
              {(thumbPreview ?? currentThumb) && <img className="thumb-preview" src={thumbPreview ?? currentThumb ?? ""} alt="" />}
              <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => setThumb(e.target.files?.[0] ?? null)} required={!editing} />
            </div>
          </div>
          <div className="field full">
            <span>紹介画像（最大5枚。詳細ページに並びます。{editing ? "選び直すと、今の画像が置き換わります。" : ""}）</span>
            <div className="shot-editor">
              {(shotPreviews.length ? shotPreviews : currentShots).map((src, i) => (
                <img key={`${src}-${i}`} src={src} alt={`紹介画像 ${i + 1}`} />
              ))}
            </div>
            <input
              type="file"
              multiple
              accept={IMAGE_ACCEPT}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length > SHOTS_MAX) {
                  setError(`紹介画像は ${SHOTS_MAX} 枚までです。`);
                  setShots(picked.slice(0, SHOTS_MAX));
                } else {
                  setShots(picked);
                }
              }}
              required={!editing}
            />
          </div>
        </div>
      </section>

      {(kind === "image" || kind === "manga") && (
        <section className="editor-card">
          <h2 className="section-title">{kind === "manga" ? "マンガのページ" : "画像"}</h2>
          <p className="small muted">
            ページの順に、ファイルを選んでください（最大{PAGES_MAX}枚・1枚10MBまで）。
            {editing && ` 今は ${pageCount} ページあります。選び直すと、今のページが置き換わります。`}
          </p>
          <input type="file" multiple accept={IMAGE_ACCEPT} onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > PAGES_MAX) setError(`ページは ${PAGES_MAX} 枚までです。`);
            setPages(picked.slice(0, PAGES_MAX));
          }} required={!editing} />
          {pages.length > 0 && (
            <p className="small">{pages.length} 枚を選びました（先頭の見本）：</p>
          )}
          <div className="shot-editor">
            {pagePreviews.map((src, i) => (
              <img key={src} src={src} alt={`${i + 1}ページ`} />
            ))}
          </div>
        </section>
      )}

      {kind === "novel" && (
        <section className="editor-card">
          <h2 className="section-title">章</h2>
          <p className="small muted">
            章ごとに、タイトルと本文を入れてください。本文は1章{CHAPTER_BODY_MAX.toLocaleString("ja-JP")}文字まで、全体は{CONTENT_TEXT_MAX.toLocaleString("ja-JP")}文字までです（今は {chapterTotal.toLocaleString("ja-JP")} 文字）。
          </p>
          <ol className="chapter-editor">
            {chapters.map((c, i) => (
              <li key={i} className="chapter-row">
                <div className="row between">
                  <strong className="small">{i + 1}章</strong>
                  <div className="row">
                    <button type="button" className="btn ghost small pill" onClick={() => moveChapter(i, -1)} disabled={i === 0}>上へ</button>
                    <button type="button" className="btn ghost small pill" onClick={() => moveChapter(i, 1)} disabled={i === chapters.length - 1}>下へ</button>
                    <button type="button" className="btn ghost small pill danger" onClick={() => setChapters((list) => list.filter((_, j) => j !== i))} disabled={chapters.length === 1}>削除</button>
                  </div>
                </div>
                <input value={c.title} onChange={(e) => setChapter(i, "title", e.target.value)} maxLength={40} placeholder="章のタイトル（40字まで）" aria-label={`${i + 1}章のタイトル`} />
                <textarea value={c.body} onChange={(e) => setChapter(i, "body", e.target.value)} maxLength={CHAPTER_BODY_MAX} rows={8} placeholder="本文" aria-label={`${i + 1}章の本文`} />
              </li>
            ))}
          </ol>
          {chapters.length < CHAPTERS_MAX && (
            <button type="button" className="btn ghost pill" onClick={() => setChapters((list) => [...list, { title: `第${list.length + 1}章`, body: "" }])}>
              章を追加
            </button>
          )}
        </section>
      )}

      {kind === "extension" && (
        <>
          <section className="editor-card">
            <div className="field-grid">
              <div className="field full">
                <span>アプリ内課金の商品（任意・最大20個。買い切り。アプリから購入されます）</span>
                <div className="product-editor">
                  {products.map((p, i) => (
                    <div className="product-row" key={i}>
                      <input placeholder="商品ID（例: unlock-pro）" value={p.sku} onChange={(e) => setProduct(i, "sku", e.target.value)} maxLength={32} aria-label="商品ID" />
                      <input placeholder="名前（40字まで）" value={p.title} onChange={(e) => setProduct(i, "title", e.target.value)} maxLength={40} aria-label="商品名" />
                      <textarea placeholder="説明（200字まで）" value={p.description} onChange={(e) => setProduct(i, "description", e.target.value)} maxLength={200} rows={2} aria-label="商品の説明" />
                      <input type="number" min={10} max={1000} placeholder="pt" value={p.price} onChange={(e) => setProduct(i, "price", e.target.value)} aria-label="価格（pt）" />
                      <button type="button" className="btn ghost small danger pill" onClick={() => setProducts((list) => list.filter((_, j) => j !== i))}>削除</button>
                    </div>
                  ))}
                  {products.length < PRODUCTS_MAX && (
                    <button type="button" className="btn ghost small pill" onClick={() => setProducts((list) => [...list, { sku: "", title: "", description: "", price: "100" }])}>
                      商品を追加
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div className="code-grid">
            <label className="field">
              <span>HTML</span>
              <textarea className="code" value={form.html} onChange={set("html")} rows={12} spellCheck={false} />
            </label>
            <label className="field">
              <span>CSS</span>
              <textarea className="code" value={form.css} onChange={set("css")} rows={12} spellCheck={false} />
            </label>
            <label className="field">
              <span>JavaScript（アプリ内課金は window.sorachat.iap を使います）</span>
              <textarea className="code" value={form.js} onChange={set("js")} rows={12} spellCheck={false} />
            </label>
          </div>
          <div className="row between">
            <span className="small muted">合計 {codeLength.toLocaleString("ja-JP")} / {CODE_MAX.toLocaleString("ja-JP")} 文字</span>
            <button type="button" className="btn ghost small pill" onClick={runPreview}>プレビューを更新</button>
          </div>
          {preview && (
            <div className="preview">
              <p className="small muted">プレビュー：ポイントの支払い・配布やアカウント情報は、プレビューでは使えません。</p>
              <iframe title="プレビュー" className="ext-frame preview-frame" sandbox="allow-scripts" srcDoc={preview} />
            </div>
          )}
        </>
      )}
    </form>
  );
}
