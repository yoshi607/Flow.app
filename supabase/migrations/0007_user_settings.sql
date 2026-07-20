-- ============================================================
-- ユーザーごとの設定（user_settings）
-- ============================================================
-- 短期メモが自動でゴミ箱へ行くまでの日数を、設定画面から
-- 変更できるようにするためのテーブル。
-- 端末ごとではなくアカウント単位で持つため、どの端末で変更しても
-- 同じ設定になる。
--
-- 既存メモの expires_at は設定変更では書き換えない（＝設定変更後に
-- 作成した短期メモから新しい日数が適用される）。自動削除バッチ
-- (public.run_note_cleanup) は expires_at をそのまま見るだけなので、
-- バッチ側の変更は不要。
--
-- このマイグレーションは冪等（何度実行しても安全）。
-- ※ 初版はトリガー関数に notes 専用の public.set_updated_at() を
--    流用しており、設定の保存が
--      record "new" has no field "title"
--    で失敗した。初版を適用済みの環境も、このファイルをもう一度
--    最後まで実行すれば直る。
-- ============================================================

create table if not exists public.user_settings (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  -- 短期メモの有効日数（作成からこの日数でゴミ箱行き）
  short_note_days int not null default 7 check (short_note_days between 1 and 365),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- updated_at 自動更新。
-- 共通名の public.set_updated_at() は 0006 で notes 専用
-- （new.title / new.body などを参照する）になっているため流用できない。
-- 流用すると user_settings の更新時に
--   record "new" has no field "title"
-- で失敗するので、このテーブル専用の関数を用意する。
create or replace function public.set_user_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_user_settings_updated_at();

-- ------------------------------------------------------------
--  Row Level Security（本人の設定のみアクセス可）
-- ------------------------------------------------------------
alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own" on public.user_settings
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_settings to authenticated;

-- ------------------------------------------------------------
--  リアルタイム同期（他端末で設定を変えたら即反映させる）
--  0003_realtime.sql と同じ考え方。
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
end $$;

alter table public.user_settings replica identity full;
