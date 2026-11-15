// 手渡しグッズの注文（エスクロー）・取引のDM・ウォレット。
//
// 流れ：
//  1. 注文：在庫を1つ確保し、代金を預かる（pending_payment → 支払いが済んだら open）。作者へはまだ入金しない。
//  2. DM：購入者と出品者が、受け渡しの日時・場所を相談する（当事者だけが読み書きできる）。
//  3. 確認：購入者は「受け取りました」、出品者は「渡しました」を押す。両方そろった時だけ完了（作者へ入金）。
//  4. キャンセル：どちらかが確認を押すまでは、どちらからでもキャンセルできる（預かった代金は買った人へ返す）。
//
// 同じ操作を押し直しても二重には動かない（注文番号・冪等キー・条件つきの更新で守る）。
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { currentUserId, requireAuth } from "./session.js";
import { sb } from "./supabase.js";
import { AppRow, loadApp, UUID } from "./appData.js";
import { DEFINITE_FAILURE, fetchBalance, isLinked, NOT_LINKED_MESSAGE, SenninError, withLock } from "./sennin.js";
import { payForOrder, recordSale, refundOrder } from "./payments.js";
import { ApiError, sendError } from "./errors.js";
import { checkOrderMessage, checkOrderRequest, KIND_LABEL, ORDER_MESSAGES_PER_MINUTE, STOCK_MAX, type Kind } from "./rules.js";

export const orders = Router();

export type OrderStatus = "pending_payment" | "open" | "completed" | "cancelled";
export type OrderRow = {
  id: string;
  request_id: string;
  app_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: OrderStatus;
  purchase_id: string | null;
  paid_at: string | null;
  buyer_received_at: string | null;
  seller_handed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: "buyer" | "seller" | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

const ORDER_COLUMNS =
  "id, request_id, app_id, buyer_id, seller_id, amount, status, purchase_id, paid_at, buyer_received_at, seller_handed_at, completed_at, cancelled_at, cancelled_by, refunded_at, created_at, updated_at";
const now = () => new Date().toISOString();

async function findOrder(id: string): Promise<OrderRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await sb.from("sa_orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as OrderRow | null) ?? null;
}

async function findByRequest(buyerId: string, requestId: string): Promise<OrderRow | null> {
  const { data, error } = await sb.from("sa_orders").select(ORDER_COLUMNS).eq("buyer_id", buyerId).eq("request_id", requestId).maybeSingle();
  if (error) throw error;
  return (data as OrderRow | null) ?? null;
}

// 当事者（購入者・出品者）以外には、取引は存在しないものとして返す
async function partyOrder(me: string, id: string): Promise<OrderRow> {
  const order = await findOrder(id);
  if (!order || (order.buyer_id !== me && order.seller_id !== me)) throw new ApiError(404, "not_found", "取引が見つかりません。");
  return order;
}

const roleOf = (order: OrderRow, me: string): "buyer" | "seller" => (order.buyer_id === me ? "buyer" : "seller");

async function nameOf(userId: string): Promise<string> {
  const { data, error } = await sb.from("sa_users").select("display_name").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data?.display_name as string | undefined) ?? "利用者";
}

// 在庫を1つ戻す（キャンセルのとき）。在庫の上限は超えない
async function restoreStock(appId: string) {
  await withLock(`order:${appId}`, async () => {
    const { data, error } = await sb.from("sa_apps").select("stock").eq("id", appId).maybeSingle();
    if (error) throw error;
    if (!data) return;
    const { error: upError } = await sb
      .from("sa_apps")
      .update({ stock: Math.min(Number(data.stock) + 1, STOCK_MAX) })
      .eq("id", appId);
    if (upError) throw upError;
  });
}

