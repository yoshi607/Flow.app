# Flow アプリ 引継ぎメモ

作成日: 2026-07-14

iPhone / iPad / Windows で同期するクラウドメモPWA「Flow」の開発状況まとめ。

## リンク

- GitHubリポジトリ: https://github.com/yoshi607/Flow.app
- 本番URL（Vercel）: https://flow-app-omega-self.vercel.app
- セットアップ手順の詳細: [`README.md`](README.md)

## 技術構成

| レイヤー | 技術 |
|---|---|
| フロントエンド | Next.js 14（App Router）+ TypeScript + Tailwind CSS |
| リッチテキスト編集 | Tiptap（`@tiptap/react` ほか） |
| PWA | @ducanh2912/next-pwa |
| 認証・DB・ファイル保存 | Supabase（Postgres / Auth / Realtime / Storage） |
| 音声文字起こし | Groq Whisper (whisper-large-v3) |
| テキスト整形 | Claude API (`claude-opus-4-8`) |
| 自動削除バッチ | Supabase pg_cron |
| ホスティング | Vercel（GitHub連携で自動デプロイ） |

## 実装済み機能

- メモの作成・編集・削除、フォルダ整理、タグ、ピン留め、全画面表示、別ウィンドウ表示
- **短期メモ**（作成から7日で自動的にゴミ箱へ。新規作成時のデフォルト）と**長期メモ**をワンタップで切替
- ゴミ箱（30日で完全削除・復元可能・カウントダウン表示）
- 全端末でのリアルタイム同期（Supabase Realtime。`notes`/`folders`テーブルのみ対象）
- 横断検索（タイトル・本文・フォルダ名・タグ。ゴミ箱は対象外）
- **リッチテキスト編集**（Tiptap導入）
  - 見出し1〜3・本文の切替（`#`/`##`/`###` + 半角スペースのマークダウン入力にも対応）
  - 太字・斜体・下線（`**text**`・`*text*`のマークダウン入力にも対応）
  - 文字色5色（ブルー・ミント・オレンジ・ピンク・パープル）
  - キーボードショートカット（Ctrl/Cmd+B/I/U、Ctrl/Cmd+Alt+1〜3）
  - 見出しに変換した空行には「見出し1」等のプレースホルダーを表示
  - 本文は`notes.body`列にHTML文字列として保存。旧形式のプレーンテキストは開いた時点で自動的にHTML（段落）へ移行される
- **ファイル・写真の添付**（クリップアイコン→Supabase Storageへアップロード→本文下に一覧表示。画像はサムネイル、その他はファイル名+サイズのチップ）
- **音声メモ**（録音 → Groq Whisperで文字起こし → Claudeで整形・タイトル自動生成 → 本文末尾に追記）
- PWA対応（ホーム画面に追加してアプリのように使用可。ライト/ダークでアイコン・faviconが切り替わる）

## DBマイグレーション（Supabase SQL Editorで実行が必要）

1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — 初期スキーマ（notes/folders/attachments、RLS、pg_cronによる自動削除）
2. [`supabase/migrations/0002_attachments_storage.sql`](supabase/migrations/0002_attachments_storage.sql) — 添付ファイル用のStorageバケットとファイル名/サイズ列を追加

両方とも実行済み（本番環境で動作確認済み）。今後DBをリセットする場合は両方を順番に実行すること。

## 既知の制約・未対応事項

- 添付ファイルはRealtime購読の対象外（同じメモを他デバイスで同時に開いて添付操作をした場合、即時反映されない）
- ゴミ箱メモの完全削除時、DB行は消えるがSupabase Storage上の実ファイルは削除されない（残存する）
- 添付ファイル用Storageバケットは「公開（public）」設定。URLはランダムなUUIDベースで推測困難だが、厳密な非公開が必要な場合は署名付きURL方式への変更が必要
- Postgresの全文検索用GINインデックス（`0001_init.sql`）はアプリ側で未使用（検索はクライアント側フィルタで実装）
- SPEC.md記載のフェーズ2機能（Notion連携・既存メモインポート・Web Push通知・編集履歴・テンプレート）は未着手

## 直近の主なバグ修正（時系列）

- 短期メモの「短期（7日）」ボタンを、既に短期の状態で再度押すと期限が延長されてしまうバグを修正（`lib/store.tsx`の`setNoteType`にガードを追加）
- リッチテキストの見出し機能で、選択していない別の行やメモ全体まで見出しサイズが変わってしまうバグを修正
  - 原因: 空白行のない複数行メモが内部的に1つの段落（`<br>`区切り）として扱われ、見出しが段落単位で適用されるTiptapの仕様上、意図しない範囲まで巻き込まれていた
  - 対応: 新規移行時は1行=1段落に分割。さらに、修正前の状態で既に保存されてしまった壊れたメモも、開くたびに自動修復する処理を追加
- iOS Safariで真っ白画面になる不具合を調査したが、最終的な原因は写真からの文字認識（OCR）でURLが誤読されていたことによるもの（アプリ自体のバグではなかった）

## 今後の対応候補

- 添付ファイルのRealtime対応（他デバイスとの同時編集を厳密にサポートする場合）
- Storage非公開化（署名付きURL方式への切替）
- SPEC.mdフェーズ2機能の着手判断
