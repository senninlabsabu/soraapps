-- soraapps: 拡張機能の販売・共有サイト（Supabase）
-- 何度実行しても安全です（if not exists / create or replace / on conflict を使っています）。
-- SQL Editor でこのファイルを1回実行してください。

-- ============ ユーザー・ログイン（仙人アカウント） ============

create table if not exists public.sa_users (
  id uuid primary key default gen_random_uuid(),
  sennin_id text not null unique,
  display_name text not null default '仙人ユーザー',
  created_at timestamptz not null default now()
);

create table if not exists public.sa_sessions (
  token_hash text primary key,
  user_id uuid not null references public.sa_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sa_sessions_user_idx on public.sa_sessions(user_id);

-- 仙人アカウントの更新トークン（暗号化して保存する）
create table if not exists public.sa_sennin_tokens (
  user_id uuid primary key references public.sa_users(id) on delete cascade,
  refresh_token_enc text not null,
  updated_at timestamptz not null default now()
);

-- 作者の状態（停止）
create table if not exists public.sa_creators (
  user_id uuid primary key references public.sa_users(id) on delete cascade,
  suspended boolean not null default false,
  suspended_reason text
);

-- ============ アプリ（拡張機能） ============

create table if not exists public.sa_apps (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.sa_users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  description text not null default '' check (char_length(description) <= 300),
  category text not null default 'tool' check (category in ('productivity', 'game', 'study', 'tool', 'fun')),
  -- 0 は無料。有料は 10〜1000pt
  price integer not null default 0 check (price = 0 or (price between 10 and 1000)),
  -- published: 公開 / hidden: 非公開（通報・運営） / deleted: 作者が削除（買った人は引き続き使える）
  status text not null default 'published' check (status in ('published', 'hidden', 'deleted')),
  hidden_reason text,
  thumb_url text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists sa_apps_status_idx on public.sa_apps(status, created_at desc);
create index if not exists sa_apps_creator_idx on public.sa_apps(creator_id);

-- コードは一覧に出さないよう、別の表に置く（買った人・作者だけが読む）
create table if not exists public.sa_app_code (
  app_id uuid primary key references public.sa_apps(id) on delete cascade,
  html text not null default '',
  css text not null default '',
  js text not null default ''
);

-- 通報（1人1回）。5件で自動で非公開
create table if not exists public.sa_app_reports (
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  user_id uuid not null references public.sa_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (app_id, user_id)
);

-- レビュー（1人1件）
create table if not exists public.sa_app_reviews (
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  user_id uuid not null references public.sa_users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_id, user_id)
);

-- 持っているアプリ（無料で追加したものも、購入したものもここに入る）
create table if not exists public.sa_app_owned (
  user_id uuid not null references public.sa_users(id) on delete cascade,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  purchase_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, app_id)
);
create index if not exists sa_app_owned_app_idx on public.sa_app_owned(app_id);

-- ポイントの支払い記録。
--   kind = 'purchase'：ストアでの購入
--   kind = 'charge'  ：拡張機能の中の支払い（利用者が確認画面で「払う」を押したもの）
-- 仙人アカウントへの減算は idempotency_key（sa-支払いID）で行う。途中で止まっても二重に払わない。
create table if not exists public.sa_app_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sa_users(id) on delete cascade,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  kind text not null check (kind in ('purchase', 'charge')),
  amount integer not null check (amount > 0),
  title text,
  request_id text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  sennin_ledger_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sa_app_purchases_request_uidx
  on public.sa_app_purchases(user_id, app_id, request_id) where request_id is not null;

-- 作者への支払い（購入・支払いのたびに1件。purchase_id で二重に作らない）
create table if not exists public.sa_app_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.sa_users(id) on delete cascade,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  purchase_id uuid not null unique references public.sa_app_purchases(id) on delete cascade,
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  attempts integer not null default 0,
  last_error text,
  sennin_ledger_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sa_app_payouts_creator_idx on public.sa_app_payouts(creator_id, status);

-- 拡張機能からのポイント配布の設定（管理者が決める）
create table if not exists public.sa_app_grants (
  app_id uuid primary key references public.sa_apps(id) on delete cascade,
  active boolean not null default false,
  max_points integer not null default 0 check (max_points >= 0),
  used_points integer not null default 0 check (used_points >= 0),
  per_call_max integer not null default 500 check (per_call_max >= 1),
  per_user_minute_max integer not null default 0 check (per_user_minute_max >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.sa_app_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sa_users(id) on delete cascade,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  request_id text not null,
  points integer not null check (points > 0),
  reason text not null default '',
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, app_id, request_id)
);
create index if not exists sa_app_awards_minute_idx on public.sa_app_awards(user_id, app_id, created_at);

-- 拡張機能ごとの許可（ユーザー情報を渡してよいか）
create table if not exists public.sa_app_consents (
  user_id uuid not null references public.sa_users(id) on delete cascade,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, app_id)
);

