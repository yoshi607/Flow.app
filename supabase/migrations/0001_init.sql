-- ============================================================
--  メモアプリ 初期スキーマ
--  Supabase ダッシュボード > SQL Editor に貼り付けて実行してください。
-- ============================================================

-- UUID 生成用（Supabase では既定で有効なことが多いが念のため）
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
--  folders テーブル
-- ------------------------------------------------------------
create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists folders_user_id_idx on public.folders (user_id);

-- ------------------------------------------------------------
--  notes テーブル
-- ------------------------------------------------------------
do $$ begin
  create type note_type as enum ('short', 'long');
exception when duplicate_object then null; end $$;

do $$ begin
  create type note_status as enum ('active', 'trashed');
exception when duplicate_object then null; end $$;

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  folder_id   uuid references public.folders (id) on delete set null,
  title       text not null default '',
  body        text not null default '',
  type        note_type   not null default 'long',
  status      note_status not null default 'active',
  pinned      boolean not null default false,
  tags        text[] not null default '{}',
  expires_at  timestamptz,           -- 短期メモがゴミ箱行きになる予定日時（作成から7日後）
  trashed_at  timestamptz,           -- ゴミ箱に入った日時（30日で完全削除）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_user_id_idx      on public.notes (user_id);
create index if not exists notes_folder_id_idx    on public.notes (folder_id);
create index if not exists notes_status_idx       on public.notes (status);
create index if not exists notes_expires_at_idx   on public.notes (expires_at);
create index if not exists notes_trashed_at_idx   on public.notes (trashed_at);

-- 全文検索用（タイトル + 本文）
create index if not exists notes_search_idx
  on public.notes using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'')));

-- ------------------------------------------------------------
--  attachments テーブル
-- ------------------------------------------------------------
create table if not exists public.attachments (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes (id) on delete cascade,
  file_url   text not null,
  file_path  text,                 -- Storage 上のパス（完全削除時に使用）
  type       text not null default 'image',
  created_at timestamptz not null default now()
);

create index if not exists attachments_note_id_idx on public.attachments (note_id);

-- ------------------------------------------------------------
--  updated_at 自動更新トリガー
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
--  Row Level Security（本人のデータのみアクセス可）
-- ------------------------------------------------------------
alter table public.folders     enable row level security;
alter table public.notes       enable row level security;
alter table public.attachments enable row level security;

-- folders
drop policy if exists "folders_select_own" on public.folders;
create policy "folders_select_own" on public.folders
  for select using (auth.uid() = user_id);
drop policy if exists "folders_insert_own" on public.folders;
create policy "folders_insert_own" on public.folders
  for insert with check (auth.uid() = user_id);
drop policy if exists "folders_update_own" on public.folders;
create policy "folders_update_own" on public.folders
  for update using (auth.uid() = user_id);
drop policy if exists "folders_delete_own" on public.folders;
create policy "folders_delete_own" on public.folders
  for delete using (auth.uid() = user_id);

-- notes
drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);
drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id);
drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes
  for update using (auth.uid() = user_id);
drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id);

-- attachments（親メモが本人のものかで判定）
drop policy if exists "attachments_all_own" on public.attachments;
create policy "attachments_all_own" on public.attachments
  for all using (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- ------------------------------------------------------------
--  テーブルレベルの権限付与
--  RLS ポリシーは「行単位」の制御。それとは別に、そもそも
--  authenticated ロールがテーブルへ SQL アクセスしてよいという
--  「テーブルレベル」の権限（GRANT）も必要。SQL Editor から直接
--  テーブルを作った場合は自動付与されないため、明示的に付与する。
--  実際のアクセス制御は上記の RLS ポリシーが行うため、ここでの
--  GRANT は「土台」であり、セキュリティ上の抜け道にはならない。
-- ------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.folders     to authenticated;
grant select, insert, update, delete on public.notes       to authenticated;
grant select, insert, update, delete on public.attachments to authenticated;

-- ------------------------------------------------------------
--  自動削除ロジック（バッチ処理）
--  1) 期限切れの短期メモをゴミ箱へ
--  2) ゴミ箱に30日以上あるメモを完全削除
-- ------------------------------------------------------------
create or replace function public.run_note_cleanup()
returns void language plpgsql security definer as $$
begin
  -- 1) 短期メモの自動ゴミ箱行き
  update public.notes
     set status = 'trashed',
         trashed_at = now()
   where type = 'short'
     and status = 'active'
     and expires_at is not null
     and expires_at <= now();

  -- 2) ゴミ箱30日経過分を完全削除（attachments は ON DELETE CASCADE で連鎖削除）
  --    ※ Storage 上の実ファイル削除は別途 Edge Function / アプリ側で対応
  delete from public.notes
   where status = 'trashed'
     and trashed_at is not null
     and trashed_at <= now() - interval '30 days';
end $$;

-- ------------------------------------------------------------
--  pg_cron スケジュール（毎日 午前3時 JST = UTC 18:00 に実行）
--  pg_cron 拡張が必要: Supabase ダッシュボード > Database > Extensions で
--  "pg_cron" を有効化してから、この部分を実行してください。
-- ------------------------------------------------------------
create extension if not exists pg_cron;

-- 既存の同名ジョブがあれば削除してから登録
do $$
begin
  perform cron.unschedule('note_cleanup_daily');
exception when others then null;
end $$;

select cron.schedule(
  'note_cleanup_daily',
  '0 18 * * *',                       -- UTC 18:00 = JST 03:00
  $$ select public.run_note_cleanup(); $$
);
