// 運営（管理者）の API。画面（管理者パネル）は持たない。
// 認証は環境変数 ADMIN_PASSWORD だけ。リクエストごとに Basic 認証で確かめる（ユーザー名は何でもよい）。
//
// 例：curl -u admin:パスワード https://apps.example.com/api/admin/apps
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { sb } from "./supabase.js";
import multer from "multer";
import { APP_COLUMNS, AppRow, loadApp, toCards, UUID } from "./appData.js";
import { ApiError, sendError } from "./errors.js";
import { deleteImageBlobs, imageUrl, saveImageBlob } from "./images.js";
import { checkText, sniffImage, THUMB_MAX_BYTES } from "./rules.js";

export const admin = Router();

// パスワードが一致するか（時間差で推測されないように、ハッシュを比べる）
const samePassword = (given: string) => {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
};

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!config.adminPassword) {
    res.status(503).json({ ok: false, error: "運営の機能は無効です（ADMIN_PASSWORD が未設定）。" });
    return;
  }
  const header = req.headers.authorization ?? "";
  const encoded = header.startsWith("Basic ") ? header.slice(6) : "";
  const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
  const password = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : "";
  if (!password || !samePassword(password)) {
    res.set("WWW-Authenticate", 'Basic realm="soraapps admin", charset="UTF-8"');
    res.status(401).json({ ok: false, error: "運営の認証に失敗しました。" });
    return;
  }
  next();
}

admin.use("/admin", requireAdmin);

// 確認用：認証が通るかどうか
admin.get("/admin/me", (_req, res) => {
  res.json({ ok: true });
});

