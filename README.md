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
