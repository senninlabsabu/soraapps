// soraapps の自動チェック（審査なしで公開するための仕組み）と、拡張機能を隔離して動かす文書の生成。
// このファイルは外部に依存しない純粋な関数だけを置く（テストしやすいように）。

export const CATEGORIES = ["productivity", "game", "study", "tool", "fun"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  productivity: "生産性",
  game: "ゲーム",
  study: "学習",
  tool: "ツール",
  fun: "娯楽"
};

export const PRICE_MIN = 10;
export const PRICE_MAX = 1000;
export const THUMB_MAX_BYTES = 2 * 1024 * 1024; // 2MB
export const CODE_TOTAL_MAX = 150_000; // HTML・CSS・JavaScript を合わせて（文字数）
export const STORAGE_KEY_MAX = 64;
export const STORAGE_VALUE_MAX = 16 * 1024; // 保存する値の JSON の大きさ（バイト）
export const STORAGE_KEYS_MAX = 100; // 1つの拡張機能で保存できるキーの数
export const REPORT_HIDE_THRESHOLD = 5; // 通報がこの件数たまると自動で非公開
export const DAILY_APP_LIMIT = 20; // 1人が1日に公開できる数

export const SHOTS_MAX = 5; // 商品紹介画像の枚数
export const PRODUCTS_MAX = 20; // アプリ内で売る商品の数

// 禁止語（最低限の例）。運営が増やしてください。ここに当たる文字列は公開できません。
export const BLOCKED_WORDS = ["死ね", "殺してやる", "自殺しろ"];

// ---------- 画像（中身で形式を判定する。拡張子は信用しない） ----------

export type SniffedImage = { type: "png" | "gif" | "webp" | "jpeg"; mime: string; width: number | null; height: number | null };

export function sniffImage(buf: Buffer): SniffedImage | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: "png", mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  const head6 = buf.subarray(0, 6).toString("ascii");
  if (buf.length >= 10 && (head6 === "GIF87a" || head6 === "GIF89a")) {
    return { type: "gif", mime: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 30 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = buf.subarray(12, 16).toString("ascii");
    const webp = { type: "webp" as const, mime: "image/webp" };
    if (chunk === "VP8X") return { ...webp, width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { ...webp, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 ") return { ...webp, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    return { ...webp, width: null, height: null };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: "jpeg", mime: "image/jpeg", width: null, height: null };
  }
  return null;
}

// サムネイル: PNG・GIF・WebP・JPEG。2MB 以下
export function checkThumbImage(buf: Buffer): string | null {
  if (buf.length > THUMB_MAX_BYTES) return "サムネイルは2MB以下にしてください。";
  if (!sniffImage(buf)) return "サムネイルは PNG・JPEG・GIF・WebP の画像にしてください。";
  return null;
}

// ---------- 文字 ----------

const URL_PATTERN = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|jp|io|app|xyz|top|info|biz)\b)/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(0[0-9０-９]{1,4}[-－ー][0-9０-９]{1,4}[-－ー][0-9０-９]{3,4})|(0[789]0[0-9０-９]{8})/;

// 公開してよい文字列か。問題があれば理由を返す（外部への誘導・連絡先・禁止語を止める）
export function checkText(text: string, label: string): string | null {
  if (EMAIL_PATTERN.test(text)) return `${label}にメールアドレスは書けません。`;
  if (URL_PATTERN.test(text)) return `${label}にURLは書けません。`;
  if (PHONE_PATTERN.test(text)) return `${label}に電話番号は書けません。`;
  const lower = text.toLowerCase();
  if (BLOCKED_WORDS.some((word) => lower.includes(word))) return `${label}に不適切な言葉が含まれています。`;
  return null;
}

// 名前・説明の検査
export function checkBasics(name: unknown, description: unknown): string | null {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 40) return "拡張機能の名前は1〜40文字で入力してください。";
  if (typeof description !== "string" || description.length > 300) return "説明は300文字以内にしてください。";
  return checkText(`${name} ${description}`, "名前と説明");
}