// 一覧：全部の拡張機能（削除済みを除く）、通報の件数、ポイント配布の設定
admin.get("/admin/apps", async (_req, res) => {
  try {
    const { data, error } = await sb
      .from("sa_apps")
      .select(APP_COLUMNS)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []) as AppRow[];
    const ids = rows.map((r) => r.id);
    const [grants, reports] = ids.length
      ? await Promise.all([
          sb.from("sa_app_grants").select("*").in("app_id", ids),
          sb.from("sa_app_reports").select("app_id").in("app_id", ids)
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (grants.error) throw grants.error;
    if (reports.error) throw reports.error;

    const grantBy = new Map((grants.data ?? []).map((g: any) => [g.app_id as string, g]));
    const reportCount = new Map<string, number>();
    for (const r of reports.data ?? []) reportCount.set(r.app_id as string, (reportCount.get(r.app_id as string) ?? 0) + 1);

    res.set("Cache-Control", "no-store");
    res.json({
      apps: rows.map((r) => {
        const g: any = grantBy.get(r.id);
        return {
          id: r.id,
          name: r.name,
          category: r.category,
          price: r.price,
          status: r.status,
          hiddenReason: r.hidden_reason,
          creatorName: r.creator?.display_name ?? "作者",
          reports: reportCount.get(r.id) ?? 0,
          grant: {
            active: Boolean(g?.active),
            maxPoints: Number(g?.max_points ?? 0),
            usedPoints: Number(g?.used_points ?? 0),
            perCallMax: Number(g?.per_call_max ?? 500),
            perUserMinuteMax: Number(g?.per_user_minute_max ?? 0)
          }
        };
      })
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 公開・非公開（運営の判断）
admin.post("/admin/apps/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    const status = req.body?.status;
    if (status !== "published" && status !== "hidden") throw new ApiError(400, "invalid", "状態は published か hidden にしてください。");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
    const { error } = await sb
      .from("sa_apps")
      .update({ status, hidden_reason: status === "hidden" ? reason || "運営により非公開になりました。" : null })
      .eq("id", id)
      .neq("status", "deleted");
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// 通報の記録を消す（誤って非公開になったものを戻すときなど）
admin.post("/admin/apps/:id/clear-reports", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    const { error } = await sb.from("sa_app_reports").delete().eq("app_id", id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// ポイント配布の設定（拡張機能ごと）。used_points（使った分）は変えない
admin.post("/admin/apps/:id/grant", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    const body = req.body ?? {};
    const maxPoints = Number(body.maxPoints);
    const perCallMax = Number(body.perCallMax);
    const perUserMinuteMax = Number(body.perUserMinuteMax);
    if (!Number.isInteger(maxPoints) || maxPoints < 0 || maxPoints > 2_000_000_000) throw new ApiError(400, "invalid", "合計の上限は0以上の整数で指定してください。");
    if (!Number.isInteger(perCallMax) || perCallMax < 1 || perCallMax > 100_000) throw new ApiError(400, "invalid", "1回の上限は1〜100000の整数で指定してください。");
    if (!Number.isInteger(perUserMinuteMax) || perUserMinuteMax < 0) throw new ApiError(400, "invalid", "1分あたりの上限は0以上の整数で指定してください（0は制限なし）。");
    const { error } = await sb.from("sa_app_grants").upsert(
      {
        app_id: id,
        active: Boolean(body.active),
        max_points: maxPoints,
        per_call_max: perCallMax,
        per_user_minute_max: perUserMinuteMax,
        updated_at: new Date().toISOString()
      },
      { onConflict: "app_id" }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// ---------- おすすめ（ストアのホームの先頭。画像とアプリと紹介文） ----------
// 例：curl -u admin:パスワード -F appId=<アプリID> -F promoText="紹介文" -F position=0 -F image=@banner.png https://apps.example.com/api/admin/featured

const featuredUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: THUMB_MAX_BYTES, files: 1 } }).single("image");
const PROMO_MAX = 300;

function promoOf(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > PROMO_MAX) throw new ApiError(400, "invalid", `紹介文は ${PROMO_MAX} 文字以内にしてください。`);
  const problem = checkText(text, "紹介文");
  if (problem) throw new ApiError(400, "invalid", problem);
  return text;
}

function positionOf(value: unknown): number {
  const n = value === undefined || value === "" ? 0 : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new ApiError(400, "invalid", "並び順は 0〜999 の整数で指定してください。");
  return n;
}

// 一覧（管理用：公開していないアプリも含む）
admin.get("/admin/featured", async (_req, res) => {
  try {
    const { data, error } = await sb
      .from("sa_featured")
      .select("id, app_id, blob_id, promo_text, position")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = data ?? [];
    const { data: apps, error: appsError } = rows.length
      ? await sb.from("sa_apps").select(APP_COLUMNS).in("id", rows.map((r) => r.app_id as string))
      : { data: [], error: null };
    if (appsError) throw appsError;
    const cards = await toCards((apps ?? []) as AppRow[], null);
    const byId = new Map(cards.map((c) => [c.id, c]));
    res.set("Cache-Control", "no-store");
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        position: r.position,
        promoText: r.promo_text,
        imageUrl: imageUrl(r.blob_id as string),
        app: byId.get(r.app_id as string) ?? null
      }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 登録（画像・アプリ・紹介文・並び順）
admin.post("/admin/featured", featuredUpload, async (req, res) => {
  try {
    const file = req.file;
    if (!file) throw new ApiError(400, "invalid", "画像（image）を指定してください。");
    const image = sniffImage(file.buffer);
    if (!image) throw new ApiError(400, "invalid", "画像は PNG・JPEG・GIF・WebP にしてください。");
    const appId = String(req.body?.appId ?? "");
    if (!UUID.test(appId)) throw new ApiError(400, "invalid", "アプリ（appId）を指定してください。");
    const app = await loadApp(appId);
    if (!app || app.status === "deleted") throw new ApiError(404, "not_found", "アプリが見つかりません。");
    const promoText = promoOf(req.body?.promoText);
    const position = positionOf(req.body?.position);

    const blobId = await saveImageBlob(file.buffer, image.mime);
    const { data, error } = await sb
      .from("sa_featured")
      .insert({ app_id: appId, blob_id: blobId, promo_text: promoText, position })
      .select("id")
      .single();
    if (error) throw error;
    res.status(201).json({ ok: true, id: data.id });
  } catch (error) {
    sendError(res, error);
  }
});

// 紹介文・並び順の変更（画像とアプリは変えない。変えたいときは削除して登録し直す）
admin.post("/admin/featured/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "おすすめが見つかりません。");
    const update: Record<string, unknown> = {};
    if (req.body?.promoText !== undefined) update.promo_text = promoOf(req.body.promoText);
    if (req.body?.position !== undefined) update.position = positionOf(req.body.position);
    if (!Object.keys(update).length) throw new ApiError(400, "invalid", "promoText か position を指定してください。");
    const { error, count } = await sb.from("sa_featured").update(update, { count: "exact" }).eq("id", id);
    if (error) throw error;
    if (!count) throw new ApiError(404, "not_found", "おすすめが見つかりません。");
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// 削除（画像も消す）
admin.delete("/admin/featured/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "おすすめが見つかりません。");
    const { data, error } = await sb.from("sa_featured").delete().eq("id", id).select("blob_id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "not_found", "おすすめが見つかりません。");
    await deleteImageBlobs([data.blob_id as string]).catch((e) => console.error("[admin] 画像の削除に失敗:", e));
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});
