// アプリ（拡張機能）の読み込みと、一覧に出す値の集計（評価・購入者数・持っているかどうか）。
import { sb } from "./supabase.js";
import { CATEGORY_LABEL, KIND_LABEL, type Category, type Kind } from "./rules.js";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// コード（html/css/js）は含めない。コードは作者と買った人だけが、別の API で読む
export const APP_COLUMNS =
  "id, creator_id, name, description, category, kind, price, stock, handover_note, status, hidden_reason, thumb_url, created_at, edited_at, creator:sa_users!creator_id(display_name)";

export type AppRow = {
  id: string;
  creator_id: string;
  name: string;
  description: string;
  category: Category;
  kind: Kind;
  price: number;
  stock: number;
  handover_note: string;
  status: "published" | "hidden" | "deleted";
  hidden_reason: string | null;
  thumb_url: string | null;
  created_at: string;
  edited_at: string | null;
  creator: { display_name: string } | null;
};

export async function loadApp(id: string): Promise<AppRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await sb.from("sa_apps").select(APP_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as AppRow | null) ?? null;
}

export async function isOwned(userId: string, appId: string): Promise<boolean> {
  const { data, error } = await sb.from("sa_app_owned").select("user_id").eq("user_id", userId).eq("app_id", appId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// 作者本人だけが、非公開・削除済みのアプリも見られる
export function canSeeApp(row: AppRow, me: string | null): boolean {
  if (me && row.creator_id === me) return true;
  return row.status === "published";
}

// 実行できるか：作者は常に可。買った人は、非公開でなければ可（削除済みでも、買った人は引き続き使える）
export async function canRun(me: string, row: AppRow): Promise<boolean> {
  if (row.creator_id === me) return true;
  if (row.status === "hidden") return false;
  return isOwned(me, row.id);
}

export type Card = {
  id: string;
  name: string;
  description: string;
  category: Category;
  categoryLabel: string;
  kind: Kind;
  kindLabel: string;
  stock: number;
  handoverNote: string;
  price: number;
  creatorId: string;
  creatorName: string;
  thumbUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  users: number;
  owned: boolean;
  status: AppRow["status"];
  hiddenReason: string | null;
  createdAt: string;
  editedAt: string | null;
};

// 一覧の行に、評価・購入者数・自分が持っているかを足す
export async function toCards(rows: AppRow[], me: string | null): Promise<Card[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [reviews, owned] = await Promise.all([
    sb.from("sa_app_reviews").select("app_id, rating").in("app_id", ids),
    sb.from("sa_app_owned").select("app_id, user_id").in("app_id", ids)
  ]);
  if (reviews.error) throw reviews.error;
  if (owned.error) throw owned.error;

  const ratings = new Map<string, { sum: number; count: number }>();
  for (const r of reviews.data ?? []) {
    const cur = ratings.get(r.app_id as string) ?? { sum: 0, count: 0 };
    cur.sum += Number(r.rating);
    cur.count += 1;
    ratings.set(r.app_id as string, cur);
  }
  const users = new Map<string, number>();
  const mine = new Set<string>();
  for (const o of owned.data ?? []) {
    users.set(o.app_id as string, (users.get(o.app_id as string) ?? 0) + 1);
    if (me && o.user_id === me) mine.add(o.app_id as string);
  }

  return rows.map((row) => {
    const rating = ratings.get(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      categoryLabel: CATEGORY_LABEL[row.category],
      kind: row.kind,
      kindLabel: KIND_LABEL[row.kind],
      stock: row.stock,
      handoverNote: row.handover_note,
      price: row.price,
      creatorId: row.creator_id,
      creatorName: row.creator?.display_name ?? "作者",
      thumbUrl: row.thumb_url,
      ratingAvg: rating ? Math.round((rating.sum / rating.count) * 10) / 10 : 0,
      ratingCount: rating?.count ?? 0,
      users: users.get(row.id) ?? 0,
      owned: mine.has(row.id),
      status: row.status,
      hiddenReason: row.hidden_reason,
      createdAt: row.created_at,
      editedAt: row.edited_at
    };
  });
}
