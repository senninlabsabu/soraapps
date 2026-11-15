// 純粋な検査（rules.ts）のテスト。DB・仙人アカウントには触れない。
// 実行: npm run test:rules
import assert from "node:assert/strict";
import {
  buildExtensionDocument,
  checkAwardRequest,
  checkBasics,
  checkChargeRequest,
  checkCode,
  checkPrice,
  checkProducts,
  checkChapters,
  checkGoodsPrice,
  checkHandoverNote,
  checkKind,
  checkOrderMessage,
  checkOrderRequest,
  checkPages,
  checkShots,
  checkSku,
  checkStock,
  checkStorageKey,
  checkStorageValue,
  checkText,
  checkThumbImage,
  EXTENSION_CSP,
  sniffImage,
  THUMB_MAX_BYTES
} from "../server/rules.ts";

let passed = 0;
const cases: [string, () => void][] = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);

// 最小の PNG（1x1）と GIF・WebP の先頭バイト
const png = (w: number, h: number) => {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
};
const gif = () => Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from([4, 0, 4, 0]), Buffer.alloc(20)]);

test("中身で画像の形式を判定する（拡張子の代わりに先頭のバイト列を見る）", () => {
  assert.equal(sniffImage(png(64, 32))?.type, "png");
  assert.equal(sniffImage(png(64, 32))?.width, 64);
  assert.equal(sniffImage(gif())?.type, "gif");
  assert.equal(sniffImage(Buffer.from("not an image at all, just text........"))?.type, undefined);
  assert.equal(sniffImage(Buffer.from("plain text"))?.type, undefined);
});

test("サムネイルは画像だけ、2MB 以下", () => {
  assert.equal(checkThumbImage(png(10, 10)), null);
  assert.match(checkThumbImage(Buffer.from("hello, this is definitely not a picture file")) ?? "", /画像/);
  const big = Buffer.concat([png(1, 1), Buffer.alloc(THUMB_MAX_BYTES)]);
  assert.match(checkThumbImage(big) ?? "", /2MB/);
});

test("URL・メールアドレス・電話番号・禁止語を止める", () => {
  assert.match(checkText("詳しくは https://example.com", "説明") ?? "", /URL/);
  assert.match(checkText("連絡は foo@bar.com まで", "説明") ?? "", /メール/);
  assert.match(checkText("電話 090-1234-5678", "説明") ?? "", /電話/);
  assert.match(checkText("死ね", "説明") ?? "", /不適切/);
  assert.equal(checkText("便利なタイマーです", "説明"), null);
});

test("名前は1〜40文字、説明は300文字まで", () => {
  assert.equal(checkBasics("タイマー", "説明です"), null);
  assert.ok(checkBasics("", "x"));
  assert.ok(checkBasics("a".repeat(41), ""));
  assert.ok(checkBasics("ok", "a".repeat(301)));
});

test("価格は0（無料）か 10〜1000 の整数", () => {
  assert.equal(checkPrice(0), null);
  assert.equal(checkPrice("0"), null);
  assert.equal(checkPrice(10), null);
  assert.equal(checkPrice(1000), null);
  assert.ok(checkPrice(9));
  assert.ok(checkPrice(1001));
  assert.ok(checkPrice(10.5));
  assert.ok(checkPrice("abc"));
});

test("コードは HTML か JS が必要。隔離の境界に関わるタグは使えない", () => {
  assert.equal(checkCode({ html: "", css: "", js: "" }).ok, false);
  assert.equal(checkCode({ html: "<p>hi</p>", css: "", js: "" }).ok, true);
  assert.equal(checkCode({ html: '<iframe src="x"></iframe>', css: "", js: "" }).ok, false);
  assert.equal(checkCode({ html: "<base href='/'>", css: "", js: "" }).ok, false);
  assert.equal(checkCode({ html: "<p>x</p>", css: "", js: "a".repeat(150_001) }).ok, false);
});