-- 拡張機能のデータ保存（仙人アカウントにひもづけ・無料）
create table if not exists public.sa_app_storage (
  user_id uuid not null references public.sa_users(id) on delete cascade,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 64),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, app_id, key)
);

-- ============ 配布の枠（DB の関数で原子的に行う） ============

-- 配布の枠を確保する。同じ request_id が既にあれば、その今の状態を返す（押し直しても二重に枠を使わない）
create or replace function public.sa_reserve_award(
  p_user uuid, p_app uuid, p_request text, p_points integer, p_reason text
) returns jsonb
language plpgsql
as $$
declare
  existing record;
  grant_row record;
  minute_used integer;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('sa-award:' || p_app::text));

  select id, status, points into existing
  from public.sa_app_awards
  where user_id = p_user and app_id = p_app and request_id = p_request;
  if found then
    return jsonb_build_object('result', 'exists', 'id', existing.id, 'status', existing.status, 'points', existing.points);
  end if;

  select max_points, used_points, active, per_user_minute_max into grant_row
  from public.sa_app_grants
  where app_id = p_app;
  if not found or not grant_row.active then
    return jsonb_build_object('result', 'inactive');
  end if;
  if grant_row.used_points + p_points > grant_row.max_points then
    return jsonb_build_object('result', 'exhausted', 'remaining', grant_row.max_points - grant_row.used_points);
  end if;

  if grant_row.per_user_minute_max > 0 then
    select coalesce(sum(points), 0) into minute_used
    from public.sa_app_awards
    where user_id = p_user and app_id = p_app
      and status in ('reserved', 'done')
      and created_at > now() - interval '1 minute';
    if minute_used + p_points > grant_row.per_user_minute_max then
      return jsonb_build_object(
        'result', 'minute_exhausted',
        'limit', grant_row.per_user_minute_max,
        'remaining', greatest(grant_row.per_user_minute_max - minute_used, 0)
      );
    end if;
  end if;

  update public.sa_app_grants
  set used_points = used_points + p_points, updated_at = now()
  where app_id = p_app;

  insert into public.sa_app_awards (user_id, app_id, request_id, points, status, reason)
  values (p_user, p_app, p_request, p_points, 'reserved', p_reason)
  returning id into new_id;

  return jsonb_build_object('result', 'reserved', 'id', new_id, 'status', 'reserved', 'points', p_points);
end;
$$;

-- 配布の結果を確定する。失敗したものは枠を戻す（確実に加算されなかった場合だけ呼ぶ）
create or replace function public.sa_settle_award(p_award uuid, p_status text) returns void
language plpgsql
as $$
declare
  a record;
begin
  select * into a from public.sa_app_awards where id = p_award for update;
  if not found or a.status <> 'reserved' then
    return;
  end if;
  if p_status = 'failed' then
    update public.sa_app_grants
    set used_points = greatest(used_points - a.points, 0), updated_at = now()
    where app_id = a.app_id;
  end if;
  update public.sa_app_awards set status = p_status, settled_at = now() where id = p_award;
end;
$$;

-- ============ anon からは直接読めないようにする（サーバーは service role で読む） ============

alter table public.sa_users enable row level security;
alter table public.sa_sessions enable row level security;
alter table public.sa_sennin_tokens enable row level security;
alter table public.sa_creators enable row level security;
alter table public.sa_apps enable row level security;
alter table public.sa_app_code enable row level security;
alter table public.sa_app_reports enable row level security;
alter table public.sa_app_reviews enable row level security;
alter table public.sa_app_owned enable row level security;
alter table public.sa_app_purchases enable row level security;
alter table public.sa_app_payouts enable row level security;
alter table public.sa_app_grants enable row level security;
alter table public.sa_app_awards enable row level security;
alter table public.sa_app_consents enable row level security;
alter table public.sa_app_storage enable row level security;

-- ============ 追加：商品紹介画像・アプリ内課金 ============

-- 商品紹介画像（詳細ページに出す。最大5枚）
create table if not exists public.sa_app_images (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  position integer not null default 0,
  -- 画像の中身は Turso（sa_blobs）に保存する。ID で配信する（/api/images/:id）
  blob_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists sa_app_images_app_idx on public.sa_app_images(app_id, position);

-- アプリ内で売る商品（作者が定義する）
create table if not exists public.sa_app_products (
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  sku text not null check (sku ~ '^[a-z0-9_-]{2,32}$'),
  title text not null check (char_length(title) between 1 and 40),
  description text not null default '' check (char_length(description) <= 200),
  price integer not null check (price between 10 and 1000),
  position integer not null default 0,
  primary key (app_id, sku)
);

-- 買った商品（買い切り。同じ商品を二重に買えないようにする）
create table if not exists public.sa_app_entitlements (
  user_id uuid not null references public.sa_users(id) on delete cascade,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  sku text not null,
  purchase_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, app_id, sku)
);

