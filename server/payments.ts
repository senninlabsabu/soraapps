// ポイントのやりとり（購入・拡張機能の中の支払い・作者への支払い）。
//
// 流れ：支払いの記録を作る（pending）→ 仙人アカウントのポイントを減らす（idempotency_key = sa-支払いID）
//       → 持たせる・完了にする → 作者への支払いを作って払う。
// 途中で止まっても、同じ支払いIDで押し直せば二重には払わない。確実に失敗したものだけ failed にする。
import { randomUUID } from "node:crypto";
import { sb } from "./supabase.js";
import { adjustPoints, DEFINITE_FAILURE, isLinked, NOT_LINKED_MESSAGE, SenninError, withLock } from "./sennin.js";
import type { AppRow } from "./appData.js";

type PaymentRow = { id: string; amount: number; status: "pending" | "completed" | "failed"; title: string | null };

// 支払いの記録を開く。同じ（未完了の）支払いがあればそれを使う
async function openPayment(args: {
  me: string;
  appId: string;
  kind: "purchase" | "charge" | "iap";
  amount: number;
  title: string;
  requestId: string | null;
}): Promise<PaymentRow> {
  let query = sb
    .from("sa_app_purchases")
    .select("id, amount, status, title")
    .eq("user_id", args.me)
    .eq("app_id", args.appId)
    .eq("kind", args.kind);
  query = args.requestId ? query.eq("request_id", args.requestId) : query.is("request_id", null).eq("status", "pending");
  const { data: found, error: findError } = await query.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (findError) throw findError;
  if (found) return found as PaymentRow;

  const id = randomUUID();
  const { error } = await sb.from("sa_app_purchases").insert({
    id,
    user_id: args.me,
    app_id: args.appId,
    kind: args.kind,
    amount: args.amount,
    title: args.title.slice(0, 40),
    request_id: args.requestId,
    status: "pending"
  });
  if (error) throw error;
  return { id, amount: args.amount, status: "pending", title: args.title };
}

async function markFailed(paymentId: string) {
  await sb.from("sa_app_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", paymentId);
}

// 仙人アカウントのポイントを減らす。確実に失敗したときは failed にして、画面へ理由を返す
async function debit(me: string, payment: PaymentRow, reason: string) {
  try {
    return await adjustPoints(me, {
      amount: -payment.amount,
      reason: reason.slice(0, 100),
      idempotencyKey: `sa-${payment.id}`
    });
  } catch (error) {
    if (error instanceof SenninError && DEFINITE_FAILURE.has(error.code)) await markFailed(payment.id);
    throw error;
  }
}

async function complete(paymentId: string, ledgerId: string | null) {
  const { error } = await sb
    .from("sa_app_purchases")
    .update({ status: "completed", sennin_ledger_id: ledgerId, updated_at: new Date().toISOString() })
    .eq("id", paymentId);
  if (error) throw error;
}

// ストアで無料のアプリを追加する（ポイントは動かない）
export async function addFreeApp(me: string, app: AppRow) {
  const { error } = await sb
    .from("sa_app_owned")
    .upsert({ user_id: me, app_id: app.id, purchase_id: null }, { onConflict: "user_id,app_id", ignoreDuplicates: true });
  if (error) throw error;
}

// ストアで有料のアプリを購入する
export async function purchaseApp(me: string, app: AppRow): Promise<{ replayed: boolean }> {
  return withLock(`pay:${me}`, async () => {
    if (app.creator_id === me) throw new SenninError("invalid", "自分の拡張機能は購入できません。");
    if (!(await isLinked(me))) throw new SenninError("not_linked", NOT_LINKED_MESSAGE);
    const { data: owned, error: ownedError } = await sb
      .from("sa_app_owned")
      .select("user_id")
      .eq("user_id", me)
      .eq("app_id", app.id)
      .maybeSingle();
    if (ownedError) throw ownedError;
    if (owned) throw new SenninError("owned", "すでに持っている拡張機能です。");

    const payment = await openPayment({ me, appId: app.id, kind: "purchase", amount: app.price, title: app.name, requestId: null });
    const result = await debit(me, payment, `soraapps：「${app.name}」を購入`);

    const { error: grantError } = await sb
      .from("sa_app_owned")
      .upsert({ user_id: me, app_id: app.id, purchase_id: payment.id }, { onConflict: "user_id,app_id", ignoreDuplicates: true });
    if (grantError) throw grantError;
    await complete(payment.id, result.ledgerId);
    await recordSale({ creatorId: app.creator_id, appId: app.id, purchaseId: payment.id, amount: payment.amount }).catch(
      (error) => console.error("[apps] 作者への支払いの記録に失敗（あとで再送されます）:", error)
    );
    return { replayed: result.replayed };
  });
}

// 拡張機能の中の支払い（利用者が確認画面で「払う」を押したときだけ、画面が取り次ぐ）
export async function chargeFromApp(
  me: string,
  app: AppRow,
  request: { amount: number; title: string; requestId: string }
): Promise<{ replayed: boolean; points: number | null }> {
  return withLock(`pay:${me}`, async () => {
    if (app.creator_id === me) throw new SenninError("invalid", "自分の拡張機能への支払いはできません。");
    if (!(await isLinked(me))) throw new SenninError("not_linked", NOT_LINKED_MESSAGE);

    const payment = await openPayment({
      me,
      appId: app.id,
      kind: "charge",
      amount: request.amount,
      title: request.title,
      requestId: request.requestId
    });
    if (payment.status === "completed") return { replayed: true, points: null };
    if (payment.status === "failed") {
      throw new SenninError("failed", "この支払いは失敗しています。新しい requestId で、もう一度お試しください。");
    }
    const result = await debit(me, payment, `soraapps：${app.name}（${request.title}）`);
    await complete(payment.id, result.ledgerId);
    await recordSale({ creatorId: app.creator_id, appId: app.id, purchaseId: payment.id, amount: payment.amount }).catch(
      (error) => console.error("[apps] 作者への支払いの記録に失敗（あとで再送されます）:", error)
    );
    return { replayed: result.replayed, points: result.points };
  });
}

