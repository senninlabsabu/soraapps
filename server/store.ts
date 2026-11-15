// ストア（一覧・詳細・レビュー・通報・追加と購入・マイアプリ・作者のページ）。
// 一覧と詳細は、ログインしていなくても見られる。追加・購入・レビュー・通報はログインが必要。
import { Router } from "express";
import { z } from "zod";
import { maybeUserId, currentUserId, optionalAuth, requireAuth } from "./session.js";
import { sb } from "./supabase.js";
import { APP_COLUMNS, AppRow, canSeeApp, loadApp, toCards, UUID } from "./appData.js";
import { imageUrl } from "./images.js";
import { addFreeApp, purchaseApp } from "./payments.js";
import { fetchBalance, isLinked, NOT_LINKED_MESSAGE } from "./sennin.js";
import { ApiError, sendError } from "./errors.js";
import { CATEGORIES, checkText, isKind, REPORT_HIDE_THRESHOLD } from "./rules.js";

export const store = Router();

const SORTS = ["new", "rating", "users"] as const;

// 一覧（公開中のアプリだけ）。カテゴリ・検索・並び順で絞る
store.get("/store/apps", optionalAuth, async (req, res) => {
  const me = maybeUserId(res);
  const category = typeof req.query.category === "string" ? req.query.category : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const sort = (SORTS as readonly string[]).includes(String(req.query.sort)) ? String(req.query.sort) : "new";

  const { data, error } = await sb
    .from("sa_apps")
    .select(APP_COLUMNS)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  let rows = (data ?? []) as AppRow[];
  const kind = typeof req.query.kind === "string" ? req.query.kind : "";
  if (isKind(kind)) rows = rows.filter((r) => r.kind === kind);
  if ((CATEGORIES as readonly string[]).includes(category)) rows = rows.filter((r) => r.category === category);
  if (q) rows = rows.filter((r) => `${r.name} ${r.description} ${r.creator?.display_name ?? ""}`.toLowerCase().includes(q));

  const cards = await toCards(rows, me);
  if (sort === "rating") cards.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
  if (sort === "users") cards.sort((a, b) => b.users - a.users);
  res.set("Cache-Control", "no-store");
  res.json({ apps: cards });
});

// 詳細（レビューつき）
store.get("/store/apps/:id", optionalAuth, async (req, res) => {
  const me = maybeUserId(res);
  const row = await loadApp(String(req.params.id));
  if (!row || !canSeeApp(row, me)) {
    res.status(404).json({ ok: false, error: "拡張機能が見つかりません。" });
    return;
  }
  const [card] = await toCards([row], me);
  const { data: reviews, error } = await sb
    .from("sa_app_reviews")
    .select("user_id, rating, comment, created_at, updated_at, user:sa_users!user_id(display_name)")
    .eq("app_id", row.id)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const list = (reviews ?? []).map((r: any) => ({
    mine: Boolean(me && r.user_id === me),
    rating: Number(r.rating),
    comment: r.comment as string,
    authorName: (r.user?.display_name as string | undefined) ?? "利用者",
    updatedAt: r.updated_at as string
  }));
  // 商品紹介画像・アプリ内課金の商品（持っているかどうか付き）
  // マンガ・画像のページ数、小説の章の一覧（見出しだけ。本文は買った人だけが読む）
  const [{ data: chapterRows }, { count: pageCount }] = await Promise.all([
    sb.from("sa_content_chapters").select("title").eq("app_id", row.id).order("position"),
    sb.from("sa_content_pages").select("position", { count: "exact", head: true }).eq("app_id", row.id)
  ]);
  const [{ data: images }, { data: products }, { data: owned }] = await Promise.all([
    sb.from("sa_app_images").select("blob_id, position").eq("app_id", row.id).order("position"),
    sb.from("sa_app_products").select("sku, title, description, price").eq("app_id", row.id).order("position"),
    me
      ? sb.from("sa_app_entitlements").select("sku").eq("user_id", me).eq("app_id", row.id)
      : Promise.resolve({ data: [] as { sku: string }[] })
  ]);
  const ownedSkus = new Set((owned ?? []).map((o) => o.sku as string));

  res.set("Cache-Control", "no-store");
  res.json({
    app: card,
    images: (images ?? []).map((i) => imageUrl(i.blob_id as string)),
    products: (products ?? []).map((p) => ({ ...p, owned: ownedSkus.has(p.sku as string) })),
    contents: {
      pageCount: pageCount ?? 0,
      chapters: (chapterRows ?? []).map((c, i) => ({ index: i, title: c.title as string }))
    },
    isCreator: Boolean(me && row.creator_id === me),
    reviews: list,
    myReview: list.find((r) => r.mine) ?? null,
    canReview: Boolean(me && row.creator_id !== me && card.owned && row.status === "published")
  });
});

