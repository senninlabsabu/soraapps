// マンガ・画像・小説の中身を配信する（購入した人・作者だけ）。
// 公開の画像 URL（/api/images/:id）には載せない。ページは /api/content/:id/pages/:index で、
// 小説の本文は /api/content/:id/chapters/:index で、毎回ログインと購入を確かめてから返す。
import { Router } from "express";
import { currentUserId, requireAuth } from "./session.js";
import { sb } from "./supabase.js";
import { AppRow, isOwned, loadApp } from "./appData.js";
import { readImageBlob } from "./images.js";
import { ApiError, sendError } from "./errors.js";
import type { Kind } from "./rules.js";

export const content = Router();

// 読んでよいか：作者は常に読める。買った人（追加した人）は、非公開でなければ読める（作者が削除したあとも読める）
async function readable(me: string, id: string, kinds: Kind[]): Promise<AppRow> {
  const row = await loadApp(id);
  if (!row) throw new ApiError(404, "not_found", "作品が見つかりません。");
  if (!kinds.includes(row.kind)) throw new ApiError(400, "invalid", "この形式の作品ではありません。");
  if (row.creator_id === me) return row;
  if (row.status === "hidden") throw new ApiError(403, "hidden", "この作品は非公開です。");
  if (!(await isOwned(me, row.id))) throw new ApiError(403, "not_owned", "購入（追加）してから読めます。");
  return row;
}

const PAGE_KINDS: Kind[] = ["image", "manga"];
const NOVEL_KINDS: Kind[] = ["novel"];

// ---------- ページ（画像・マンガ） ----------

content.get("/content/:id/pages", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await readable(me, String(req.params.id), PAGE_KINDS);
    const { data, error } = await sb.from("sa_content_pages").select("position").eq("app_id", row.id).order("position");
    if (error) throw error;
    res.set("Cache-Control", "private, no-store");
    res.json({
      kind: row.kind,
      pages: (data ?? []).map((p) => ({ index: Number(p.position), url: `/api/content/${row.id}/pages/${p.position}` }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

content.get("/content/:id/pages/:index", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await readable(me, String(req.params.id), PAGE_KINDS);
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw new ApiError(404, "not_found", "ページが見つかりません。");
    const { data, error } = await sb.from("sa_content_pages").select("blob_id").eq("app_id", row.id).eq("position", index).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "not_found", "ページが見つかりません。");
    const blob = await readImageBlob(data.blob_id as string);
    if (!blob) throw new ApiError(404, "not_found", "ページが見つかりません。");
    res.set({
      "Content-Type": blob.type,
      "Content-Length": String(blob.data.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(blob.data);
  } catch (error) {
    sendError(res, error);
  }
});

// ---------- 章（小説） ----------

content.get("/content/:id/chapters", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await readable(me, String(req.params.id), NOVEL_KINDS);
    const { data, error } = await sb.from("sa_content_chapters").select("position, title").eq("app_id", row.id).order("position");
    if (error) throw error;
    res.set("Cache-Control", "private, no-store");
    res.json({
      title: row.name,
      chapters: (data ?? []).map((c) => ({ index: Number(c.position), title: c.title as string }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

content.get("/content/:id/chapters/:index", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await readable(me, String(req.params.id), NOVEL_KINDS);
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw new ApiError(404, "not_found", "章が見つかりません。");
    const { data, error } = await sb.from("sa_content_chapters").select("title, body").eq("app_id", row.id).eq("position", index).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "not_found", "章が見つかりません。");
    res.set("Cache-Control", "private, no-store");
    res.json({ index, title: data.title, body: data.body, total: await chapterCount(row.id) });
  } catch (error) {
    sendError(res, error);
  }
});

async function chapterCount(appId: string): Promise<number> {
  const { count, error } = await sb.from("sa_content_chapters").select("position", { count: "exact", head: true }).eq("app_id", appId);
  if (error) throw error;
  return count ?? 0;
}
