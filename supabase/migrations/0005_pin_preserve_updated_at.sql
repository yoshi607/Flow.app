-- ------------------------------------------------------------
--  ピン留めのトグルでは編集日時(updated_at)を更新しない
-- ------------------------------------------------------------
-- 既定の set_updated_at() は BEFORE UPDATE で常に updated_at = now() にするため、
-- ピン留め/解除だけの更新でも編集日時が動いてしまう。pinned 以外の内容列が
-- すべて不変（＝ピン留めのトグルのみ）のときは、編集日時を据え置くようにする。
-- それ以外の更新は従来どおり now() に更新する。
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  if new.pinned is distinct from old.pinned
     and new.folder_id  is not distinct from old.folder_id
     and new.title      is not distinct from old.title
     and new.body       is not distinct from old.body
     and new.type       is not distinct from old.type
     and new.status     is not distinct from old.status
     and new.tags       is not distinct from old.tags
     and new.expires_at is not distinct from old.expires_at
     and new.trashed_at is not distinct from old.trashed_at
  then
    new.updated_at = old.updated_at; -- ピン留めのみ → 編集日時を据え置く
  else
    new.updated_at = now();
  end if;
  return new;
end $$;

-- トリガー自体は関数名で参照しているため貼り替え不要（0001 で作成済み）。
