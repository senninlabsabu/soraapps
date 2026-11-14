import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errorText } from "../api";
import { CATEGORY_LABEL, type Category } from "../types";

const CODE_MAX = 150_000;
const SHOTS_MAX = 5;
const PRODUCTS_MAX = 20;

const EMPTY = {
  name: "",
  description: "",
  category: "tool" as Category,
  price: "0",
  html: "",
  css: "",
  js: ""
};

type Form = typeof EMPTY;
type Product = { sku: string; title: string; description: string; price: string };

const SKU_RE = /^[a-z0-9_-]{2,32}$/;

// 作る・直すの画面：基本情報・商品紹介画像・アプリ内課金の商品・コード・プレビュー
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
  const [products, setProducts] = useState<Product[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    if (!id) return;
    api<{
      app: { name: string; description: string; category: Category; price: number; thumbUrl: string | null };
      code: { html: string; css: string; js: string };
      images: string[];
      products: { sku: string; title: string; description: string; price: number }[];
    }>(`/api/dev/apps/${id}`)
      .then((d) => {
        setForm({
          name: d.app.name,
          description: d.app.description,
          category: d.app.category,
          price: String(d.app.price),
          html: d.code.html,
          css: d.code.css,
          js: d.code.js
        });
        setCurrentThumb(d.app.thumbUrl);
        setCurrentShots(d.images);
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

  const codeLength = useMemo(() => form.html.length + form.css.length + form.js.length, [form]);

  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const setProduct = (index: number, key: keyof Product, value: string) =>
    setProducts((list) => list.map((p, i) => (i === index ? { ...p, [key]: value } : p)));

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
    const badSku = products.find((p) => !SKU_RE.test(p.sku.trim()));
    if (badSku) return `商品ID「${badSku.sku}」は英小文字・数字・-・_ の2〜32文字で入力してください。`;
    if (new Set(products.map((p) => p.sku.trim())).size !== products.length) return "商品IDが重複しています。";
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
      Object.entries(form).forEach(([k, v]) => body.append(k, String(v)));
      if (thumb) body.append("thumb", thumb);
      shots.forEach((file) => body.append("shots", file));
      body.append(
        "products",
        JSON.stringify(products.map((p) => ({ sku: p.sku.trim(), title: p.title.trim(), description: p.description.trim(), price: Number(p.price) })))
      );
      await api(editing ? `/api/dev/apps/${id}` : "/api/dev/apps", { method: "POST", form: body });
      navigate("/dev");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return error ? <p className="notice error">{error}</p> : <p className="muted">読み込み中…</p>;

  return (
    <form className="dev-editor" onSubmit={submit}>
      <div className="toolbar">
        <h1 className="page-title">{editing ? "拡張機能を編集" : "新しい拡張機能"}</h1>
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => navigate("/dev")}>戻る</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? "保存中…" : editing ? "保存する" : "公開する"}</button>
        </div>
      </div>
      <p className="small muted">
        審査はありません。公開時に自動チェックをします（URL・メールアドレス・電話番号・禁止語は書けません。外部サイトへの通信やiframeは使えません）。
        {editing && " 保存すると、買った人の手元にも反映されます。"}
      </p>
      {error && <p className="notice error">{error}</p>}

      <div className="field-grid">
        <label className="field">
          <span>名前（40文字まで）</span>
          <input value={form.name} onChange={set("name")} maxLength={40} required />
        </label>
        <label className="field">
          <span>カテゴリ</span>
          <select value={form.category} onChange={set("category")}>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>価格（0 は無料。有料は 10〜1000 pt）</span>
          <input type="number" min={0} max={1000} step={1} value={form.price} onChange={set("price")} required />
        </label>
        <label className="field full">
          <span>説明（300文字まで）</span>
          <textarea value={form.description} onChange={set("description")} maxLength={300} rows={3} />
        </label>
        <div className="field full">
          <span>サムネイル（PNG・JPEG・GIF・WebP、2MBまで）</span>
          <div className="row">
            {(thumbPreview ?? currentThumb) && <img className="thumb-preview" src={thumbPreview ?? currentThumb ?? ""} alt="" />}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => setThumb(e.target.files?.[0] ?? null)}
              required={!editing}
            />
          </div>
        </div>
        <div className="field full">
          <span>商品紹介画像（最大5枚。詳細ページに並びます。{editing ? "選び直すと、今の画像が置き換わります。" : ""}）</span>
          <div className="shot-editor">
            {(shotPreviews.length ? shotPreviews : currentShots).map((src, i) => (
              <img key={`${src}-${i}`} src={src} alt={`紹介画像 ${i + 1}`} />
            ))}
          </div>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp"
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
                <button type="button" className="btn ghost small danger" onClick={() => setProducts((list) => list.filter((_, j) => j !== i))}>削除</button>
              </div>
            ))}
            {products.length < PRODUCTS_MAX && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setProducts((list) => [...list, { sku: "", title: "", description: "", price: "100" }])}
              >
                商品を追加
              </button>
            )}
          </div>
        </div>
      </div>

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
        <button type="button" className="btn ghost small" onClick={runPreview}>プレビューを更新</button>
      </div>
      {preview && (
        <div className="preview">
          <p className="small muted">プレビュー：ポイントの支払い・配布やアカウント情報は、プレビューでは使えません。</p>
          <iframe title="プレビュー" className="ext-frame preview-frame" sandbox="allow-scripts" srcDoc={preview} />
        </div>
      )}
    </form>
  );
}
