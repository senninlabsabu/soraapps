// 拡張機能の実行：隔離された文書の配信・許可・ポイント配布・支払い・データ保存。
//
// ・文書は CSP（sandbox・通信先の制限）つきで返す。枠は sandbox（allow-scripts のみ）で開くので、
//   ログイン情報（Cookie）・画面・localStorage には触れない。
// ・枠の中からサーバーへは直接届かない。window.sorachat の依頼は、soraapps の画面が確かめて、ここへ取り次ぐ。
// ・ユーザー情報を渡すのは、許可した人だけ。ポイントの配布・支払いは、許可と上限の中だけ。
import { Router } from "express";
import { currentUserId, requireAuth } from "./session.js";
import { sb } from "./supabase.js";
import { canRun, loadApp, UUID } from "./appData.js";
import { chargeFromApp, purchaseProduct } from "./payments.js";
import { adjustPoints, DEFINITE_FAILURE, isLinked, NOT_LINKED_MESSAGE, SenninError } from "./sennin.js";
import { ApiError, sendError } from "./errors.js";
import {
  BRIDGE,
  buildExtensionDocument,
  checkAwardRequest,
  checkChargeRequest,
  checkSku,
  checkStorageKey,
  checkStorageValue,
  EXTENSION_CSP,
  STORAGE_KEYS_MAX
} from "./rules.js";

export const run = Router();
run.use("/run/:id", requireAuth);

// 1人が1分間に配布を頼める回数（連打・暴走の防止）
const AWARD_PER_MINUTE = 60;
const awardHits = new Map<string, number[]>();
function awardAllowed(me: string): boolean {
  const now = Date.now();
  const recent = (awardHits.get(me) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= AWARD_PER_MINUTE) {
    awardHits.set(me, recent);
    return false;
  }
  recent.push(now);
  awardHits.set(me, recent);
  return true;
}

// 実行の対象を読み、実行してよいかを確かめる
async function runnable(req: { params: Record<string, string> }, me: string) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
  const row = await loadApp(id);
  if (!row || (row.status === "deleted" && row.creator_id !== me)) {
    throw new ApiError(404, "not_found", "拡張機能が見つかりません。");
  }
  if (!(await canRun(me, row))) throw new ApiError(403, "not_owned", "この拡張機能はまだ追加していません。");
  return row;
}

async function hasConsent(me: string, appId: string): Promise<boolean> {
  const { data, error } = await sb.from("sa_app_consents").select("user_id").eq("user_id", me).eq("app_id", appId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function requireConsent(me: string, appId: string) {
  if (!(await hasConsent(me, appId))) {
    throw new ApiError(403, "not_consented", "アカウント情報の許可がありません。先に許可してください。");
  }
}

// 文書（枠の中身）。CSP は応答ヘッダーで付ける
run.get("/run/:id/frame", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const { data, error } = await sb.from("sa_app_code").select("html, css, js").eq("app_id", row.id).maybeSingle();
    if (error) throw error;
    res.set({
      "Content-Security-Policy": EXTENSION_CSP,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    res.type("html").send(buildExtensionDocument(data ?? {}));
  } catch (error) {
    sendError(res, error);
  }
});

// 開いたときの状態（許可の有無・配布の残り）。許可していなければ、ユーザー情報は一切返さない
run.get("/run/:id/access", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const { data: grant, error } = await sb
      .from("sa_app_grants")
      .select("active, max_points, used_points")
      .eq("app_id", row.id)
      .maybeSingle();
    if (error) throw error;
    const active = Boolean(grant?.active);
    const consented = await hasConsent(me, row.id);
    const base = {
      ok: true,
      needsConsent: active,
      grant: active ? { remaining: Number(grant!.max_points) - Number(grant!.used_points) } : null
    };
    if (!consented) {
      res.json({ ...base, consented: false });
      return;
    }
    const { data: user } = await sb.from("sa_users").select("id, display_name").eq("id", me).maybeSingle();
    res.set("Cache-Control", "no-store");
    res.json({
      ...base,
      consented: true,
      sorachat: { id: user?.id, displayName: user?.display_name },
      sennin: { linked: await isLinked(me) }
    });
  } catch (error) {
    sendError(res, error);
  }
});