// 価格の確認（0 は無料。有料は 10〜1000 の整数）
export function checkPrice(value: unknown): string | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return "価格は整数で入力してください。";
  if (n === 0) return null;
  if (n < PRICE_MIN || n > PRICE_MAX) return `価格は無料（0pt）か、${PRICE_MIN}〜${PRICE_MAX}ptにしてください。`;
  return null;
}

export function checkCategory(value: unknown): string | null {
  return (CATEGORIES as readonly unknown[]).includes(value) ? null : "カテゴリを選んでください。";
}

// ---------- 拡張機能のコード（HTML・CSS・JavaScript） ----------

export type CodePayload = { html: string; css: string; js: string };

// 親ページの構造・基準 URL・文書ポリシーを変えられるタグは禁止する（隔離の境界を守るため）
const BLOCKED_TAGS = /<\s*(iframe|frame|frameset|object|embed|base|meta|portal|applet)\b/i;

export function checkCode(value: unknown): { ok: true; payload: CodePayload } | { ok: false; error: string } {
  const v = (value ?? {}) as Partial<CodePayload>;
  const html = typeof v.html === "string" ? v.html : "";
  const css = typeof v.css === "string" ? v.css : "";
  const js = typeof v.js === "string" ? v.js : "";
  if (!html.trim() && !js.trim()) return { ok: false, error: "HTML か JavaScript のどちらかは入力してください。" };
  const total = html.length + css.length + js.length;
  if (total > CODE_TOTAL_MAX) {
    return { ok: false, error: `コードは HTML・CSS・JavaScript を合わせて ${CODE_TOTAL_MAX.toLocaleString("ja-JP")} 文字までです（今は ${total.toLocaleString("ja-JP")} 文字）。` };
  }
  if (BLOCKED_TAGS.test(html)) {
    return { ok: false, error: "iframe・frame・object・embed・meta・base など、隔離の境界に関わる HTML 要素は使えません。" };
  }
  return { ok: true, payload: { html, css, js } };
}

// 隔離して表示する文書の CSP。sandbox（allow-scripts のみ。same-origin は付けない）を必ず維持する。
// 外部の HTTPS の読み込み・HTTPS/WSS 通信は許可する。親ページへの権限・フォーム送信・入れ子フレームは許可しない。
export const EXTENSION_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline' https: data: blob:",
  "style-src 'unsafe-inline' https: data: blob:",
  "img-src data: blob: https:",
  "media-src data: blob: https:",
  "font-src data: blob: https:",
  "connect-src https: wss:",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'self'"
].join("; ");

// ブリッジ（window.sorachat）の上限と、確認画面の文言の長さ。開発者向けドキュメントと同じ値を使う
export const BRIDGE = {
  channel: "soraapps-ext",
  version: 1,
  awardMin: 1,
  awardPerCallDefault: 500,
  reasonMax: 40,
  requestIdMin: 8,
  requestIdMax: 64,
  timeoutMs: 20_000,
  chargeMin: 10,
  chargeMax: 1000,
  chargeTitleMax: 40,
  chargeTimeoutMs: 180_000
} as const;

// 配布・支払いの依頼を確かめる
export function checkAwardRequest(body: unknown): { ok: true; amount: number; reason: string; requestId: string } | { ok: false; error: string } {
  const v = (body ?? {}) as Record<string, unknown>;
  const amount = v.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < BRIDGE.awardMin || amount > 2_147_483_647) {
    return { ok: false, error: `配るポイントは ${BRIDGE.awardMin} 以上の整数で指定してください。` };
  }
  const reason = typeof v.reason === "string" ? v.reason.trim() : "";
  if (reason.length > BRIDGE.reasonMax) return { ok: false, error: `理由は ${BRIDGE.reasonMax} 文字までです。` };
  const requestId = typeof v.requestId === "string" ? v.requestId : "";
  if (!new RegExp(`^[A-Za-z0-9_-]{${BRIDGE.requestIdMin},${BRIDGE.requestIdMax}}$`).test(requestId)) {
    return { ok: false, error: `requestId は英数字・-・_ の ${BRIDGE.requestIdMin}〜${BRIDGE.requestIdMax} 文字で指定してください。` };
  }
  return { ok: true, amount, reason, requestId };
}

