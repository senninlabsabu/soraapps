export type Category = "productivity" | "game" | "study" | "tool" | "fun";

export const CATEGORY_LABEL: Record<Category, string> = {
  productivity: "生産性",
  game: "ゲーム",
  study: "学習",
  tool: "ツール",
  fun: "娯楽"
};

export type AppCardData = {
  id: string;
  name: string;
  description: string;
  category: Category;
  categoryLabel: string;
  price: number;
  creatorId: string;
  creatorName: string;
  thumbUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  users: number;
  owned: boolean;
  status: "published" | "hidden" | "deleted";
  hiddenReason: string | null;
  createdAt: string;
  editedAt: string | null;
  earned?: number;
};

export type Review = { mine: boolean; rating: number; comment: string; authorName: string; updatedAt: string };

export type Me = { id: string; displayName: string; linked: boolean } | null;

export type ProductInfo = { sku: string; title: string; description: string; price: number; owned: boolean };

export type FeaturedItem = { id: string; imageUrl: string; promoText: string; app: AppCardData };
