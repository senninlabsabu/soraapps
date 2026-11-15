# soraapps

拡張機能の販売・共有サイトです。ソラチャットの「senninstudio（作品販売）」「仙人ストア」「拡張機能の実行」を取り出して、
単独のアプリにまとめました。データベースは **Supabase**、ログインとポイントは **仙人アカウント** を使います。
画面は Chrome ウェブストアに近い配置（上部の検索バー、左のカテゴリナビ、横に並ぶ棚、アプリの詳細ページ）です。

## 何を取り出したか

| ソラチャットの機能 | soraapps での扱い |
| --- | --- |
| 仙人アカウントでのログイン・連携（OAuth + PKCE） | 維持（ログインだけの入口にした。ログイン時にポイントの許可も求める） |
| ポイントの残高・加算・減算（冪等キー付き） | 維持（`server/sennin.ts`・`server/payments.ts`） |
| 作品の公開・編集・削除、自動チェック | 作った（拡張機能だけに絞った。`server/dev.ts`・`server/rules.ts`） |
| ストア（一覧・掲載ページ・購入・レビュー・通報） | 作った（`server/store.ts`・`src/pages/Store.tsx` など） |
| 作者への支払い（購入額の全額。保留と再送あり） | 維持（手数料なし。`server/payments.ts`） |
| 拡張機能の実行（sandbox の枠・CSP・ブリッジ） | 維持（`server/rules.ts` の `EXTENSION_CSP`、`src/pages/Runner.tsx`） |
| ブリッジ：アカウント情報（許可制）・ポイント配布（上限つき）・支払い（確認画面つき）・データ保存 | 維持（`server/run.ts`） |
| 管理者による配布の上限の設定・通報の確認 | 作った（`server/admin.ts`。画面なし・API のみ） |
| 商品紹介画像 | 追加（最大5枚。詳細ページに表示。`sa_app_images`。画像は Turso） |
| おすすめ | 追加（運営が画像・アプリ・紹介文を登録。ホームの先頭に出す。`sa_featured`） |
| アプリ内課金 | 追加（作者が商品を定義し、拡張機能の中から購入。買い切り。`sa_app_products`・`sa_app_entitlements`） |

**外したもの**（ソラチャットのチャット機能に依存するため）：オンライン対戦（battle）、拡張機能から開くトーク連携、
senninai（AI チャット）、ミニゲーム、SenninPay（送金）、SenninBank（投資・配当）、友だち・トーク・通話、仙人Tube、
スタンプ・外観・応答スタイルの販売（拡張機能以外の作品）。

## 画面の構成

- `/` ストア：人気・評価・新着の棚。カテゴリや検索をすると一覧に切り替わります。
- `/apps/:id` 詳細：サムネイル、作者、星、利用者数、「追加」（無料）または「○pt で購入」、概要・レビュー（追加した人だけ書ける）、通報。
- `/authors/:id` 作者のページ。
- `/` の「おすすめ」：運営が登録した画像をクリックすると、紹介文と、その下にアプリのアイコン・名前・購入（または「開く」）ボタンが出ます。
- `/library` マイアプリ：追加した拡張機能を「開く」。
- `/run/:id` 実行画面（全画面）。初めて開くとき、ユーザー情報を渡す許可を求めます（ポイントを配る拡張機能のとき）。
- `/dev` 開発者ダッシュボード：利用者数、受け取った pt、保留中の pt、編集、公開をやめる。
- `/dev/new`・`/dev/apps/:id/edit` 作る・直す（商品紹介画像・アプリ内課金の商品・プレビューつき）。

※ 運営（管理者）の画面はありません。運営の操作は API だけで行います（下の「運営」を参照）。

## セットアップ

1. Supabase の SQL Editor で `supabase/schema.sql` を実行します（何度実行しても安全です）。
   `sa_` から始まるテーブルと、配布の枠を作る関数を作ります。画像の中身は Supabase ではなく Turso に保存します（テーブル `sa_blobs` はサーバーが最初に使うとき自動で作ります）。
