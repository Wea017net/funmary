# ライセンスへの同意の Worker

外部の人 (リポジトリに書き込み権限のない人) の PR で、ライセンスへの同意を求める Cloudflare Worker です (Issue #235)。

1. 外部の人が PR を開く (または push する) と、GitHub App の Webhook が届く
2. 同意の記録がなければ、PR に案内のコメント (同意のページへのリンク) を送り、検査「ライセンスへの同意」を「待ち」にする
3. 作者が同意のページで GitHub にログインし、「同意する」を押すと、D1 に記録し、その人の開いている PR の検査を通す

同意は 1 人 1 回です。同意してもらう内容 (`src/agreement.ts` の `AGREEMENT_POINTS` や、リポジトリのライセンス) を変えたときは、`AGREEMENT_VERSION` の日付を上げます。上げると、前の版に同意した人にも、もう一度同意を求めます。

リポジトリの持ち主、組織のメンバー、共同作業者と、Bot (Renovate など) の PR には、同意を求めません。

## 手元で動かす

```sh
pnpm --filter @funmary/license-agreement dev
```

秘密の値は、このフォルダの `.dev.vars` (Git の管理対象外) に書きます。

## 最初の準備 (作者の操作)

順番に行います。Worker の URL (`https://funmary-license-agreement.<アカウント名>.workers.dev`) は、1 で初めて反映したときに決まり、2 の GitHub App の設定で使います。URL はリポジトリに書きません。

### 1. Cloudflare

1. `pnpm --filter @funmary/license-agreement exec wrangler login` でログインする
2. `pnpm --filter @funmary/license-agreement exec wrangler d1 create funmary-license-agreement` で D1 を作り、表示された `database_id` を `wrangler.jsonc` に書く (秘密ではないので、コミットしてよい)
3. `pnpm --filter @funmary/license-agreement run deploy` で、マイグレーションと Worker を反映する。表示された URL を控える

### 2. GitHub App

組織 (移管の前は自分のアカウント) の Settings の Developer settings から、GitHub App を作ります。

| 項目 | 値 |
| --- | --- |
| Callback URL | `<Worker の URL>/callback` |
| Request user authorization (OAuth) during installation | 外す |
| Webhook URL | `<Worker の URL>/webhook` |
| Webhook secret | 推測できない長い文字列 (`openssl rand -hex 32` など) |
| Repository permissions | Pull requests: Read-only、Issues: Read and write、Commit statuses: Read and write (Metadata: Read-only は自動で付く) |
| Subscribe to events | Pull request |
| Where can this GitHub App be installed? | Only on this account |

作ったら、次を行います。

1. Client secret を作って控える。Client ID も控える
2. 秘密鍵 (Private key) を作ってダウンロードする。GitHub が配る鍵は PKCS#1 の形なので、Worker で読める PKCS#8 の形に変換する

   ```sh
   openssl pkcs8 -topk8 -nocrypt -in ダウンロードした鍵.pem -out key-pkcs8.pem
   ```

3. App を Funmary のリポジトリにインストールする

### 3. Worker の秘密の値

```sh
cd apps/license-agreement
pnpm exec wrangler secret put GITHUB_APP_ID           # App の ID (App の設定画面の上にある数字)
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY  # key-pkcs8.pem の中身 (BEGIN PRIVATE KEY の行から END の行まで)
pnpm exec wrangler secret put GITHUB_WEBHOOK_SECRET   # 2 の Webhook secret
pnpm exec wrangler secret put GITHUB_CLIENT_ID
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm exec wrangler secret put SIGNING_KEY             # 推測できない長い文字列 (openssl rand -hex 32 など)
```

秘密鍵のファイル (`key-pkcs8.pem` とダウンロードした鍵) は、置いたら手元から消します。

### 4. 自動の反映と、必須の検査

1. Cloudflare で API トークンを作る (権限: Account の Workers Scripts: Edit と D1: Edit)
2. GitHub のリポジトリの Settings で、secret の `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID`、変数 (Variables) の `LICENSE_AGREEMENT_DEPLOY_ENABLED` (`true`) を置く。これで、main で `apps/license-agreement` が変わるたびに反映される
3. ruleset の必須の検査に「ライセンスへの同意」を足す (送り元を、作った GitHub App に限る)
4. 自分以外のアカウント (書き込み権限のないもの) で試しに PR を開き、案内のコメントと同意の流れを確かめる