export function checkChargeRequest(body: unknown): { ok: true; amount: number; title: string; requestId: string } | { ok: false; error: string } {
  const v = (body ?? {}) as Record<string, unknown>;
  const amount = v.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < BRIDGE.chargeMin || amount > BRIDGE.chargeMax) {
    return { ok: false, error: `支払うポイントは ${BRIDGE.chargeMin}〜${BRIDGE.chargeMax} の整数で指定してください。` };
  }
  const title = typeof v.title === "string" ? v.title.trim() : "";
  if (!title || title.length > BRIDGE.chargeTitleMax) return { ok: false, error: `品名は1〜${BRIDGE.chargeTitleMax}文字で指定してください。` };
  const requestId = typeof v.requestId === "string" ? v.requestId : "";
  if (!new RegExp(`^[A-Za-z0-9_-]{${BRIDGE.requestIdMin},${BRIDGE.requestIdMax}}$`).test(requestId)) {
    return { ok: false, error: `requestId は英数字・-・_ の ${BRIDGE.requestIdMin}〜${BRIDGE.requestIdMax} 文字で指定してください。` };
  }
  return { ok: true, amount, title, requestId };
}

export function checkStorageKey(key: unknown): string | null {
  if (typeof key !== "string" || key.length < 1 || key.length > STORAGE_KEY_MAX) {
    return `キーは1〜${STORAGE_KEY_MAX}文字で指定してください。`;
  }
  if (/[\u0000-\u001f]/.test(key)) return "キーに制御文字は使えません。";
  return null;
}

export function checkStorageValue(value: unknown): string | null {
  if (value === undefined) return "値を指定してください。";
  const json = JSON.stringify(value);
  if (json === undefined) return "値を JSON として保存できません。";
  if (Buffer.byteLength(json, "utf8") > STORAGE_VALUE_MAX) {
    return `1つの値は ${STORAGE_VALUE_MAX / 1024}KB までです。`;
  }
  return null;
}


// ---------- 商品紹介画像・アプリ内課金の商品 ----------

export function checkShots(files: Array<{ buffer: Buffer }>): string | null {
  if (files.length > SHOTS_MAX) return `紹介画像は ${SHOTS_MAX} 枚までです。`;
  for (const file of files) {
    const error = checkThumbImage(file.buffer);
    if (error) return `紹介画像: ${error}`;
  }
  return null;
}

const SKU_PATTERN = /^[a-z0-9_-]{2,32}$/;
export const SKU_RULE = "商品ID（sku）は英小文字・数字・-・_ の2〜32文字で指定してください。";

export function checkSku(value: unknown): string | null {
  return typeof value === "string" && SKU_PATTERN.test(value) ? null : SKU_RULE;
}

export type ProductInput = { sku: string; title: string; description: string; price: number };

// 作者が定義する商品の一覧（JSON の文字列か配列）を検査する
export function checkProducts(raw: unknown): { ok: true; items: ProductInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, items: [] };
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return { ok: false, error: "アプリ内課金の商品の形式が正しくありません。" };
    }
  }
  if (!Array.isArray(list)) return { ok: false, error: "アプリ内課金の商品の形式が正しくありません。" };
  if (list.length > PRODUCTS_MAX) return { ok: false, error: `商品は ${PRODUCTS_MAX} 個までです。` };

  const seen = new Set<string>();
  const items: ProductInput[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) return { ok: false, error: "商品の形式が正しくありません。" };
    const v = entry as Record<string, unknown>;
    const sku = typeof v.sku === "string" ? v.sku.trim() : "";
    const skuError = checkSku(sku);
    if (skuError) return { ok: false, error: skuError };
    if (seen.has(sku)) return { ok: false, error: `商品ID「${sku}」が重複しています。` };
    const title = typeof v.title === "string" ? v.title.trim() : "";
    if (!title || title.length > 40) return { ok: false, error: "商品の名前は1〜40文字で入力してください。" };
    const description = typeof v.description === "string" ? v.description.trim() : "";
    if (description.length > 200) return { ok: false, error: "商品の説明は200文字以内にしてください。" };
    const price = typeof v.price === "number" ? v.price : Number(v.price);
    if (!Number.isInteger(price) || price < PRICE_MIN || price > PRICE_MAX) {
      return { ok: false, error: `商品の価格は ${PRICE_MIN}〜${PRICE_MAX} pt の整数にしてください。` };
    }
    const textError = checkText(`${title} ${description}`, "商品の名前と説明");
    if (textError) return { ok: false, error: textError };
    seen.add(sku);
    items.push({ sku, title, description, price });
  }
  return { ok: true, items };
}