-- 支払いの種類に「アプリ内課金（iap）」を加える（既存の表にも適用されるように作り直す）
alter table public.sa_app_purchases drop constraint if exists sa_app_purchases_kind_check;
alter table public.sa_app_purchases
  add constraint sa_app_purchases_kind_check check (kind in ('purchase', 'charge', 'iap'));

alter table public.sa_app_images enable row level security;
alter table public.sa_app_products enable row level security;
alter table public.sa_app_entitlements enable row level security;

-- ============ 追加：おすすめ（管理者が登録。ストアのホームの先頭に出す） ============

create table if not exists public.sa_featured (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  -- 紹介画像（Turso の sa_blobs）
  blob_id text not null,
  -- 紹介文（クリックしたときに、アプリのアイコン・名前・購入ボタンの上に出す）
  promo_text text not null default '' check (char_length(promo_text) <= 300),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sa_featured_position_idx on public.sa_featured(position, created_at);
alter table public.sa_featured enable row level security;

-- ============ 追加：マンガ・画像・小説・手渡しグッズ・注文（エスクロー）・DM ============

-- 作品の種類（拡張機能・画像・マンガ・小説・手渡しグッズ）。既存の作品は拡張機能のまま
alter table public.sa_apps add column if not exists kind text not null default 'extension';
alter table public.sa_apps drop constraint if exists sa_apps_kind_check;
alter table public.sa_apps add constraint sa_apps_kind_check
  check (kind in ('extension', 'image', 'manga', 'novel', 'goods'));

-- 手渡しグッズの在庫（0 は売り切れ）と、受け渡しの目安（場所・時間の目安。連絡先は書けない）
alter table public.sa_apps add column if not exists stock integer not null default 1;
alter table public.sa_apps drop constraint if exists sa_apps_stock_check;
alter table public.sa_apps add constraint sa_apps_stock_check check (stock between 0 and 99);
alter table public.sa_apps add column if not exists handover_note text not null default '';
alter table public.sa_apps drop constraint if exists sa_apps_handover_note_check;
alter table public.sa_apps add constraint sa_apps_handover_note_check check (char_length(handover_note) <= 200);

-- 画像・マンガのページ（画像の中身は Turso の sa_blobs。公開せず、購入した人だけに配る）
create table if not exists public.sa_content_pages (
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  position integer not null check (position >= 0),
  blob_id text not null,
  primary key (app_id, position)
);

-- 小説の章（本文は購入した人だけに配る）
create table if not exists public.sa_content_chapters (
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  position integer not null check (position >= 0),
  title text not null check (char_length(title) between 1 and 40),
  body text not null check (char_length(body) between 1 and 20000),
  primary key (app_id, position)
);

-- 注文（手渡しグッズ）。代金は受け取り確認が両者そろうまで作者へ入金しない（エスクロー）
--   pending_payment：在庫を確保した。代金の支払い中
--   open           ：代金を預かった。受け渡しの相談・確認の段階
--   completed      ：両者が受け取り済みにした。作者へ入金済み（sa_app_payouts）
--   cancelled      ：キャンセル。預かった代金は refunded_at の時点で返金済み
create table if not exists public.sa_orders (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  app_id uuid not null references public.sa_apps(id) on delete cascade,
  buyer_id uuid not null references public.sa_users(id) on delete cascade,
  seller_id uuid not null references public.sa_users(id) on delete cascade,
  amount integer not null check (amount between 10 and 1000),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'open', 'completed', 'cancelled')),
  purchase_id uuid references public.sa_app_purchases(id) on delete set null,
  paid_at timestamptz,
  buyer_received_at timestamptz,
  seller_handed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('buyer', 'seller')),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, request_id)
);
create index if not exists sa_orders_buyer_idx on public.sa_orders(buyer_id, created_at desc);
create index if not exists sa_orders_seller_idx on public.sa_orders(seller_id, created_at desc);

-- 注文ごとのDM（購入者と出品者だけが読み書きする）
create table if not exists public.sa_order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sa_orders(id) on delete cascade,
  sender_id uuid not null references public.sa_users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists sa_order_messages_idx on public.sa_order_messages(order_id, created_at);
create index if not exists sa_order_messages_sender_idx on public.sa_order_messages(sender_id, created_at);

-- 支払いの種類に「注文（order）」を加える
alter table public.sa_app_purchases drop constraint if exists sa_app_purchases_kind_check;
alter table public.sa_app_purchases
  add constraint sa_app_purchases_kind_check check (kind in ('purchase', 'charge', 'iap', 'order'));

alter table public.sa_content_pages enable row level security;
alter table public.sa_content_chapters enable row level security;
alter table public.sa_orders enable row level security;
alter table public.sa_order_messages enable row level security;
