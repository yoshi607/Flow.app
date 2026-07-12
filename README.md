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

複数端末で即時同期するための設定です。

1. 左メニュー **「Database」→「Replication」**（または Table Editor の各テーブル設定）へ。
2. `notes` と `folders` テーブルの **Realtime を ON** にする。

### 4. ストレージ（画像・添付用／将来の拡張向け）

1. 左メニュー **「Storage」→「New bucket」**。
2. 名前を `attachments` にして作成（Public は OFF のままで可）。

> 画像添付機能は今後のフェーズで使います。今すぐ使わなければスキップしても構いません。

### 5. 認証（ログイン方法）の設定

1. 左メニュー **「Authentication」→「Providers」**。
2. **Email** が有効になっていることを確認（既定で有効）。
   - すぐ試したい場合は「Confirm email」を一時的に OFF にするとメール確認なしで登録できます。
3. （任意）**Google ログイン**を使う場合は Google プロバイダを有効化し、
   Google Cloud で OAuth クライアントを作成して Client ID / Secret を設定します。
4. 「Authentication」→「URL Configuration」で **Site URL** に
   ローカル開発なら `http://localhost:3000` を設定。
   （Vercel 公開後は公開URLも「Redirect URLs」に追加してください）

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