// 注文を作る（在庫を1つ確保）。同じ注文番号なら、今の注文を返す（押し直しても二重には確保しない）
async function createOrder(me: string, app: AppRow, requestId: string): Promise<OrderRow> {
  const existing = await findByRequest(me, requestId);
  if (existing) return existing;
  return withLock(`order:${app.id}`, async () => {
    const again = await findByRequest(me, requestId);
    if (again) return again;
    const { data: fresh, error } = await sb.from("sa_apps").select("stock, price, status").eq("id", app.id).maybeSingle();
    if (error) throw error;
    if (!fresh || fresh.status !== "published") throw new ApiError(404, "not_found", "商品が見つかりません。");
    const stock = Number(fresh.stock);
    if (stock < 1) throw new ApiError(409, "sold_out", "売り切れです。");

    const { error: stockError } = await sb.from("sa_apps").update({ stock: stock - 1 }).eq("id", app.id);
    if (stockError) throw stockError;
    const { data, error: insertError } = await sb
      .from("sa_orders")
      .insert({
        id: randomUUID(),
        request_id: requestId,
        app_id: app.id,
        buyer_id: me,
        seller_id: app.creator_id,
        amount: Number(fresh.price),
        status: "pending_payment"
      })
      .select(ORDER_COLUMNS)
      .single();
    if (insertError) {
      // 注文が作れなかったので、確保した在庫を戻す
      await sb.from("sa_apps").update({ stock }).eq("id", app.id);
      throw insertError;
    }
    return data as OrderRow;
  });
}

// 支払いが確実に失敗したとき：注文を取り消し、在庫を戻す（代金は引かれていない）
async function failPendingOrder(order: OrderRow) {
  const { data, error } = await sb
    .from("sa_orders")
    .update({ status: "cancelled", cancelled_at: now(), cancelled_by: "buyer", updated_at: now() })
    .eq("id", order.id)
    .eq("status", "pending_payment")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (data) await restoreStock(order.app_id);
}

// 代金を預かる（pending_payment → open）。途中で止まっても、同じ注文番号で押し直せば続きから行う
async function payOrder(me: string, app: AppRow, order: OrderRow): Promise<OrderRow> {
  if (order.status === "open" || order.status === "completed") return order;
  if (order.status === "cancelled") {
    throw new ApiError(409, "cancelled", "この注文はキャンセルされています。もう一度、ストアから注文してください。");
  }
  try {
    const paid = await payForOrder(me, app, { id: order.id, amount: order.amount });
    const { data, error } = await sb
      .from("sa_orders")
      .update({ status: "open", purchase_id: paid.purchaseId, paid_at: now(), updated_at: now() })
      .eq("id", order.id)
      .eq("status", "pending_payment")
      .select(ORDER_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as OrderRow | null) ?? ((await findOrder(order.id)) as OrderRow);
  } catch (error) {
    if (error instanceof SenninError && (DEFINITE_FAILURE.has(error.code) || error.code === "failed")) {
      await failPendingOrder(order);
    }
    throw error;
  }
}

// 両者が受け取り済みにしたら完了にして、作者へ入金する（完了の更新は一度だけ行われる）
async function completeOrder(order: OrderRow) {
  const { data, error } = await sb
    .from("sa_orders")
    .update({ status: "completed", completed_at: now(), updated_at: now() })
    .eq("id", order.id)
    .eq("status", "open")
    .not("buyer_received_at", "is", null)
    .not("seller_handed_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data || !order.purchase_id) return;
  await recordSale({ creatorId: order.seller_id, appId: order.app_id, purchaseId: order.purchase_id, amount: order.amount }).catch(
    (e) => console.error("[apps] 作者への入金の記録に失敗（あとで再送されます）:", e)
  );
}

// 預かった代金を買った人へ返す（返金の記録は、返金のあとに書く。失敗しても、押し直せば二重には返さない）
async function refundIfNeeded(order: OrderRow) {
  if (!order.paid_at || order.refunded_at) return;
  const app = await loadApp(order.app_id);
  await refundOrder(order.buyer_id, order.id, order.amount, app?.name ?? "商品");
  const { error } = await sb.from("sa_orders").update({ refunded_at: now(), updated_at: now() }).eq("id", order.id).is("refunded_at", null);
  if (error) throw error;
}

// ---------- 注文 ----------

// 手渡しグッズを注文する（代金を預かる）
orders.post("/store/apps/:id/order", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const app = await loadApp(String(req.params.id));
    if (!app || app.status !== "published") throw new ApiError(404, "not_found", "商品が見つかりません。");
    if (app.kind !== "goods") throw new ApiError(400, "invalid", "この商品は手渡しではありません。「追加」か「購入」から進めてください。");
    if (app.creator_id === me) throw new ApiError(400, "own", "自分の商品は注文できません。");
    const parsed = checkOrderRequest(req.body);
    if (!parsed.ok) throw new ApiError(400, "invalid", parsed.error);
    if (!(await isLinked(me))) throw new SenninError("not_linked", NOT_LINKED_MESSAGE);

    const created = await createOrder(me, app, parsed.requestId);
    const order = await payOrder(me, app, created);
    res.status(201).json({ ok: true, orderId: order.id, status: order.status });
  } catch (error) {
    sendError(res, error);
  }
});