2. `.env.example` を `.env` にコピーして値を入れます。
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（Settings → API）
   - `APPS_ENCRYPTION_KEY`（長いランダムな文字列。仙人アカウントの更新トークンを暗号化します）
   - `SENNIN_BASE_URL` / `SENNIN_CLIENT_ID` / `SENNIN_CLIENT_SECRET` / `SENNIN_REDIRECT_URI`（既存のソラチャットと同じ設定名です）
   - `SENNIN_BASE_URL` は仙人アカウントの API（`https://sennin-account-api.xianrendesu.workers.dev/`）、`SENNIN_ACCOUNT_URL` は仙人アカウントの画面（GAS）です。
     画面の URL は、開発者設定や新規登録への案内にだけ使います。
   - `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（画像の保存先。ソラチャットと同じ値でかまいません）
   - `APP_ORIGIN`、`ADMIN_PASSWORD`
3. 仙人アカウントの開発者設定に、リダイレクトURI（`SENNIN_REDIRECT_URI`）を登録します。
   **ポイントの読み書き（`points:write`）は仙人アカウント側の管理者の承認が必要です**。承認されていないと、ログインの画面でエラーになります。
4. `npm install` のあと、開発は `npm run dev`、本番は `npm run build` → `npm start` です。
5. 拡張機能をポイントで配るには、運営 API（下の「運営」の例）で配布を有効にし、合計の上限と1回の上限を決めてください。
   有効にしていない拡張機能は、ポイントを配れません。

## 拡張機能の作り方（作者向け）

- HTML・CSS・JavaScript で作ります。HTML と CSS と JavaScript を合わせて 15万文字まで。
- iframe・frame・object・embed・meta・base は使えません。外部サイトへの通信は、ブラウザ側（CSP）で制限されます。
- 公開時に自動チェックをします。URL・メールアドレス・電話番号らしいもの・禁止語は書けません。
- ブリッジ（`window.sorachat`）：
  - `getAccount()`・`requestAccess()`：ユーザー情報（許可した人だけ）
  - `awardPoints(amount, reason, requestId)`：配布（管理者が決めた上限の中だけ）
  - `charge(amount, title, requestId)`：支払い（利用者が確認画面で「払う」を押したときだけ）
  - `storage.get / set / remove / keys`：データ保存（無料・1拡張機能あたり100キーまで・値は16KBまで）

## 安全のしくみ

- 拡張機能は `sandbox="allow-scripts"`（same-origin なし）の枠で動きます。ログイン情報（Cookie）・画面・localStorage には触れません。
- 枠の文書には、`default-src 'none'`・`connect-src https: wss:` などの CSP を付けます。`form-action`・`frame-src` は 'none' です。
- 枠の中からサーバーへは直接届きません。依頼は親の画面が確かめてから、サーバーへ取り次ぎます。
- ポイントの支払いは、確認画面で利用者が「払う」を押したときだけ動きます。二重に払わないよう、支払いの記録ごとに冪等キーを付けています。
- ポイントの配布は、枠の確保（DB の関数で原子的に行う）→ 仙人アカウントへの加算 → 確定、の順です。確実に失敗したものだけ枠を戻します。
- 通報が5件たまると自動で非公開になります。買った人は、作者が削除したあとも引き続き使えます（運営が非公開にしたものは使えません）。

## テスト

- `npm run test:rules`：自動チェック（画像の形式・禁止語・価格・CSP・隔離文書の枠抜け防止・ブリッジの依頼の上限・保存の上限）。
  DB や仙人アカウントには触れません。

## 仙人アカウント（あかうんと）との連携の仕様

連携は、仙人アカウントの OAuth 2.0 認可コードフロー（PKCE・S256）です。仕様の要点は次のとおりです。

- 認可：`GET {SENNIN_BASE_URL}/oauth/authorize`。ログインと同意は仙人アカウント側の画面で行います。このアプリはパスワードを扱いません。
- トークン：`POST /oauth/token`。クライアント認証は Basic 認証だけを使います。
  - 認可コードは10分・1回限り。アクセストークンは1時間、更新トークンは30日で、更新するたびに新しいものに入れ替わります（暗号化して保存し直します）。
  - `invalid_grant` は、その人の許可が無効になったことを表すので、連携を解除します。`invalid_client` はアプリの設定の問題なので、連携は残して管理者に確認を促します。
- 要求するスコープは `profile points:read points:write`。`points:write` は仙人アカウント側の管理者だけが付与できます。
  付与されていないと認可画面で `invalid_scope` になり、「管理者に確認してください」と表示します。
  同意の結果に `points:*` が含まれなかったときは、そのトークンを失効させてログインを止めます。
- ユーザーの識別は仙人アカウントの `sub`（応答の `id` も受け付けます）。名前は表示だけに使います。
- ポイントの加算・減算は `POST /api/v1/points/adjust`。`amount` は0以外の整数、`reason` は1〜100文字、`idempotency_key` は `sa-<支払いID>` の形で、同じ操作の再送には同じキーを使います。
  送信前に、この条件を確かめます。
- 401 `invalid_token` のときは、更新トークンで取り直して1回だけ再試行します。429 `daily_limit_exceeded` は「上限に達した」と表示します。
- 仙人アカウントの認可画面に送る前に、`state` と PKCE の verifier を、10分有効な HttpOnly の Cookie に入れます。

## よくあるつまずき

- **認証のあと `/api/auth/sennin/...` の下に飛び、`{"ok":false,"error":"見つかりません。"}` と出る**
  `APP_ORIGIN` が `soraapps.onrender.com` のように `https://` 無しで設定されているのが原因です。戻り先が相対URLとして解釈されます。
  `APP_ORIGIN=https://soraapps.onrender.com` と書き直してください（起動時のログに「https:// が無かったため補いました」と出ていれば、補われた値で動いています）。