// ---------- 作者への支払い ----------

// 支払いのたびに1件作る（purchase_id は一意。二重には作らない）。そのまま払おうとする（失敗しても支払いは成立している）
export async function recordSale(args: { creatorId: string; appId: string; purchaseId: string; amount: number }) {
  const { error } = await sb.from("sa_app_payouts").upsert(
    {
      creator_id: args.creatorId,
      app_id: args.appId,
      purchase_id: args.purchaseId,
      amount: args.amount,
      status: "pending"
    },
    { onConflict: "purchase_id", ignoreDuplicates: true }
  );
  if (error) throw error;
  const { data, error: findError } = await sb
    .from("sa_app_payouts")
    .select("id, status")
    .eq("purchase_id", args.purchaseId)
    .maybeSingle();
  if (findError) throw findError;
  if (data?.status === "pending") {
    await payOne(data.id as string).catch((error) => console.error("[apps] 作者への支払いに失敗（あとで再送されます）:", error));
  }
}

async function payOne(payoutId: string): Promise<void> {
  const { data, error } = await sb
    .from("sa_app_payouts")
    .select("id, creator_id, app_id, amount, status, attempts")
    .eq("id", payoutId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "pending") return;

  const { data: app } = await sb.from("sa_apps").select("name").eq("id", data.app_id as string).maybeSingle();
  const name = (app?.name as string | undefined) ?? "拡張機能";
  const attempts = Number(data.attempts) + 1;
  try {
    const result = await adjustPoints(data.creator_id as string, {
      amount: Number(data.amount),
      reason: `soraapps：「${name}」の売上`.slice(0, 100),
      idempotencyKey: `sa-pay-${payoutId}`
    });
    await sb
      .from("sa_app_payouts")
      .update({ status: "paid", attempts, last_error: null, sennin_ledger_id: result.ledgerId, updated_at: new Date().toISOString() })
      .eq("id", payoutId);
  } catch (error) {
    const message = error instanceof SenninError ? error.message : "支払いに失敗しました。";
    const giveUp = error instanceof SenninError && error.code === "invalid";
    await sb
      .from("sa_app_payouts")
      .update({
        status: giveUp ? "failed" : "pending",
        attempts,
        last_error: message.slice(0, 200),
        updated_at: new Date().toISOString()
      })
      .eq("id", payoutId);
    // 連携の切れ・権限の問題なら、同じ作者の残りも払えないので止める
    if (error instanceof SenninError && !giveUp) throw error;
  }
}

// 作者の保留中の支払いをまとめて払う（作者が画面を開いたとき・ログインしたとき）
export async function retryCreatorPayouts(creatorId: string): Promise<void> {
  await withLock(`payout:${creatorId}`, async () => {
    const { data, error } = await sb
      .from("sa_app_payouts")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    for (const row of data ?? []) {
      try {
        await payOne(row.id as string);
      } catch {
        break;
      }
    }
  });
}

// アプリ内課金：拡張機能の中で商品を買う（買い切り。同じ商品は二重に買えない）
export async function purchaseProduct(
  me: string,
  app: AppRow,
  sku: string
): Promise<{ replayed: boolean; points: number | null }> {
  return withLock(`pay:${me}`, async () => {
    if (app.creator_id === me) throw new SenninError("invalid", "自分の拡張機能の商品は購入できません。");
    if (!(await isLinked(me))) throw new SenninError("not_linked", NOT_LINKED_MESSAGE);

    const { data: owned, error: ownedError } = await sb
      .from("sa_app_entitlements")
      .select("sku")
      .eq("user_id", me)
      .eq("app_id", app.id)
      .eq("sku", sku)
      .maybeSingle();
    if (ownedError) throw ownedError;
    if (owned) return { replayed: true, points: null };

    const { data: product, error: productError } = await sb
      .from("sa_app_products")
      .select("title, price")
      .eq("app_id", app.id)
      .eq("sku", sku)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new SenninError("invalid", "この商品は見つかりません。");

    const payment = await openPayment({
      me,
      appId: app.id,
      kind: "iap",
      amount: Number(product.price),
      title: String(product.title),
      requestId: `iap:${sku}`
    });
    if (payment.status === "failed") {
      throw new SenninError("failed", "この商品の購入は失敗しています。時間をおいてもう一度お試しください。");
    }
    if (payment.status === "completed") return { replayed: true, points: null };

    const result = await debit(me, payment, `soraapps：${app.name}（${product.title}）`);
    await grantEntitlement(me, app.id, sku, payment.id);
    await complete(payment.id, result.ledgerId);
    await recordSale({ creatorId: app.creator_id, appId: app.id, purchaseId: payment.id, amount: payment.amount }).catch(
      (error) => console.error("[apps] 作者への支払いの記録に失敗（あとで再送されます）:", error)
    );
    return { replayed: result.replayed, points: result.points };
  });
}

async function grantEntitlement(me: string, appId: string, sku: string, purchaseId: string) {
  const { error } = await sb
    .from("sa_app_entitlements")
    .upsert({ user_id: me, app_id: appId, sku, purchase_id: purchaseId }, { onConflict: "user_id,app_id,sku", ignoreDuplicates: true });
  if (error) throw error;
}
