-- ============================================================
--  添付ファイル機能 追加スキーマ
--  Supabase ダッシュボード > SQL Editor に貼り付けて実行してください。
-- ============================================================

-- ------------------------------------------------------------
--  attachments テーブルにファイル名・サイズ列を追加
-- ------------------------------------------------------------
alter table public.attachments add column if not exists file_name text;
alter table public.attachments add column if not exists file_size bigint;

-- ------------------------------------------------------------
--  Storage バケット作成（公開読み取り・書き込みは本人のみ）
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

-- 保存パスは {user_id}/{note_id}/{ランダムID}-{ファイル名} という構成にし、
-- 先頭フォルダ（= user_id）が自分自身のときだけ書き込み・削除を許可する。
drop policy if exists "attachments_storage_select" on storage.objects;
create policy "attachments_storage_select" on storage.objects
  for select using (bucket_id = 'attachments');

drop policy if exists "attachments_storage_insert" on storage.objects;
create policy "attachments_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments_storage_delete" on storage.objects;
create policy "attachments_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