- **仙人アカウントで「redirect_uri が一致しない」と出る**
  `SENNIN_REDIRECT_URI`（既定は `APP_ORIGIN` + `/api/auth/sennin/callback`）を、仙人アカウントの開発者設定の登録と完全一致させてください。

## 注意（未確認の点）

- この版は、**実際の Supabase と仙人アカウントでは動作確認していません**。型チェックと上のテストだけ確認しています。
  最初に `schema.sql` を実行し、ログイン → 公開 → 購入 → 実行 → 配布 の順で確かめてください。
- 配布の枠を確かめるロックと、ログイン・配布の回数制限は、このサーバーの中だけで有効です。
  複数のサーバーで動かすと、回数の数え方がずれることがあります（1台で運用してください）。
- 一覧は、公開中の拡張機能を最大500件まで読んで並べ替えます。件数が増えたら、並べ替えを DB 側（ビューや関数）に移してください。
- プレビューでは、ポイント・アカウント情報・配布は使えません（保存していない文書を、ログイン情報なしで表示するため）。

## アプリ内課金（作者向け）

作者は編集画面の「アプリ内課金の商品」で商品を定義します（商品ID・名前・説明・価格 10〜1000pt、最大20個）。
拡張機能の中からは、次のように使います。

```js
// 商品の一覧（持っているかどうか付き）
const { products } = await window.sorachat.iap.products();
// products: [{ sku, title, description, price, owned }]

// 購入（利用者が確認画面で「払う」を押したときだけ、ポイントが減る）
const result = await window.sorachat.iap.purchase("unlock-pro");
// 成功: { ok: true, data: {...} } ／ キャンセル・残高不足などは例外（e.code で判定）
```

- 買い切りです。同じ商品を二重に買うことはできず、2回目は「購入済み」として扱われます（ポイントは減りません）。
- 買った商品は「持っている」状態として記録されます。拡張機能は `products()` の `owned` を見て機能を解放してください。
- 売上は、ポイント支払いと同じく作者の仙人アカウントに入ります（手数料なし）。

## 運営（管理者）

運営の画面はありません。`ADMIN_PASSWORD`（環境変数）を使って API を呼びます。ユーザー名は何でもかまいません。

```bash
# 一覧（通報の件数・配布の設定つき）
curl -u admin:$ADMIN_PASSWORD https://apps.example.com/api/admin/apps

# 非公開・公開
curl -u admin:$ADMIN_PASSWORD -H "content-type: application/json" \
  -d '{"status":"hidden","reason":"規約違反"}' https://apps.example.com/api/admin/apps/<id>/status

# 通報の記録を消す
curl -u admin:$ADMIN_PASSWORD -X POST https://apps.example.com/api/admin/apps/<id>/clear-reports

# ポイント配布の設定（used は変わりません）
curl -u admin:$ADMIN_PASSWORD -H "content-type: application/json" \
  -d '{"active":true,"maxPoints":5000,"perCallMax":100,"perUserMinuteMax":60}' \
  https://apps.example.com/api/admin/apps/<id>/grant
```

- `ADMIN_PASSWORD` が未設定なら、運営の API は使えません（503）。
- パスワードは環境変数だけに置き、ソースや画面には書きません。変更するときは環境変数を差し替えて再起動してください。

## おすすめの登録（運営）

ストアのホームの先頭に出す「おすすめ」は、運営 API で登録します（画面はありません）。画像・アプリ・紹介文・並び順を指定します。

```bash
# 登録（画像は PNG・JPEG・GIF・WebP、2MBまで。紹介文は300字まで）
curl -u admin:$ADMIN_PASSWORD -F appId=<アプリID> -F promoText="25分集中して作業が進みます。" \
  -F position=0 -F image=@banner.png https://apps.example.com/api/admin/featured

# 一覧・紹介文と並び順の変更・削除
curl -u admin:$ADMIN_PASSWORD https://apps.example.com/api/admin/featured
curl -u admin:$ADMIN_PASSWORD -H "content-type: application/json" -d '{"promoText":"新しい紹介文"}' https://apps.example.com/api/admin/featured/<id>
curl -u admin:$ADMIN_PASSWORD -X DELETE https://apps.example.com/api/admin/featured/<id>
```