// ---------- 枠の中で動くブリッジ（window.sorachat） ----------

// 枠の中のコードより先に読み込む。サーバーへは直接届かず、ソラチャットの画面（soraapps の画面）へ postMessage で頼む
function bridgeScript(): string {
  const config = JSON.stringify({ channel: BRIDGE.channel, timeoutMs: BRIDGE.timeoutMs, chargeTimeoutMs: BRIDGE.chargeTimeoutMs });
  return `(function () {
  var CONFIG = ${config};
  var pending = Object.create(null);
  var seq = 0;
  function newId() { seq += 1; return seq + "-" + Math.random().toString(36).slice(2, 10); }
  function call(type, data, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = newId();
      var timer = setTimeout(function () {
        delete pending[id];
        var e = new Error("soraapps からの応答がありませんでした。");
        e.code = "timeout";
        reject(e);
      }, timeoutMs || CONFIG.timeoutMs);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      window.parent.postMessage({ channel: CONFIG.channel, id: id, type: type, data: data || {} }, "*");
    });
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.channel !== CONFIG.channel || !pending[msg.id]) return;
    var p = pending[msg.id];
    delete pending[msg.id];
    clearTimeout(p.timer);
    if (msg.ok) {
      p.resolve(msg.data);
    } else {
      var e = new Error(msg.error || "失敗しました。");
      e.code = msg.code || "error";
      e.data = msg.data || {};
      p.reject(e);
    }
  });
  window.sorachat = {
    version: ${BRIDGE.version},
    getAccount: function () { return call("account"); },
    requestAccess: function () { return call("consent"); },
    awardPoints: function (amount, reason, requestId) {
      return call("award", { amount: amount, reason: reason || "", requestId: requestId || (Date.now().toString(36) + "-" + newId()) });
    },
    charge: function (amount, title, requestId) {
      return call("charge", { amount: amount, title: title || "", requestId: requestId || (Date.now().toString(36) + "-" + newId()) }, CONFIG.chargeTimeoutMs);
    },
    iap: {
      products: function () { return call("iap-products").then(function (d) { return d.products || []; }); },
      purchase: function (sku) { return call("iap-purchase", { sku: sku }, CONFIG.chargeTimeoutMs); }
    },
    storage: {
      get: function (key) { return call("storage-get", { key: key }).then(function (d) { return d.value === undefined ? null : d.value; }); },
      set: function (key, value) { return call("storage-set", { key: key, value: value }); },
      remove: function (key) { return call("storage-remove", { key: key }); },
      keys: function () { return call("storage-keys").then(function (d) { return d.keys || []; }); }
    }
  };
})();`;
}

// 隔離して表示する HTML 文書を作る。CSP は応答ヘッダーで付けるので、ここでは文書の中身だけを作る
export function buildExtensionDocument(payload: Partial<CodePayload>): string {
  const html = payload.html ?? "";
  // 作者のコードが </style> や </script> で枠を抜けないようにする
  const css = (payload.css ?? "").replace(/<\/style/gi, "<\\/style");
  const js = (payload.js ?? "").replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;min-height:100%;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;color:#111;background:#fff}*{box-sizing:border-box}</style>
<style>${css}</style>
</head>
<body>
${html}
<script>
window.addEventListener("error", function (event) {
  var box = document.createElement("pre");
  box.setAttribute("style", "color:#b00020;white-space:pre-wrap;padding:12px;margin:0");
  box.textContent = String((event && event.message) || "エラーが起きました");
  document.body.appendChild(box);
});
</script>
<script>
${bridgeScript()}
</script>
<script>
${js}
</script>
</body>
</html>`;
}
