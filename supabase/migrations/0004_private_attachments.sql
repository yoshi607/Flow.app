-- ============================================================
--  添付ファイルを「非公開」に変更する
--  Supabase ダッシュボード > SQL Editor に貼り付けて実行してください。
--
--  変更前は attachments バケットが public=true で、URL さえ知っていれば
--  ログイン不要で誰でも画像を閲覧できる状態だった。
--  本マイグレーションでバケットを非公開にし、読み取りも「本人のみ」に制限する。
--  アプリ側は署名付きURL（createSignedUrl）で表示する実装に変更済み。
--  何度実行しても安全（冪等）。
-- ============================================================

-- 1) バケットを非公開にする（既存の attachments バケットを更新）
update storage.buckets
   set public = false
 where id = 'attachments';

-- 2) 読み取りポリシーを「本人のファイルのみ」に差し替える
--    保存パスは {user_id}/{note_id}/... なので、先頭フォルダ（= user_id）が
--    自分自身のときだけ読み取りを許可する。
--    （旧 0002 の select ポリシーは bucket 全体を公開していたため置き換える）
drop policy if exists "attachments_storage_select" on storage.objects;
create policy "attachments_storage_select" on storage.objects
  for select using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3) insert / delete ポリシーは 0002 で既に本人限定。念のため再定義しておく（冪等）。
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