test("隔離の CSP：sandbox は allow-scripts のみ（same-origin は付けない）", () => {
  assert.match(EXTENSION_CSP, /^sandbox allow-scripts;/);
  assert.equal(EXTENSION_CSP.includes("allow-same-origin"), false);
  assert.match(EXTENSION_CSP, /default-src 'none'/);
  assert.match(EXTENSION_CSP, /form-action 'none'/);
  assert.match(EXTENSION_CSP, /frame-src 'none'/);
});

test("文書の中で </script> や </style> を書いても枠を抜けられない", () => {
  const doc = buildExtensionDocument({ html: "<p>x</p>", css: "p{}</style><b>", js: 'console.log("</script><img src=x>")' });
  const scriptClose = (doc.match(/<\/script>/gi) ?? []).length;
  // 文書の </script> は 3 つ（エラー表示・ブリッジ・作者のコード）だけ。作者が書いた </script> は無害化される
  assert.equal(scriptClose, 3, "作者のコードで script を閉じられてはいけない");
  assert.equal(doc.includes("</style><b>"), false);
  assert.match(doc, /window\.sorachat/);
});

test("文書のブリッジには、API の上限や親画面への窓口だけがある（サーバーへ直接の通信はない）", () => {
  const doc = buildExtensionDocument({ html: "", js: "" });
  assert.match(doc, /window\.parent\.postMessage/);
  assert.equal(/fetch\(/.test(doc.split("window.sorachat")[0] ?? ""), false);
});

test("ポイント配布の依頼：整数・1以上・理由40文字まで・requestId の形", () => {
  const ok = { amount: 50, reason: "達成", requestId: "abc-12345" };
  assert.equal(checkAwardRequest(ok).ok, true);
  assert.equal(checkAwardRequest({ ...ok, amount: 0 }).ok, false);
  assert.equal(checkAwardRequest({ ...ok, amount: 1.5 }).ok, false);
  assert.equal(checkAwardRequest({ ...ok, reason: "x".repeat(41) }).ok, false);
  assert.equal(checkAwardRequest({ ...ok, requestId: "short" }).ok, false);
  assert.equal(checkAwardRequest({ ...ok, requestId: "bad id!!!" }).ok, false);
});

test("支払いの依頼：10〜1000pt・品名必須", () => {
  const ok = { amount: 100, title: "ガチャ1回", requestId: "pay-000001" };
  assert.equal(checkChargeRequest(ok).ok, true);
  assert.equal(checkChargeRequest({ ...ok, amount: 9 }).ok, false);
  assert.equal(checkChargeRequest({ ...ok, amount: 1001 }).ok, false);
  assert.equal(checkChargeRequest({ ...ok, title: "" }).ok, false);
});

test("データ保存：キーは1〜64文字、値は16KBまで", () => {
  assert.equal(checkStorageKey("score"), null);
  assert.ok(checkStorageKey(""));
  assert.ok(checkStorageKey("a".repeat(65)));
  assert.ok(checkStorageKey("a\u0001b"));
  assert.equal(checkStorageValue({ n: 1 }), null);
  assert.ok(checkStorageValue("x".repeat(17 * 1024)));
  assert.ok(checkStorageValue(undefined));
});

test("商品（アプリ内課金）：sku は英小文字・数字・-・_、重複・価格・URL を止める", () => {
  const good = [{ sku: "unlock-pro", title: "プロ版", description: "広告なし", price: 100 }];
  const ok = checkProducts(JSON.stringify(good));
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.items[0].sku, "unlock-pro");
  assert.equal(checkProducts(undefined).ok, true);
  assert.equal(checkProducts("[]").ok, true);
  assert.equal(checkProducts("not json").ok, false);
  assert.equal(checkProducts(JSON.stringify([{ sku: "Bad SKU", title: "x", price: 10 }])).ok, false);
  assert.equal(checkProducts(JSON.stringify([{ sku: "a1", title: "x", price: 5 }])).ok, false);
  assert.equal(checkProducts(JSON.stringify([{ sku: "a1", title: "x", price: 10 }, { sku: "a1", title: "y", price: 20 }])).ok, false);
  assert.equal(checkProducts(JSON.stringify([{ sku: "a1", title: "https://x.example", price: 10 }])).ok, false);
  assert.equal(checkProducts(JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ sku: "p" + i, title: "t", price: 10 })))).ok, false);
  assert.equal(checkSku("coins_100"), null);
  assert.ok(checkSku("A"));
});

