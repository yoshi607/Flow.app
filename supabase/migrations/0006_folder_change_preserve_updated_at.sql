-- ------------------------------------------------------------
--  フォルダの変更・削除では編集日時(updated_at)を更新しない
-- ------------------------------------------------------------
-- notes.folder_id は ON DELETE SET NULL なので、フォルダを削除すると
-- その中のメモが DB 側で UPDATE される。BEFORE UPDATE の set_updated_at() が
-- 常に now() を入れていたため、中身を触っていないのに全メモの編集日時が動き、
-- 一覧（updated_at 降順）で「たった今編集した」ように並び替わってしまっていた。
--
-- 0005 では pinned だけを例外にしていたが、列を増やすたびに条件を足す形だと
-- 漏れる。ここでは考え方を逆にして「内容列が1つも変わっていなければ据え置く」
-- とする。pinned と folder_id はメモの中身ではなく整理用の情報なので、
-- これらだけの変更（ピン留め、フォルダ移動、フォルダ削除に伴う NULL 化）では
-- 編集日時を動かさない。内容列が変わったときは従来どおり now() にする。
--
-- 0005 を適用済みでも未適用でも、この定義で上書きされる（create or replace）。
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  if new.title      is not distinct from old.title
     and new.body       is not distinct from old.body
     and new.type       is not distinct from old.type
     and new.status     is not distinct from old.status
     and new.tags       is not distinct from old.tags
     and new.expires_at is not distinct from old.expires_at
     and new.trashed_at is not distinct from old.trashed_at
  then
    new.updated_at = old.updated_at; -- 内容は不変 → 編集日時を据え置く
  else
    new.updated_at = now();
  end if;
  return new;
end $$;

-- トリガー自体は関数名で参照しているため貼り替え不要（0001 で作成済み）。
