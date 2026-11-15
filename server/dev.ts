// 作者向け（開発者ダッシュボード）：公開・編集・削除・プレビュー・売上。
// 種類は、拡張機能・画像・マンガ・小説・手渡しグッズ。審査はなし。公開時に自動チェックを通ったものだけ公開される。
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { currentUserId, requireAuth } from "./session.js";
import { sb } from "./supabase.js";
import { deleteImageBlobs, imageIdFromUrl, imageUrl, saveImageBlob } from "./images.js";
import { APP_COLUMNS, AppRow, loadApp, toCards, UUID } from "./appData.js";
import { retryCreatorPayouts } from "./payments.js";
import { ApiError, sendError } from "./errors.js";
import {
  buildExtensionDocument,
  checkBasics,
  checkCategory,
  checkChapters,
  checkCode,
  checkGoodsPrice,
  checkHandoverNote,
  checkKind,
  checkPages,
  checkPrice,
  checkProducts,
  checkShots,
  checkStock,
  checkThumbImage,
  ChapterInput,
  DAILY_APP_LIMIT,
  Kind,
  PAGE_MAX_BYTES,
  PAGES_MAX,
  ProductInput,
  sniffImage,
  CODE_TOTAL_MAX,
  CONTENT_TEXT_MAX,
  SHOTS_MAX
} from "./rules.js";

export const dev = Router();
dev.use("/dev", requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PAGE_MAX_BYTES, // サムネイル・紹介画像は、これとは別に 2MB 以下を検査する
    fieldSize: Math.max(CODE_TOTAL_MAX, CONTENT_TEXT_MAX) * 4 + 1024, // コードや小説の本文（JSON）が入るように
    files: 1 + SHOTS_MAX + PAGES_MAX
  }
}).fields([
  { name: "thumb", maxCount: 1 },
  { name: "shots", maxCount: SHOTS_MAX },
  { name: "pages", maxCount: PAGES_MAX }
]);

type Uploaded = { thumb?: Express.Multer.File; shots?: Express.Multer.File[]; pages?: Express.Multer.File[] };
// multer の .fields() は、各欄を配列で渡す（例: thumb は [ファイル]）。1枚だけの欄は先頭を取り出す
const filesOf = (req: { files?: unknown }): Uploaded => {
  const raw = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
  return { thumb: raw.thumb?.[0], shots: raw.shots ?? [], pages: raw.pages ?? [] };
};

// 作者の停止の確認（停止中は公開・編集できない）
async function assertCreatorActive(me: string) {
  const { error: upsertError } = await sb
    .from("sa_creators")
    .upsert({ user_id: me }, { onConflict: "user_id", ignoreDuplicates: true });
  if (upsertError) throw upsertError;
  const { data, error } = await sb.from("sa_creators").select("suspended, suspended_reason").eq("user_id", me).maybeSingle();
  if (error) throw error;
  if (data?.suspended) {
    throw new ApiError(
      403,
      "suspended",
      `この作者アカウントは公開を停止されています。${data.suspended_reason ? `（理由: ${data.suspended_reason}）` : ""}`
    );
  }
}

