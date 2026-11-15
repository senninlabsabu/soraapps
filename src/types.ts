export type Category = "productivity" | "game" | "study" | "tool" | "fun";

export const CATEGORY_LABEL: Record<Category, string> = {
  productivity: "生産性",
  game: "ゲーム",
  study: "学習",
  tool: "ツール",
  fun: "娯楽"
};

// 作品の種類：拡張機能・画像・マンガ・小説・手渡しグッズ
export type Kind = "extension" | "image" | "manga" | "novel" | "goods";

export const KIND_LABEL: Record<Kind, string> = {
  extension: "拡張機能",
  image: "画像",
  manga: "マンガ",
  novel: "小説",
  goods: "手渡しグッズ"
};

export type AppCardData = {
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

// 中身の目次（ページ数・章の見出し。本文は含まない）
export type Contents = { pageCount: number; chapters: { index: number; title: string }[] };

export type OrderStatus = "pending_payment" | "open" | "completed" | "cancelled";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "支払いを確認中",
  open: "受け渡し待ち",
  completed: "完了",
  cancelled: "キャンセル"
};

export type OrderSummary = {
  id: string;
  role: "buyer" | "seller";
  status: OrderStatus;
  amount: number;
  appName: string;
  thumbUrl: string | null;
  counterpartName: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderMessage = { id: string; mine: boolean; body: string; createdAt: string; authorName: string };

export type OrderDetail = {
  order: {
    id: string;
    role: "buyer" | "seller";
    status: OrderStatus;
    amount: number;
    createdAt: string;
    updatedAt: string;
    paidAt: string | null;
    buyerConfirmed: boolean;
    sellerConfirmed: boolean;
    myConfirmed: boolean;
    completedAt: string | null;
    cancelledAt: string | null;
    cancelledBy: "buyer" | "seller" | null;
    refunded: boolean;
  };
  app: { id: string; name: string; thumbUrl: string | null; kind: Kind; kindLabel: string; handoverNote: string; appStatus: string } | null;
  counterpartName: string;
  messages: OrderMessage[];
  canConfirm: boolean;
  canCancel: boolean;
  canMessage: boolean;
};

export type WalletActivity = {
  id: string;
  type: "payment" | "refund" | "sale";
  title: string;
  amount: number;
  at: string;
};

export type Wallet = {
  linked: boolean;
  points: number | null;
  holdAsBuyer: number;
  receivableAsSeller: number;
  activity: WalletActivity[];
};