run.post("/run/:id/consent", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const { error } = await sb
      .from("sa_app_consents")
      .upsert({ user_id: me, app_id: row.id, granted_at: new Date().toISOString() }, { onConflict: "user_id,app_id", ignoreDuplicates: true });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

run.delete("/run/:id/consent", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const { error } = await sb.from("sa_app_consents").delete().eq("user_id", me).eq("app_id", row.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// ポイントの配布（管理者が有効にした拡張機能だけ。許可した本人にだけ、上限の中で配る）
run.post("/run/:id/award", async (req, res) => {
  try {
    const me = currentUserId(res);
    if (!awardAllowed(me)) throw new ApiError(429, "rate_limited", "配布の依頼が多すぎます。少し待ってからお試しください。");
    const request = checkAwardRequest(req.body);
    if (!request.ok) throw new ApiError(400, "invalid", request.error);
    const row = await runnable(req, me);
    await requireConsent(me, row.id);
    if (!(await isLinked(me))) throw new ApiError(403, "not_linked", NOT_LINKED_MESSAGE);

    const { data: grant, error: grantError } = await sb
      .from("sa_app_grants")
      .select("active, per_call_max")
      .eq("app_id", row.id)
      .maybeSingle();
    if (grantError) throw grantError;
    if (!grant?.active) throw new ApiError(403, "inactive", "この拡張機能は、ポイントを配る許可がありません。");
    const perCall = Number(grant.per_call_max ?? BRIDGE.awardPerCallDefault);
    if (request.amount > perCall) throw new ApiError(400, "per_call_limit", `1回に配れるのは ${perCall}pt までです。`);

    // 枠の確保（DB の関数で原子的に）。同じ requestId なら、今の状態を返す
    const { data, error } = await sb.rpc("sa_reserve_award", {
      p_user: me,
      p_app: row.id,
      p_request: request.requestId,
      p_points: request.amount,
      p_reason: request.reason
    });
    if (error) throw error;
    const reserved = (data ?? {}) as { result: string; id?: string; status?: string; points?: number; remaining?: number; limit?: number };

    if (reserved.result === "inactive") throw new ApiError(403, "inactive", "この拡張機能は、ポイントを配る許可がありません。");
    if (reserved.result === "exhausted") {
      const remaining = Number(reserved.remaining ?? 0);
      throw new ApiError(409, "exhausted", `この拡張機能が配れるポイントは、あと ${remaining}pt です。`, remaining);
    }
    if (reserved.result === "minute_exhausted") {
      const remaining = Math.max(0, Number(reserved.remaining ?? 0));
      throw new ApiError(429, "minute_limit", `1人が1分間に受け取れるのは ${reserved.limit}pt までです。あと ${remaining}pt です。`, remaining);
    }
    if (reserved.result === "exists" && reserved.status === "done") {
      res.json({ ok: true, awarded: Number(reserved.points), replayed: true, points: null });
      return;
    }
    if (reserved.result === "exists" && reserved.status === "failed") {
      throw new ApiError(409, "failed", "この配布は失敗しています。新しい requestId で、もう一度お試しください。");
    }

    // 枠は確保できた（または前回の確保が途中で止まったもの）。配布IDで加算するので、押し直しても二重にはならない
    const awardId = String(reserved.id);
    const points = Number(reserved.points);
    try {
      const result = await adjustPoints(me, {
        amount: points,
        reason: `「${row.name}」${request.reason ? `：${request.reason}` : ""}`.slice(0, 100),
        idempotencyKey: `sa-award-${awardId}`
      });
      const { error: settleError } = await sb.rpc("sa_settle_award", { p_award: awardId, p_status: "done" });
      if (settleError) throw settleError;
      res.json({ ok: true, awarded: points, replayed: result.replayed, points: result.points });
    } catch (error) {
      if (error instanceof SenninError && DEFINITE_FAILURE.has(error.code)) {
        // 確実に加算されなかった失敗だけ、枠を戻して失敗として閉じる
        await sb.rpc("sa_settle_award", { p_award: awardId, p_status: "failed" });
        const status = error.code === "scope" || error.code === "not_linked" ? 403 : error.code === "daily_limit" ? 429 : 409;
        throw new ApiError(status, error.code, error.message);
      }
      // 加算されたか分からない。枠は確保したままにし、同じ requestId で押し直せば確かめ直せる
      throw new ApiError(503, "unknown", "ポイントの配布結果を確かめられませんでした。同じ requestId で、もう一度お試しください。");
    }
  } catch (error) {
    sendError(res, error);
  }
});

// 拡張機能の中の支払い（画面の確認で「払う」を押したときだけ、画面が取り次ぐ）
run.post("/run/:id/charge", async (req, res) => {
  try {
    const me = currentUserId(res);
    const request = checkChargeRequest(req.body);
    if (!request.ok) throw new ApiError(400, "invalid", request.error);
    const row = await runnable(req, me);
    await requireConsent(me, row.id);
    const result = await chargeFromApp(me, row, request);
    res.json({ ok: true, replayed: result.replayed, points: result.points });
  } catch (error) {
    sendError(res, error);
  }
});

// データ保存（無料・仙人アカウントにひもづけ）
run.get("/run/:id/storage", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const { data, error } = await sb.from("sa_app_storage").select("key").eq("user_id", me).eq("app_id", row.id).order("key");
    if (error) throw error;
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, keys: (data ?? []).map((r) => r.key as string) });
  } catch (error) {
    sendError(res, error);
  }
});