// 作者の一覧：自分の作品・売上・入金待ち（手渡しの預かり中）・未払い。開いたときに、保留の支払いを払い直す
dev.get("/dev/apps", async (_req, res) => {
  try {
    const me = currentUserId(res);
    await retryCreatorPayouts(me).catch((error) => console.error("[apps] 支払いの確認に失敗:", error));
    await assertCreatorActive(me).catch(() => undefined);
    const { data: creator } = await sb.from("sa_creators").select("suspended, suspended_reason").eq("user_id", me).maybeSingle();

    const { data, error } = await sb
      .from("sa_apps")
      .select(APP_COLUMNS)
      .eq("creator_id", me)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const cards = await toCards((data ?? []) as AppRow[], me);

    const [{ data: payouts, error: payoutError }, { data: openOrders, error: orderError }] = await Promise.all([
      sb.from("sa_app_payouts").select("app_id, amount, status").eq("creator_id", me),
      sb.from("sa_orders").select("amount").eq("seller_id", me).eq("status", "open")
    ]);
    if (payoutError) throw payoutError;
    if (orderError) throw orderError;
    const earnedBy = new Map<string, number>();
    let earned = 0;
    let pending = 0;
    for (const p of payouts ?? []) {
      const amount = Number(p.amount);
      if (p.status === "paid") {
        earned += amount;
        earnedBy.set(p.app_id as string, (earnedBy.get(p.app_id as string) ?? 0) + amount);
      }
      if (p.status === "pending") pending += amount;
    }
    const escrow = (openOrders ?? []).reduce((total, o) => total + Number(o.amount), 0);

    res.set("Cache-Control", "no-store");
    res.json({
      suspended: Boolean(creator?.suspended),
      suspendedReason: (creator?.suspended_reason as string | null) ?? null,
      earned,
      pending,
      escrow,
      apps: cards.map((c) => ({ ...c, earned: earnedBy.get(c.id) ?? 0 }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 編集のための中身（作者だけ）
dev.get("/dev/apps/:id", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await loadApp(String(req.params.id));
    if (!row || row.creator_id !== me || row.status === "deleted") throw new ApiError(404, "not_found", "作品が見つかりません。");
    const [{ data: code, error }, { data: images }, { data: products }, { data: chapters }, { count: pageCount }] = await Promise.all([
      sb.from("sa_app_code").select("html, css, js").eq("app_id", row.id).maybeSingle(),
      sb.from("sa_app_images").select("blob_id, position").eq("app_id", row.id).order("position"),
      sb.from("sa_app_products").select("sku, title, description, price").eq("app_id", row.id).order("position"),
      sb.from("sa_content_chapters").select("title, body").eq("app_id", row.id).order("position"),
      sb.from("sa_content_pages").select("position", { count: "exact", head: true }).eq("app_id", row.id)
    ]);
    if (error) throw error;
    const [card] = await toCards([row], me);
    res.set("Cache-Control", "no-store");
    res.json({
      app: card,
      code: { html: code?.html ?? "", css: code?.css ?? "", js: code?.js ?? "" },
      images: (images ?? []).map((i) => imageUrl(i.blob_id as string)),
      products: products ?? [],
      chapters: (chapters ?? []).map((c) => ({ title: c.title as string, body: c.body as string })),
      pageCount: pageCount ?? 0
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 入力の検査（作る・直すで共通）。問題があれば ApiError を投げる。
// existing：直すときの今の種類（公開したあとは種類を変えられない）
function readFields(body: Record<string, string | undefined>, files: Uploaded, requireThumb: boolean, existing: Kind | null) {
  const kindError = checkKind(body.kind ?? "extension");
  if (kindError) throw new ApiError(400, "invalid", kindError);
  if (existing && body.kind && body.kind !== existing) throw new ApiError(400, "invalid", "種類は公開したあとには変えられません。");
  const kind = (existing ?? (body.kind as Kind | undefined) ?? "extension") as Kind;

  const basics = checkBasics(body.name, body.description ?? "");
  if (basics) throw new ApiError(400, "invalid", basics);
  const category = checkCategory(body.category);
  if (category) throw new ApiError(400, "invalid", category);
  const price = kind === "goods" ? checkGoodsPrice(body.price ?? "0") : checkPrice(body.price ?? "0");
  if (price) throw new ApiError(400, "invalid", price);

  // 拡張機能だけ、HTML・CSS・JavaScript を持つ
  let code = { html: "", css: "", js: "" };
  if (kind === "extension") {
    const checked = checkCode({ html: body.html ?? "", css: body.css ?? "", js: body.js ?? "" });
    if (!checked.ok) throw new ApiError(400, "invalid", checked.error);
    code = checked.payload;
  }

  const file = files.thumb;
  if (file) {
    const error = checkThumbImage(file.buffer);
    if (error) throw new ApiError(400, "invalid", error);
  } else if (requireThumb) {
    throw new ApiError(400, "invalid", "サムネイル画像を選んでください。");
  }
  const shots = files.shots ?? [];
  const shotError = checkShots(shots);
  if (shotError) throw new ApiError(400, "invalid", shotError);
  if (requireThumb && shots.length === 0) throw new ApiError(400, "invalid", "商品紹介画像を1枚以上選んでください。");

  // アプリ内課金の商品は拡張機能だけ
  const products = kind === "extension" ? checkProducts(body.products) : { ok: true as const, items: [] as ProductInput[] };
  if (!products.ok) throw new ApiError(400, "invalid", products.error);

  // ページ画像（画像・マンガ）：新規は必須。直すときは、選び直したときだけ置き換える
  const pages = kind === "image" || kind === "manga" ? (files.pages ?? []) : [];
  if ((kind === "image" || kind === "manga") && (requireThumb || pages.length)) {
    const pageError = checkPages(pages);
    if (pageError) throw new ApiError(400, "invalid", pageError);
  }

  // 小説の章：新規は必須。直すときは、章が送られてきたときだけ置き換える
  let chapters: ChapterInput[] | null = null;
  if (kind === "novel" && (requireThumb || body.chapters !== undefined)) {
    const parsed = checkChapters(body.chapters ?? "");
    if (!parsed.ok) throw new ApiError(400, "invalid", parsed.error);
    chapters = parsed.items;
  }

  // 手渡しグッズ：在庫と受け渡しの目安
  let stock = 1;
  let handoverNote = "";
  if (kind === "goods") {
    const stockError = checkStock(body.stock ?? "1");
    if (stockError) throw new ApiError(400, "invalid", stockError);
    stock = Number(body.stock ?? 1);
    handoverNote = (body.handoverNote ?? "").trim();
    const noteError = checkHandoverNote(handoverNote);
    if (noteError) throw new ApiError(400, "invalid", noteError);
  }

  return {
    kind,
    shots,
    products: products.items,
    pages,
    chapters,
    stock,
    handoverNote,
    name: String(body.name).trim(),
    description: (body.description ?? "").trim(),
    category: body.category as string,
    price: Number(body.price ?? 0),
    code
  };
}

// 失敗した手順の名前を画面に返す（詳しい理由はログに残す）
function dbFail(step: string, error: unknown): never {
  console.error(`[apps] ${step}に失敗:`, error);
  const detail = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  throw new ApiError(500, "db", `${step}に失敗しました。${detail ? `（${detail}）` : ""}少し時間をおいて、もう一度お試しください。`);
}

// 画像の形式を確かめてから Turso に保存する。作った ID は track に入れ、失敗したとき消せるようにする
async function storeImage(file: Express.Multer.File, track: string[], label: string): Promise<string> {
  const image = sniffImage(file.buffer);
  if (!image) throw new ApiError(400, "invalid", `${label}の形式を読み取れませんでした。`);
  const id = await saveImageBlob(file.buffer, image.mime);
  track.push(id);
  return id;
}

// 途中で失敗したときの後始末：新しく作った作品（子の行も一緒に消える）と、保存した画像を消す
async function rollback(track: string[], newAppId: string | null) {
  if (newAppId) {
    const { error } = await sb.from("sa_apps").delete().eq("id", newAppId);
    if (error) console.error("[apps] 作りかけの作品の削除に失敗:", error);
  }
  if (track.length) await deleteImageBlobs(track).catch((error) => console.error("[apps] 画像の後始末に失敗:", error));
}

async function uploadThumb(file: Express.Multer.File, track: string[]): Promise<string> {
  return imageUrl(await storeImage(file, track, "サムネイル"));
}

// 商品紹介画像：新しい画像を先に保存・登録し、そのあとで古いものを消す（途中で失敗しても前の画像は残る）
async function replaceShots(appId: string, files: Express.Multer.File[], track: string[]) {
  const { data: old, error: oldError } = await sb.from("sa_app_images").select("blob_id").eq("app_id", appId);
  if (oldError) dbFail("紹介画像の確認", oldError);
  const rows: { app_id: string; position: number; blob_id: string }[] = [];
  for (const [position, file] of files.entries()) {
    rows.push({ app_id: appId, position, blob_id: await storeImage(file, track, `${position + 1}枚目の紹介画像`) });
  }
  if (rows.length) {
    const { error } = await sb.from("sa_app_images").insert(rows);
    if (error) dbFail("紹介画像の保存", error);
  }
  const oldIds = (old ?? []).map((o) => o.blob_id as string);
  if (oldIds.length) {
    const { error } = await sb.from("sa_app_images").delete().eq("app_id", appId).in("blob_id", oldIds);
    if (error) {
      console.error("[apps] 古い紹介画像の行の削除に失敗（画像は残します）:", error);
      return;
    }
    await deleteImageBlobs(oldIds).catch((error) => console.error("[apps] 古い画像の削除に失敗:", error));
  }
}

// マンガ・画像のページを置き換える（主キーが作品と並び順なので、先に古い行を消してから入れる）
async function replacePages(appId: string, files: Express.Multer.File[], track: string[]) {
  const { data: old, error: oldError } = await sb.from("sa_content_pages").select("blob_id").eq("app_id", appId);
  if (oldError) dbFail("ページの確認", oldError);
  const rows: { app_id: string; position: number; blob_id: string }[] = [];
  for (const [position, file] of files.entries()) {
    rows.push({ app_id: appId, position, blob_id: await storeImage(file, track, `${position + 1}ページ目`) });
  }
  const { error: deleteError } = await sb.from("sa_content_pages").delete().eq("app_id", appId);
  if (deleteError) dbFail("ページの入れ替え", deleteError);
  const { error } = await sb.from("sa_content_pages").insert(rows);
  if (error) dbFail("ページの保存", error);
  const oldIds = (old ?? []).map((o) => o.blob_id as string);
  if (oldIds.length) await deleteImageBlobs(oldIds).catch((error) => console.error("[apps] 古いページの削除に失敗:", error));
}

// 小説の章を置き換える
async function replaceChapters(appId: string, items: ChapterInput[]) {
  const { error: deleteError } = await sb.from("sa_content_chapters").delete().eq("app_id", appId);
  if (deleteError) dbFail("章の入れ替え", deleteError);
  const { error } = await sb.from("sa_content_chapters").insert(
    items.map((item, position) => ({ app_id: appId, position, title: item.title, body: item.body }))
  );
  if (error) dbFail("章の保存", error);
}

// アプリ内課金の商品を置き換える（買い切りの記録は残るので、買った人は引き続き持っている）
async function replaceProducts(appId: string, items: ProductInput[]) {
  const { error: deleteError } = await sb.from("sa_app_products").delete().eq("app_id", appId);
  if (deleteError) dbFail("商品の入れ替え", deleteError);
  if (!items.length) return;
  const { error } = await sb.from("sa_app_products").insert(items.map((item, position) => ({ app_id: appId, position, ...item })));
  if (error) dbFail("商品の保存", error);
}

// 公開（新しい作品を作る）
dev.post("/dev/apps", upload, async (req, res) => {
  const track: string[] = [];
  let newAppId: string | null = null;
  try {
    const me = currentUserId(res);
    await assertCreatorActive(me);
    const { count, error: countError } = await sb
      .from("sa_apps")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", me)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (countError) dbFail("公開数の確認", countError);
    if ((count ?? 0) >= DAILY_APP_LIMIT) throw new ApiError(429, "daily", `1日に公開できるのは${DAILY_APP_LIMIT}件までです。`);

    const files = filesOf(req);
    const fields = readFields(req.body, files, true, null);
    const id = randomUUID();
    // 画像は先に Turso へ保存する（ここで失敗すれば、作品はまだ作られていない）
    const thumbUrl = await uploadThumb(files.thumb as Express.Multer.File, track);

    const { error } = await sb.from("sa_apps").insert({
      id,
      creator_id: me,
      name: fields.name,
      description: fields.description,
      category: fields.category,
      kind: fields.kind,
      price: fields.price,
      stock: fields.stock,
      handover_note: fields.handoverNote,
      status: "published",
      thumb_url: thumbUrl
    });
    if (error) dbFail("作品の登録", error);
    newAppId = id;

    if (fields.kind === "extension") {
      const { error: codeError } = await sb.from("sa_app_code").insert({ app_id: id, ...fields.code });
      if (codeError) dbFail("コードの保存", codeError);
    }
    await replaceShots(id, fields.shots, track);
    await replaceProducts(id, fields.products);
    if (fields.pages.length) await replacePages(id, fields.pages, track);
    if (fields.chapters) await replaceChapters(id, fields.chapters);
    res.status(201).json({ ok: true, id });
  } catch (error) {
    await rollback(track, newAppId);
    sendError(res, error);
  }
});

// 編集（名前・説明・カテゴリ・価格・サムネイル・中身）。買った人の手元にも反映される
dev.post("/dev/apps/:id", upload, async (req, res) => {
  const track: string[] = [];
  try {
    const me = currentUserId(res);
    await assertCreatorActive(me);
    const row = await loadApp(String(req.params.id));
    if (!row || row.creator_id !== me || row.status === "deleted") throw new ApiError(404, "not_found", "作品が見つかりません。");

    const files = filesOf(req);
    const fields = readFields(req.body, files, false, row.kind);
    const update: Record<string, unknown> = {
      name: fields.name,
      description: fields.description,
      category: fields.category,
      price: fields.price,
      edited_at: new Date().toISOString()
    };
    if (fields.kind === "goods") {
      update.stock = fields.stock;
      update.handover_note = fields.handoverNote;
    }
    if (files.thumb) update.thumb_url = await uploadThumb(files.thumb, track);

    const { error } = await sb.from("sa_apps").update(update).eq("id", row.id);
    if (error) dbFail("作品の更新", error);
    // 古いサムネイルは、新しいものに置き換わったあとで消す（更新に失敗しても、前のサムネイルは残る）
    if (files.thumb) {
      const oldId = imageIdFromUrl(row.thumb_url);
      if (oldId) await deleteImageBlobs([oldId]).catch((error) => console.error("[apps] 古いサムネイルの削除に失敗:", error));
    }
    if (fields.kind === "extension") {
      const { error: codeError } = await sb.from("sa_app_code").upsert({ app_id: row.id, ...fields.code }, { onConflict: "app_id" });
      if (codeError) dbFail("コードの保存", codeError);
      await replaceProducts(row.id, fields.products);
    }
    // 紹介画像・ページ・章は、新しく送られてきたときだけ置き換える
    if (fields.shots.length) await replaceShots(row.id, fields.shots, track);
    if (fields.pages.length) await replacePages(row.id, fields.pages, track);
    if (fields.chapters) await replaceChapters(row.id, fields.chapters);
    res.json({ ok: true });
  } catch (error) {
    await rollback(track, null);
    sendError(res, error);
  }
});

// 削除（公開をやめる。買った人は引き続き使える・読める）
dev.delete("/dev/apps/:id", async (req, res) => {
  try {
    const me = currentUserId(res);
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "作品が見つかりません。");
    const { error, count } = await sb
      .from("sa_apps")
      .update({ status: "deleted", edited_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", id)
      .eq("creator_id", me)
      .neq("status", "deleted");
    if (error) throw error;
    if (!count) throw new ApiError(404, "not_found", "作品が見つかりません。");
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// プレビュー（保存しない）。拡張機能だけ。本番と同じ文書を作る
dev.post("/dev/preview", (req, res) => {
  const code = checkCode(req.body ?? {});
  if (!code.ok) {
    res.status(400).json({ ok: false, error: code.error });
    return;
  }
  res.json({ ok: true, doc: buildExtensionDocument(code.payload) });
});