// おすすめ（ホームの先頭）。公開中のアプリだけ出す
store.get("/store/featured", optionalAuth, async (_req, res) => {
  try {
    const me = maybeUserId(res);
    const { data: rows, error } = await sb
      .from("sa_featured")
      .select("id, app_id, blob_id, promo_text, position")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    const list = rows ?? [];
    const { data: apps, error: appsError } = list.length
      ? await sb.from("sa_apps").select(APP_COLUMNS).in("id", list.map((r) => r.app_id as string)).eq("status", "published")
      : { data: [], error: null };
    if (appsError) throw appsError;
    const cards = await toCards((apps ?? []) as AppRow[], me);
    const byId = new Map(cards.map((c) => [c.id, c]));
    res.set("Cache-Control", "no-store");
    res.json({
      items: list
        .filter((r) => byId.has(r.app_id as string))
        .map((r) => ({
          id: r.id,
          imageUrl: imageUrl(r.blob_id as string),
          promoText: r.promo_text,
          app: byId.get(r.app_id as string)
        }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 作者のページ：その作者の公開中のアプリ
store.get("/store/authors/:id", optionalAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!UUID.test(id)) {
    res.status(404).json({ ok: false, error: "作者が見つかりません。" });
    return;
  }
  const me = maybeUserId(res);
  const { data: user } = await sb.from("sa_users").select("id, display_name").eq("id", id).maybeSingle();
  if (!user) {
    res.status(404).json({ ok: false, error: "作者が見つかりません。" });
    return;
  }
  const { data, error } = await sb
    .from("sa_apps")
    .select(APP_COLUMNS)
    .eq("creator_id", id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  res.json({ author: { id, name: user.display_name }, apps: await toCards((data ?? []) as AppRow[], me) });
});

// 追加する（無料は即座に持てる。有料はポイントで購入する）
store.post("/store/apps/:id/add", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await loadApp(String(req.params.id));
    if (!row || row.status !== "published") throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    if (row.creator_id === me) throw new ApiError(400, "own", "自分の拡張機能は追加できません。実行は「マイアプリ」から。");
    if (row.kind === "goods") throw new ApiError(400, "invalid", "手渡しの商品は「注文する」から注文してください。");
    if (row.price === 0) {
      const { data: owned } = await sb.from("sa_app_owned").select("user_id").eq("user_id", me).eq("app_id", row.id).maybeSingle();
      if (owned) throw new ApiError(409, "owned", "すでに持っています。");
      await addFreeApp(me, row);
      res.json({ ok: true, replayed: false, price: 0 });
      return;
    }
    const result = await purchaseApp(me, row);
    res.json({ ok: true, replayed: result.replayed, price: row.price });
  } catch (error) {
    sendError(res, error);
  }
});

// レビュー（買った人だけ。1人1件。作者本人は付けられない）
const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).default("")
});

store.post("/store/apps/:id/review", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await loadApp(String(req.params.id));
    if (!row || row.status !== "published") throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    if (row.creator_id === me) throw new ApiError(400, "own", "作者は自分の拡張機能にレビューを付けられません。");
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "invalid", "星は1〜5、コメントは1000文字以内で入力してください。");
    const comment = parsed.data.comment.trim();
    const textError = checkText(comment, "コメント");
    if (textError) throw new ApiError(400, "text", textError);
    const { data: owned } = await sb.from("sa_app_owned").select("user_id").eq("user_id", me).eq("app_id", row.id).maybeSingle();
    if (!owned) throw new ApiError(403, "not_owned", "レビューは、この拡張機能を追加した人だけが付けられます。");

    const { error } = await sb.from("sa_app_reviews").upsert(
      { app_id: row.id, user_id: me, rating: parsed.data.rating, comment, updated_at: new Date().toISOString() },
      { onConflict: "app_id,user_id" }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

store.delete("/store/apps/:id/review", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    const { error } = await sb.from("sa_app_reviews").delete().eq("app_id", id).eq("user_id", me);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// 通報（1人1回）。通報が一定数たまると自動で非公開になる
store.post("/store/apps/:id/report", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await loadApp(String(req.params.id));
    if (!row || row.status !== "published") throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
    if (row.creator_id === me) throw new ApiError(400, "own", "自分の拡張機能は通報できません。");
    const { error } = await sb
      .from("sa_app_reports")
      .upsert({ app_id: row.id, user_id: me }, { onConflict: "app_id,user_id", ignoreDuplicates: true });
    if (error) throw error;
    const { count, error: countError } = await sb
      .from("sa_app_reports")
      .select("app_id", { count: "exact", head: true })
      .eq("app_id", row.id);
    if (countError) throw countError;
    let hidden = false;
    if ((count ?? 0) >= REPORT_HIDE_THRESHOLD) {
      await sb
        .from("sa_apps")
        .update({ status: "hidden", hidden_reason: "通報が多いため、自動で非公開になりました。" })
        .eq("id", row.id)
        .eq("status", "published");
      hidden = true;
    }
    res.json({ ok: true, hidden });
  } catch (error) {
    sendError(res, error);
  }
});

// マイアプリ（持っているもの）
store.get("/library", requireAuth, async (_req, res) => {
  try {
    const me = currentUserId(res);
    const { data: owned, error } = await sb.from("sa_app_owned").select("app_id, created_at").eq("user_id", me);
    if (error) throw error;
    const ids = (owned ?? []).map((o) => o.app_id as string);
    if (!ids.length) {
      res.json({ apps: [] });
      return;
    }
    const { data, error: appsError } = await sb.from("sa_apps").select(APP_COLUMNS).in("id", ids);
    if (appsError) throw appsError;
    const rows = ((data ?? []) as AppRow[]).filter((r) => r.status !== "hidden" || r.creator_id === me);
    const cards = await toCards(rows, me);
    res.json({ apps: cards.sort((a, b) => (a.name < b.name ? -1 : 1)) });
  } catch (error) {
    sendError(res, error);
  }
});

// ポイント残高（仙人アカウントから読む）
store.get("/balance", requireAuth, async (_req, res) => {
  try {
    const me = currentUserId(res);
    if (!(await isLinked(me))) {
      res.json({ ok: true, linked: false, points: null, message: NOT_LINKED_MESSAGE });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, linked: true, points: await fetchBalance(me) });
  } catch (error) {
    sendError(res, error);
  }
});