## 画像の保存について

サムネイル・商品紹介画像・おすすめの画像は、すべて Turso（`sa_blobs`）に保存し、`/api/images/:id` で配信します（長くキャッシュされます）。
元のソラチャットと同じ方式です。Supabase Storage は使いません。

## スマホの検索

小さな画面では、上部の検索ボタンを押すと、検索バーがアニメーションつきで上から開きます（戻る矢印か Esc で閉じられます）。

---

## 追加：マンガ・画像・小説・手渡しグッズ、注文（エスクロー）、DM、ウォレット

作品の種類（`sa_apps.kind`）が増えました。既存の拡張機能はそのまま動きます。

| 種類 | 作り方（作者） | 読む・使う（利用者） |
| --- | --- | --- |
| 拡張機能 | HTML・CSS・JavaScript（従来どおり） | 追加・購入 →「開く」 |
| マンガ | ページ画像を順番に選ぶ（最大200枚・1枚10MB） | 追加・購入 →「読む」（ビュアー） |
| 画像 | ページ画像を順番に選ぶ | 追加・購入 →「読む」（ビュアー） |
| 小説 | 章ごとにタイトルと本文（1章2万字・全体30万字まで） | 追加・購入 →「読む」（目次・文字の大きさ・背景色） |
| 手渡しグッズ | 価格（10〜1000pt）・在庫（0〜99）・受け渡しの目安 | 「注文する」→ 取引のページで DM と受け取り確認 |

### 手渡しグッズの流れ（エスクロー）

1. **注文**：在庫を1つ確保し、代金を預かります（まだ作者へは入金しません）。
2. **DM**：購入者と出品者が、取引のページで日時・場所を相談します（当事者だけが読み書きできます）。
3. **確認**：購入者は「受け取りました」、出品者は「渡しました」を押します。**両方そろった時だけ**作者へ入金されます。
4. **キャンセル**：どちらかが確認を押すまでは、キャンセルできます。預かった代金は買った人へ返します。

同じ操作を押し直しても二重には動きません（注文番号 `requestId`・冪等キー・条件つきの更新で守っています）。

### 画面と API

- 画面：`/read/:id`（閲覧）、`/orders`・`/orders/:id`（取引と DM）、`/wallet`（ウォレット）。
- ストアは `?kind=manga` のように種類で絞り込めます。
- 中身の配信は `/api/content/:id/...` です。**購入した人と作者だけ**が読めます（公開の画像 URL には載せません）。
- 取引：`GET /api/orders`、`GET /api/orders/:id`、`POST /api/orders/:id/confirm`、`POST /api/orders/:id/cancel`、`POST /api/orders/:id/messages`。
- 注文：`POST /api/store/apps/:id/order`（body: `{ "requestId": "..." }`）。
- ウォレット：`GET /api/wallet`（残高・預かり中・入金待ち・明細）。

### セットアップ（追加分）

1. Supabase の SQL Editor で `supabase/schema.sql` をもう一度実行します（追加分の表と列は、何度実行しても安全です）。
2. 既存の作品の種類は `extension` のままです。変更は不要です。
3. テスト：`npm run test:rules`（追加した検査も含みます）。

### 注意（この版でまだ入っていないもの）

- **紛争・自動確定**：片方が確認しないまま止まると、代金は預かったままになります（両者の確認が前提のため）。
  運営による解決（強制的な返金・入金）や、一定期間後の自動確定は、まだ作っていません。運営 API に追加してください。
- **DM の更新**：取引のページが開いている間、5秒ごとに読み直します（リアルタイム通信ではありません）。
- **在庫と注文の確保**：支払いが不確かなまま止まった注文は、在庫を確保したままになります。同じ注文番号で押し直すと続きを行います。
- **DM の連絡先**：URL・メールアドレス・電話番号は、公開の文章と同じく書けません。受け渡しの場所と時間の相談だけを想定しています。
  連絡先の交換を許す場合は、`server/rules.ts` の `checkOrderMessage` を変えてください。
- **通知**：新しいメッセージや確認を知らせる通知（メール・プッシュ）はありません。
- **この版は、実際の Supabase と仙人アカウントでは動作確認していません**（拡張機能の版と同じく、型チェックと `npm run test:rules` だけ確認しています）。