run.get("/run/:id/storage/:key", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const key = String(req.params.key);
    const { data, error } = await sb
      .from("sa_app_storage")
      .select("value")
      .eq("user_id", me)
      .eq("app_id", row.id)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, value: data ? data.value : null });
  } catch (error) {
    sendError(res, error);
  }
});

run.put("/run/:id/storage/:key", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const key = String(req.params.key);
    const keyError = checkStorageKey(key);
    if (keyError) throw new ApiError(400, "invalid", keyError);
    const valueError = checkStorageValue(req.body?.value);
    if (valueError) throw new ApiError(400, "invalid", valueError);

    const { count, error: countError } = await sb
      .from("sa_app_storage")
      .select("key", { count: "exact", head: true })
      .eq("user_id", me)
      .eq("app_id", row.id);
    if (countError) throw countError;
    const { data: existing } = await sb
      .from("sa_app_storage")
      .select("key")
      .eq("user_id", me)
      .eq("app_id", row.id)
      .eq("key", key)
      .maybeSingle();
    if (!existing && (count ?? 0) >= STORAGE_KEYS_MAX) {
      throw new ApiError(409, "full", `保存できるキーは ${STORAGE_KEYS_MAX} 個までです。`);
    }

    const { error } = await sb.from("sa_app_storage").upsert(
      { user_id: me, app_id: row.id, key, value: req.body.value, updated_at: new Date().toISOString() },
      { onConflict: "user_id,app_id,key" }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

run.delete("/run/:id/storage/:key", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const { error } = await sb
      .from("sa_app_storage")
      .delete()
      .eq("user_id", me)
      .eq("app_id", row.id)
      .eq("key", String(req.params.key));
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// アプリ内課金：商品の一覧（持っているかどうか付き）
run.get("/run/:id/iap", async (req, res) => {
  try {
    const me = currentUserId(res);
    const row = await runnable(req, me);
    const [{ data: products, error }, { data: owned, error: ownedError }] = await Promise.all([
      sb.from("sa_app_products").select("sku, title, description, price").eq("app_id", row.id).order("position"),
      sb.from("sa_app_entitlements").select("sku").eq("user_id", me).eq("app_id", row.id)
    ]);
    if (error) throw error;
    if (ownedError) throw ownedError;
    const ownedSkus = new Set((owned ?? []).map((o) => o.sku as string));
    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      products: (products ?? []).map((p) => ({ ...p, owned: ownedSkus.has(p.sku as string) }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

// アプリ内課金：商品を買う（確認画面で利用者が「払う」を押したあとに、画面が取り次ぐ）
run.post("/run/:id/iap/purchase", async (req, res) => {
  try {
    const me = currentUserId(res);
    const skuError = checkSku(req.body?.sku);
    if (skuError) throw new ApiError(400, "invalid", skuError);
    const row = await runnable(req, me);
    const result = await purchaseProduct(me, row, String(req.body.sku));
    res.json({ ok: true, replayed: result.replayed, points: result.points });
  } catch (error) {
    sendError(res, error);
  }
});