// 自分の取引の一覧（買った注文・売った注文）
orders.get("/orders", requireAuth, async (_req, res) => {
  try {
    const me = currentUserId(res);
    const [asBuyer, asSeller] = await Promise.all([
      sb.from("sa_orders").select(ORDER_COLUMNS).eq("buyer_id", me).order("created_at", { ascending: false }).limit(100),
      sb.from("sa_orders").select(ORDER_COLUMNS).eq("seller_id", me).order("created_at", { ascending: false }).limit(100)
    ]);
    if (asBuyer.error) throw asBuyer.error;
    if (asSeller.error) throw asSeller.error;
    const rows = [...(asBuyer.data ?? []), ...(asSeller.data ?? [])] as unknown as OrderRow[];
    const unique = [...new Map(rows.map((r) => [r.id, r])).values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100);

    const appIds = [...new Set(unique.map((o) => o.app_id))];
    const userIds = [...new Set(unique.flatMap((o) => [o.buyer_id, o.seller_id]))];
    const [apps, users] = await Promise.all([
      appIds.length ? sb.from("sa_apps").select("id, name, thumb_url").in("id", appIds) : Promise.resolve({ data: [], error: null }),
      userIds.length ? sb.from("sa_users").select("id, display_name").in("id", userIds) : Promise.resolve({ data: [], error: null })
    ]);
    if (apps.error) throw apps.error;
    if (users.error) throw users.error;
    const appById = new Map((apps.data ?? []).map((a: any) => [a.id as string, a]));
    const nameById = new Map((users.data ?? []).map((u: any) => [u.id as string, u.display_name as string]));

    res.set("Cache-Control", "no-store");
    res.json({
      orders: unique.map((o) => {
        const app = appById.get(o.app_id) as { name: string; thumb_url: string | null } | undefined;
        const role = roleOf(o, me);
        return {
          id: o.id,
          role,
          status: o.status,
          amount: o.amount,
          appName: app?.name ?? "商品",
          thumbUrl: app?.thumb_url ?? null,
          counterpartName: nameById.get(role === "buyer" ? o.seller_id : o.buyer_id) ?? "相手",
          createdAt: o.created_at,
          updatedAt: o.updated_at
        };
      })
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 取引の詳細（状態・確認・DM）。当事者だけが見られる
orders.get("/orders/:id", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const order = await partyOrder(me, String(req.params.id));
    const role = roleOf(order, me);
    const [app, counterpartName, messages] = await Promise.all([
      loadApp(order.app_id),
      nameOf(role === "buyer" ? order.seller_id : order.buyer_id),
      sb
        .from("sa_order_messages")
        .select("id, sender_id, body, created_at, sender:sa_users!sender_id(display_name)")
        .eq("order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(300)
    ]);
    if (messages.error) throw messages.error;

    const open = order.status === "open";
    const myConfirmed = Boolean(role === "buyer" ? order.buyer_received_at : order.seller_handed_at);
    const anyConfirmed = Boolean(order.buyer_received_at || order.seller_handed_at);
    res.set("Cache-Control", "no-store");
    res.json({
      order: {
        id: order.id,
        role,
        status: order.status,
        amount: order.amount,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        paidAt: order.paid_at,
        buyerConfirmed: Boolean(order.buyer_received_at),
        sellerConfirmed: Boolean(order.seller_handed_at),
        myConfirmed,
        completedAt: order.completed_at,
        cancelledAt: order.cancelled_at,
        cancelledBy: order.cancelled_by,
        refunded: Boolean(order.refunded_at)
      },
      app: app
        ? {
            id: app.id,
            name: app.name,
            thumbUrl: app.thumb_url,
            kind: app.kind as Kind,
            kindLabel: KIND_LABEL[app.kind as Kind],
            handoverNote: app.handover_note,
            appStatus: app.status
          }
        : null,
      counterpartName,
      messages: ((messages.data ?? []) as any[]).reverse().map((m) => ({
        id: m.id,
        mine: m.sender_id === me,
        body: m.body,
        createdAt: m.created_at,
        authorName: m.sender?.display_name ?? "利用者"
      })),
      canConfirm: open && !myConfirmed,
      canCancel: (open && !anyConfirmed) || (order.status === "cancelled" && Boolean(order.paid_at) && !order.refunded_at),
      canMessage: open
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 受け取り・受け渡しの確認（購入者は「受け取りました」、出品者は「渡しました」）
orders.post("/orders/:id/confirm", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const order = await partyOrder(me, String(req.params.id));
    if (order.status !== "open") {
      const message =
        order.status === "completed"
          ? "この取引は完了しています。"
          : order.status === "cancelled"
            ? "この取引はキャンセルされています。"
            : "支払いを確認しています。少し待ってから、もう一度お試しください。";
      throw new ApiError(409, "closed", message);
    }
    const column = roleOf(order, me) === "buyer" ? "buyer_received_at" : "seller_handed_at";
    if (!order[column]) {
      const { error } = await sb.from("sa_orders").update({ [column]: now(), updated_at: now() }).eq("id", order.id).eq("status", "open").is(column, null);
      if (error) throw error;
    }
    const fresh = (await findOrder(order.id)) as OrderRow;
    if (fresh.status === "open" && fresh.buyer_received_at && fresh.seller_handed_at) {
      await completeOrder(fresh);
    }
    const after = (await findOrder(order.id)) as OrderRow;
    res.json({ ok: true, status: after.status });
  } catch (error) {
    sendError(res, error);
  }
});

// キャンセル（どちらかが確認を押すまで。預かった代金は買った人へ返す）。返金が途中で止まったときは、押し直せば続きを行う
orders.post("/orders/:id/cancel", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    let order = await partyOrder(me, String(req.params.id));
    const role = roleOf(order, me);
    if (order.status === "pending_payment") throw new ApiError(409, "pending", "支払いを確認しています。少し待ってから、もう一度お試しください。");
    if (order.status === "completed") throw new ApiError(409, "completed", "受け渡しが完了しているため、キャンセルできません。");

    if (order.status === "open") {
      if (order.buyer_received_at || order.seller_handed_at) {
        throw new ApiError(409, "confirmed", "受け取り・受け渡しの確認が済んでいるため、キャンセルできません。");
      }
      const { data, error } = await sb
        .from("sa_orders")
        .update({ status: "cancelled", cancelled_at: now(), cancelled_by: role, updated_at: now() })
        .eq("id", order.id)
        .eq("status", "open")
        .is("buyer_received_at", null)
        .is("seller_handed_at", null)
        .select(ORDER_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError(409, "changed", "状態が変わったため、キャンセルできませんでした。画面を開き直してください。");
      await restoreStock(order.app_id);
      order = (await findOrder(order.id)) as OrderRow;
    }

    await refundIfNeeded(order);
    res.json({ ok: true, status: "cancelled", refunded: true });
  } catch (error) {
    sendError(res, error);
  }
});

// メッセージ（DM）。取引が続いている間だけ送れる。読むのは当事者だけ
orders.post("/orders/:id/messages", requireAuth, async (req, res) => {
  try {
    const me = currentUserId(res);
    const order = await partyOrder(me, String(req.params.id));
    if (order.status !== "open") throw new ApiError(409, "closed", "この取引は終わっているため、メッセージは送れません。");
    const parsed = checkOrderMessage((req.body ?? {}).body);
    if (!parsed.ok) throw new ApiError(400, "invalid", parsed.error);

    const { count, error: countError } = await sb
      .from("sa_order_messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", me)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if (countError) throw countError;
    if ((count ?? 0) >= ORDER_MESSAGES_PER_MINUTE) {
      throw new ApiError(429, "rate", "メッセージが続けて送られています。少し待ってからお送りください。");
    }

    const id = randomUUID();
    const { data, error } = await sb
      .from("sa_order_messages")
      .insert({ id, order_id: order.id, sender_id: me, body: parsed.body })
      .select("created_at")
      .single();
    if (error) throw error;
    res.status(201).json({ ok: true, message: { id, mine: true, body: parsed.body, createdAt: data.created_at, authorName: "" } });
  } catch (error) {
    sendError(res, error);
  }
});

// ---------- ウォレット（残高・預かり中・明細） ----------

orders.get("/wallet", requireAuth, async (_req, res) => {
  try {
    const me = currentUserId(res);
    const linked = await isLinked(me);
    const points = linked ? await fetchBalance(me).catch(() => null) : null;

    const [purchases, refunds, sales, holds, incoming] = await Promise.all([
      sb.from("sa_app_purchases").select("id, kind, amount, title, created_at").eq("user_id", me).eq("status", "completed").order("created_at", { ascending: false }).limit(50),
      sb.from("sa_orders").select("id, amount, refunded_at, app:sa_apps!app_id(name)").eq("buyer_id", me).not("refunded_at", "is", null).order("refunded_at", { ascending: false }).limit(50),
      sb.from("sa_app_payouts").select("id, amount, created_at, app:sa_apps!app_id(name)").eq("creator_id", me).eq("status", "paid").order("created_at", { ascending: false }).limit(50),
      sb.from("sa_orders").select("amount").eq("buyer_id", me).eq("status", "open"),
      sb.from("sa_orders").select("amount").eq("seller_id", me).eq("status", "open")
    ]);
    for (const r of [purchases, refunds, sales, holds, incoming]) if (r.error) throw r.error;

    const kindText: Record<string, string> = { purchase: "購入", charge: "支払い", iap: "アプリ内で購入", order: "手渡しで注文" };
    const activity = [
      ...(purchases.data ?? []).map((p: any) => ({
        id: `p-${p.id}`,
        type: "payment" as const,
        title: `${p.title}（${kindText[p.kind] ?? "支払い"}）`,
        amount: -Number(p.amount),
        at: p.created_at as string
      })),
      ...(refunds.data ?? []).map((o: any) => ({
        id: `r-${o.id}`,
        type: "refund" as const,
        title: `${o.app?.name ?? "注文"}（返金）`,
        amount: Number(o.amount),
        at: o.refunded_at as string
      })),
      ...(sales.data ?? []).map((s: any) => ({
        id: `s-${s.id}`,
        type: "sale" as const,
        title: `${s.app?.name ?? "作品"}の売上`,
        amount: Number(s.amount),
        at: s.created_at as string
      }))
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 60);

    const sum = (rows: { amount: number | string }[] | null) => (rows ?? []).reduce((total, r) => total + Number(r.amount), 0);
    res.set("Cache-Control", "no-store");
    res.json({
      linked,
      points,
      holdAsBuyer: sum(holds.data as { amount: number }[]),
      receivableAsSeller: sum(incoming.data as { amount: number }[]),
      activity
    });
  } catch (error) {
    sendError(res, error);
  }
});
