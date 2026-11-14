// 作者向け（開発者ダッシュボード）：公開・編集・削除・プレビュー・売上。
// 審査はなし。公開時に自動チェック（禁止語・URL・連絡先・画像の中身・コードの隔離の境界）を通ったものだけ公開される。
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
  checkCode,
  checkPrice,
  checkProducts,
  checkShots,
  checkThumbImage,
  DAILY_APP_LIMIT,
  ProductInput,
  sniffImage,
  THUMB_MAX_BYTES,
  CODE_TOTAL_MAX
} from "./rules.js";

export const dev = Router();
dev.use("/dev", requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: THUMB_MAX_BYTES, fieldSize: CODE_TOTAL_MAX * 4 + 1024, files: 1 + 5 }
}).fields([
  { name: "thumb", maxCount: 1 },
  { name: "shots", maxCount: 5 }
]);

type Uploaded = { thumb?: Express.Multer.File; shots?: Express.Multer.File[] };
const filesOf = (req: { files?: unknown }): Uploaded => (req.files ?? {}) as Uploaded;

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

// 作者の一覧：自分の拡張機能・売上・未払い。開いたときに、保留の支払いを払い直す
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
    const rows = (data ?? []) as AppRow[];
    const cards = await toCards(rows, me);

    const { data: payouts, error: payoutError } = await sb
      .from("sa_app_payouts")
      .select("app_id, amount, status")
      .eq("creator_id", me);
    if (payoutError) throw payoutError;
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

    res.set("Cache-Control", "no-store");
    res.json({
      suspended: Boolean(creator?.suspended),
      suspendedReason: (creator?.suspended_reason as string | null) ?? null,
      earned,
      pending,
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
    if (!row || row.creator_id !== me || row.status === "deleted") throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    const [{ data: code, error }, { data: images }, { data: products }] = await Promise.all([
      sb.from("sa_app_code").select("html, css, js").eq("app_id", row.id).maybeSingle(),
      sb.from("sa_app_images").select("blob_id, position").eq("app_id", row.id).order("position"),
      sb.from("sa_app_products").select("sku, title, description, price").eq("app_id", row.id).order("position")
    ]);
    if (error) throw error;
    const [card] = await toCards([row], me);
    res.set("Cache-Control", "no-store");
    res.json({
      app: card,
      code: { html: code?.html ?? "", css: code?.css ?? "", js: code?.js ?? "" },
      images: (images ?? []).map((i) => imageUrl(i.blob_id as string)),
      products: products ?? []
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 入力の検査（作る・直すで共通）。問題があれば ApiError を投げる
function readFields(body: Record<string, string | undefined>, files: Uploaded, requireThumb: boolean) {
  const file = files.thumb;
  const basics = checkBasics(body.name, body.description ?? "");
  if (basics) throw new ApiError(400, "invalid", basics);
  const category = checkCategory(body.category);
  if (category) throw new ApiError(400, "invalid", category);
  const price = checkPrice(body.price ?? "0");
  if (price) throw new ApiError(400, "invalid", price);
  const code = checkCode({ html: body.html ?? "", css: body.css ?? "", js: body.js ?? "" });
  if (!code.ok) throw new ApiError(400, "invalid", code.error);
  if (file) {
    const error = checkThumbImage(file.buffer);
    if (error) throw new ApiError(400, "invalid", error);
  } else if (requireThumb) {
    throw new ApiError(400, "invalid", "サムネイル画像を選んでください。");
  }
  const shots = files.shots ?? [];
  const shotError = checkShots(shots);
  if (shotError) throw new ApiError(400, "invalid", shotError);
  const products = checkProducts(body.products);
  if (!products.ok) throw new ApiError(400, "invalid", products.error);
  if (requireThumb && shots.length === 0) throw new ApiError(400, "invalid", "商品紹介画像を1枚以上選んでください。");
  return {
    shots,
    products: products.items,
    name: String(body.name).trim(),
    description: (body.description ?? "").trim(),
    category: body.category as string,
    price: Number(body.price ?? 0),
    code: code.payload
  };
}

async function uploadThumb(file: Express.Multer.File): Promise<string> {
  const image = sniffImage(file.buffer);
  if (!image) throw new ApiError(400, "invalid", "サムネイルの形式を読み取れませんでした。");
  return imageUrl(await saveImageBlob(file.buffer, image.mime));
}

// 商品紹介画像を Turso に保存し、並び順つきで記録する（既存の画像は置き換える）
async function replaceShots(appId: string, files: Express.Multer.File[]) {
  const { data: old, error: oldError } = await sb.from("sa_app_images").select("blob_id").eq("app_id", appId);
  if (oldError) throw oldError;
  if (old?.length) {
    const { error: deleteError } = await sb.from("sa_app_images").delete().eq("app_id", appId);
    if (deleteError) throw deleteError;
    await deleteImageBlobs(old.map((o) => o.blob_id as string)).catch((error) => console.error("[apps] 古い画像の削除に失敗:", error));
  }
  const rows: { app_id: string; position: number; blob_id: string }[] = [];
  for (const [position, file] of files.entries()) {
    const image = sniffImage(file.buffer);
    if (!image) throw new ApiError(400, "invalid", "紹介画像の形式を読み取れませんでした。");
    rows.push({ app_id: appId, position, blob_id: await saveImageBlob(file.buffer, image.mime) });
  }
  if (rows.length) {
    const { error } = await sb.from("sa_app_images").insert(rows);
    if (error) throw error;
  }
}

// アプリ内課金の商品を置き換える（買い切りの記録は残るので、買った人は引き続き持っている）
async function replaceProducts(appId: string, items: ProductInput[]) {
  const { error: deleteError } = await sb.from("sa_app_products").delete().eq("app_id", appId);
  if (deleteError) throw deleteError;
  if (!items.length) return;
  const { error } = await sb.from("sa_app_products").insert(
    items.map((item, position) => ({ app_id: appId, position, ...item }))
  );
  if (error) throw error;
}

// 公開（新しい拡張機能を作る）
dev.post("/dev/apps", upload, async (req, res) => {
  try {
    const me = currentUserId(res);
    await assertCreatorActive(me);
    const { count, error: countError } = await sb
      .from("sa_apps")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", me)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (countError) throw countError;
    if ((count ?? 0) >= DAILY_APP_LIMIT) throw new ApiError(429, "daily", `1日に公開できるのは${DAILY_APP_LIMIT}件までです。`);

    const files = filesOf(req);
    const fields = readFields(req.body, files, true);
    const id = randomUUID();
    const thumbUrl = await uploadThumb(files.thumb as Express.Multer.File);

    const { error } = await sb.from("sa_apps").insert({
      id,
      creator_id: me,
      name: fields.name,
      description: fields.description,
      category: fields.category,
      price: fields.price,
      status: "published",
      thumb_url: thumbUrl
    });
    if (error) throw error;
    const { error: codeError } = await sb.from("sa_app_code").insert({ app_id: id, ...fields.code });
    if (codeError) throw codeError;
    await replaceShots(id, fields.shots);
    await replaceProducts(id, fields.products);
    res.status(201).json({ ok: true, id });
  } catch (error) {
    sendError(res, error);
  }
});

// 編集（名前・説明・カテゴリ・価格・サムネイル・コード）。買った人の手元にも反映される
dev.post("/dev/apps/:id", upload, async (req, res) => {
  try {
    const me = currentUserId(res);
    await assertCreatorActive(me);
    const row = await loadApp(String(req.params.id));
    if (!row || row.creator_id !== me || row.status === "deleted") throw new ApiError(404, "not_found", "拡張機能が見つかりません。");

    const files = filesOf(req);
    const fields = readFields(req.body, files, false);
    const update: Record<string, unknown> = {
      name: fields.name,
      description: fields.description,
      category: fields.category,
      price: fields.price,
      edited_at: new Date().toISOString()
    };
    if (files.thumb) {
    update.thumb_url = await uploadThumb(files.thumb);
    const oldId = imageIdFromUrl(row.thumb_url);
    if (oldId) await deleteImageBlobs([oldId]).catch((error) => console.error("[apps] 古いサムネイルの削除に失敗:", error));
  }

    const { error } = await sb.from("sa_apps").update(update).eq("id", row.id);
    if (error) throw error;
    const { error: codeError } = await sb.from("sa_app_code").upsert({ app_id: row.id, ...fields.code }, { onConflict: "app_id" });
    if (codeError) throw codeError;
    // 紹介画像は新しく選んだときだけ置き換える。商品は編集フォームの内容で置き換える
    if (fields.shots.length) await replaceShots(row.id, fields.shots);
    await replaceProducts(row.id, fields.products);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// 削除（公開をやめる。買った人は引き続き使える）
dev.delete("/dev/apps/:id", async (req, res) => {
  try {
    const me = currentUserId(res);
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    const { error, count } = await sb
      .from("sa_apps")
      .update({ status: "deleted", edited_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", id)
      .eq("creator_id", me)
      .neq("status", "deleted");
    if (error) throw error;
    if (!count) throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// プレビュー（保存しない）。本番と同じ文書を作る。画面では sandbox の iframe に入れる
dev.post("/dev/preview", (req, res) => {
  const code = checkCode(req.body ?? {});
  if (!code.ok) {
    res.status(400).json({ ok: false, error: code.error });
    return;
  }
  res.json({ ok: true, doc: buildExtensionDocument(code.payload) });
});
