-- ============================================================
-- リアルタイム同期の有効化
-- ============================================================
-- アプリ側 (lib/store.tsx) は supabase-js の postgres_changes で
-- notes / folders の変更を購読しているが、テーブルが Supabase Realtime の
-- publication (supabase_realtime) に登録されていないとイベントが一切
-- 配信されず、「他端末の変更が反映されない＝同期が遅い」状態になる。
--
-- このマイグレーションは冪等（何度実行しても安全）。
-- ============================================================

-- 1) publication が無ければ作成（通常 Supabase では既に存在する）
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

-- 2) notes / folders を publication に追加（未登録の場合のみ）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'folders'
  ) then
    alter publication supabase_realtime add table public.folders;
  end if;
end $$;

-- 3) REPLICA IDENTITY FULL
--    既定 (primary key) だと DELETE イベントの old レコードに id しか含まれず、
--    購読側の filter (user_id=eq.<自分のID>) に一致せず削除が同期されない。
--    FULL にすると old に全列が入るため、フィルタが効き削除も即時反映される。
alter table public.notes   replica identity full;
alter table public.folders replica identity full;
