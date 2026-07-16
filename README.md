# メモアプリ

iPhone / iPad / Windows で同期する、クラウド型のメモアプリ（PWA）です。
Apple 純正メモの代わりに、どの端末からでも同じメモにアクセスできます。

## 主な機能

- メモの作成・編集・削除、フォルダ整理
- **短期メモ（7日で自動的にゴミ箱へ）** と **長期メモ** をワンタップで切り替え
- ゴミ箱（30日で完全削除・復元可能・カウントダウン表示）
- 全端末でのリアルタイム同期（Supabase）
- 横断検索（タイトル・本文・フォルダ名。ゴミ箱は対象外）
- ピン留め
- **音声メモ**（録音 → Groq Whisper で文字起こし → Claude で整形・タイトル自動生成）
- PWA（ホーム画面に追加してアプリのように使える／オフライン閲覧）

---

## セットアップ手順

はじめての方でも進められるよう、順番に説明します。所要時間の目安は 30〜40 分です。

### 0. 前提：Node.js

このアプリの開発・実行には Node.js が必要です。未インストールの場合は
[nodejs.org](https://nodejs.org/) の LTS 版を入れてください。
（Windows なら `winget install OpenJS.NodeJS.LTS` でも入ります）

インストール後、ターミナル（PowerShell）で確認：

```powershell
node --version
npm --version
```

---

### 1. Supabase プロジェクトを作る（無料）

Supabase はデータベース・認証・ファイル保存をまとめて提供するサービスです。

1. [supabase.com](https://supabase.com/) にアクセスし、「Start your project」から
   GitHub アカウントなどで **サインアップ**（無料）。
2. ダッシュボードで **「New project」** をクリック。
   - Organization：初回は自動で作られます
   - Name：`memo` など任意
   - Database Password：**強めのパスワードを設定してメモしておく**
   - Region：`Northeast Asia (Tokyo)` を推奨
3. 「Create new project」を押すと、1〜2分でプロジェクトが立ち上がります。

### 2. データベースを作成（SQL 実行）

1. 左メニューの **「SQL Editor」** を開く。
2. このリポジトリの [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   の中身を**すべてコピー**して貼り付ける。
3. 右下の **「Run」** を実行。
   - テーブル（notes / folders / attachments）、セキュリティ設定（RLS）、
     自動削除の仕組み（pg_cron）がまとめて作られます。

> **pg_cron でエラーが出る場合**
> 左メニュー「Database」→「Extensions」で **`pg_cron`** を検索して有効化してから、
> SQL の最後の `create extension ... pg_cron;` 以降だけを再実行してください。

### 3. リアルタイム同期を有効化

複数端末で即時同期するための設定です。**この設定が無いと他端末の変更が
反映されません**（画面を開き直すまで古いままになります）。

**SQL で設定する（推奨・確実）**

1. 左メニュー **「SQL Editor」** を開く。
2. [`supabase/migrations/0003_realtime.sql`](supabase/migrations/0003_realtime.sql)
   の中身をすべて貼り付けて **「Run」**。
   - `notes` / `folders` が Realtime の配信対象に追加されます。
   - 何度実行しても安全です（冪等）。

> 画面から行う場合は「Database」→「Replication」で `notes` と `folders` の
> Realtime を ON にします。ただし削除の同期には `REPLICA IDENTITY FULL` が
> 必要なため、上記 SQL の実行を推奨します。

### 4. ストレージ（画像・添付用）

1. 左メニュー **「Storage」→「New bucket」**。
2. 名前を `attachments` にして作成し、**Public は必ず OFF（非公開）** にする。
3. SQL Editor で
   [`supabase/migrations/0004_private_attachments.sql`](supabase/migrations/0004_private_attachments.sql)
   を実行し、**バケットの非公開化と「本人のみ読み取り」ポリシー**を適用する。
   （何度実行しても安全）

> 添付画像は本人以外に見えないよう、アプリ側は**署名付きURL（有効期限つき）**で
> 表示します。バケットを Public にしてしまうと URL を知る誰でも閲覧できてしまうため、
> 必ず非公開のままにしてください。

### 5. 認証（ログイン方法）の設定

1. 左メニュー **「Authentication」→「Providers」**。
2. **Email** が有効になっていることを確認（既定で有効）。
   - すぐ試したい場合は「Confirm email」を一時的に OFF にするとメール確認なしで登録できます。
   - **本番公開時は「Confirm email」を必ず ON に戻してください**（他人のメールでの
     なりすまし登録を防ぐため）。
3. （任意）**Google ログイン**を使う場合は Google プロバイダを有効化し、
   Google Cloud で OAuth クライアントを作成して Client ID / Secret を設定します。
4. 「Authentication」→「URL Configuration」で **Site URL** に
   ローカル開発なら `http://localhost:3000` を設定。
   （Vercel 公開後は公開URLも「Redirect URLs」に追加してください）

#### ログインを強固にする（推奨設定）

アプリのログイン画面は、新規登録時に「10文字以上・3種類以上の文字種」を要求します。
さらに Supabase ダッシュボードで以下を有効にすると、より安全です（コードでは設定できない項目）。

パスワード関連は **Email プロバイダ設定**の中（下へスクロール）にまとまっています。
UI のバージョンによりメニュー名が「Providers」「Sign In / Providers」等と異なるため、
**直接この URL を開くのが確実**です：`/dashboard/project/<プロジェクトID>/auth/providers?provider=Email`

- **Minimum password length**：`10` 以上（全プラン可）。
- **Password Requirements**：英大文字・小文字・数字・記号を要求する条件を選択（全プラン可）。
- **Confirm email**：本番では **ON**（同じ Email プロバイダ内・全プラン可）。
- **Prevent use of leaked passwords（漏洩パスワード保護 / HaveIBeenPwned）**：**ON**。
  ただし **Pro プラン以上でのみ利用可**（無料プランでは表示されない／設定不可）。
- **Rate Limits**（Authentication → Rate Limits）：既定のレート制限を維持（総当たり対策）。

> **MFA（2要素認証）** はダッシュボードのトグルだけでは使えません。アプリ側に登録・
> 検証フロー（`supabase.auth.mfa.*`）の実装が別途必要です（今後の拡張）。

### 6. 接続情報を .env.local に書く

1. 左メニュー **「Project Settings」→「API」** を開く。
2. 次の2つをコピー：
   - **Project URL**
   - **anon public** キー
3. このフォルダの [`.env.local.example`](.env.local.example) を
   **`.env.local`** という名前でコピーし、値を貼り付けます。

```env
NEXT_PUBLIC_SUPABASE_URL=（Project URL）
NEXT_PUBLIC_SUPABASE_ANON_KEY=（anon public キー）
```

### 7. 音声メモ用の API キー（任意）

音声メモを使う場合のみ設定します。テキストメモだけなら不要です。

- **Groq**（文字起こし・無料枠あり）：[console.groq.com/keys](https://console.groq.com/keys)
  で API キーを発行 → `.env.local` の `GROQ_API_KEY` に設定。
- **Anthropic Claude**（整形・タイトル生成）：[console.anthropic.com](https://console.anthropic.com/)
  で API キーを発行 → `.env.local` の `ANTHROPIC_API_KEY` に設定。

---

### 8. 依存関係のインストールと起動

このフォルダで以下を実行します。

```powershell
npm install
node scripts/gen-icons.mjs   # PWA用アイコンを生成
npm run dev
```

ブラウザで **http://localhost:3000** を開き、新規登録 → ログインすればメモが使えます。

---

## スマホ（iPhone / iPad）で使う

同じアカウントでログインすれば全端末で同期します。ホーム画面に追加するとアプリのように使えます。

- **iPhone / iPad（Safari）**：共有ボタン →「ホーム画面に追加」
- **Windows（Edge / Chrome）**：アドレスバーのインストールアイコン →「インストール」

※ ローカルの `localhost` はスマホからは開けません。スマホでも使うには次の「公開」を行ってください。

---

## インターネットに公開する（Vercel・無料）

1. このフォルダを GitHub リポジトリにプッシュ。
2. [vercel.com](https://vercel.com/) にログイン →「Add New Project」→ 該当リポジトリを選択。
3. **Environment Variables** に `.env.local` と同じ内容を登録
   （`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / 音声を使うなら
   `GROQ_API_KEY` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`）。
4. Deploy。発行された URL を、手順5の Supabase「URL Configuration」の
   Site URL / Redirect URLs に追加。

---

## 自動削除の仕組み

- 短期メモは作成から **7日** で自動的にゴミ箱へ移動します。
- ゴミ箱のメモは **30日** で完全削除されます。
- これらは Supabase 上の `pg_cron` が **毎日 1回**（日本時間 午前3時）実行します。
  日数は [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) と
  [`lib/types.ts`](lib/types.ts) の定数で調整できます。

---

## 技術構成

| レイヤー | 技術 |
|---|---|
| フロントエンド | Next.js 14（App Router）+ TypeScript + Tailwind CSS |
| PWA | @ducanh2912/next-pwa |
| 認証・DB・ストレージ | Supabase |
| 音声文字起こし | Groq Whisper (whisper-large-v3) |
| テキスト整形 | Claude API (claude-opus-4-8) |
| 自動削除バッチ | Supabase pg_cron |
| ホスティング | Vercel |

## フォルダ構成（概要）

```
app/            画面とAPIルート（App Router）
  api/transcribe  Groq 文字起こし
  api/format      Claude 整形
components/      UI コンポーネント
lib/            Supabase クライアント・型・ストア・ユーティリティ
supabase/       DB マイグレーション（SQL）
scripts/        アイコン生成スクリプト
public/         PWA マニフェスト・アイコン
```