test("商品紹介画像は5枚まで・画像だけ", () => {
  assert.equal(checkShots([{ buffer: png(10, 10) }, { buffer: png(20, 20) }]), null);
  assert.match(checkShots(Array.from({ length: 6 }, () => ({ buffer: png(1, 1) }))) ?? "", /5 枚/);
  assert.match(checkShots([{ buffer: Buffer.from("text file that is not an image......") }]) ?? "", /紹介画像/);
});

test("種類は5つだけ（拡張機能・画像・マンガ・小説・手渡しグッズ）", () => {
  for (const k of ["extension", "image", "manga", "novel", "goods"]) assert.equal(checkKind(k), null);
  assert.ok(checkKind("video"));
  assert.ok(checkKind(undefined));
});

test("在庫は 0〜99 の整数。手渡しグッズの価格は 10〜1000pt（0 は不可）", () => {
  assert.equal(checkStock("0"), null);
  assert.equal(checkStock(99), null);
  assert.ok(checkStock(100));
  assert.ok(checkStock(-1));
  assert.ok(checkStock(""));
  assert.equal(checkGoodsPrice("500"), null);
  assert.ok(checkGoodsPrice("0"));
  assert.ok(checkGoodsPrice("5"));
  assert.ok(checkGoodsPrice("1001"));
});

test("受け渡しの目安は連絡先（URL・電話番号）を書けない", () => {
  assert.equal(checkHandoverNote("渋谷駅の改札前、土曜の15時頃"), null);
  assert.ok(checkHandoverNote("詳しくはexample.comで"));
  assert.ok(checkHandoverNote("090-1234-5678 まで"));
  assert.ok(checkHandoverNote("x".repeat(201)));
});

test("小説の章：タイトル必須・本文必須・JSON の形式・URL を止める", () => {
  const ok = checkChapters(JSON.stringify([{ title: "第一章", body: "昔々、ある所に。" }]));
  assert.equal(ok.ok, true);
  assert.equal(checkChapters("[]").ok, false);
  assert.equal(checkChapters("not json").ok, false);
  assert.equal(checkChapters([{ title: "", body: "本文" }]).ok, false);
  assert.equal(checkChapters([{ title: "題", body: "" }]).ok, false);
  const link = checkChapters([{ title: "題", body: "詳しくは https://example.com を見て" }]);
  assert.equal(link.ok, false);
});

test("ページ画像：画像だけ・1枚以上・200枚まで", () => {
  assert.equal(checkPages([{ buffer: png(10, 10) }]), null);
  assert.ok(checkPages([]));
  assert.match(checkPages([{ buffer: Buffer.from("not an image at all") }]) ?? "", /PNG/);
  assert.match(checkPages(Array.from({ length: 201 }, () => ({ buffer: png(1, 1) }))) ?? "", /200/);
});

test("注文の番号・DM の本文（空・長さ・連絡先を止める）", () => {
  assert.equal(checkOrderRequest({ requestId: "order-20260101-abc" }).ok, true);
  assert.equal(checkOrderRequest({ requestId: "short" }).ok, false);
  assert.equal(checkOrderMessage("明日の15時、駅前でいいですか？").ok, true);
  assert.equal(checkOrderMessage("   ").ok, false);
  assert.equal(checkOrderMessage("x".repeat(501)).ok, false);
  assert.equal(checkOrderMessage("LINEは test@example.com").ok, false);
});

for (const [name, fn] of cases) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}
console.log(`\n${passed}/${cases.length} passed`);
