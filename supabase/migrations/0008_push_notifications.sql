-- ============================================================
--  プッシュ通知（短期メモの期限リマインド）
-- ============================================================
--  短期メモが「期限の2日前」になったとき、ホーム画面に追加した PWA へ
--  OS 通知を送るための2テーブルを作る。
--
--   1) push_subscriptions      … 端末ごとの通知の宛先（購読情報）
--   2) push_notifications_sent … 送信済みの記録（二重送信の防止）
--
--  実際の送信は Vercel Cron が毎日 JST 09:00 に
--  /api/cron/expiry-notify を叩いて行う（DB 側には cron を足さない）。
--
--  このマイグレーションは冪等（何度実行しても安全）。
-- ============================================================

-- ------------------------------------------------------------
--  1) push_subscriptions
--     ブラウザの PushSubscription をそのまま保存する。
--     1ユーザーが複数端末（iPhone / iPad / PC）を持つので、
--     user_id は一意にせず endpoint を一意キーにする。
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- プッシュサービス（FCM / APNs 等）が発行する宛先 URL。端末ごとに一意。
  endpoint   text not null unique,
  -- 送信内容の暗号化に使う鍵（subscription.getKey() の値）
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- 本人の購読だけ読み書きできる。
-- ※ 送信側（cron）は service role で動くため RLS を迂回する。
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id);
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
--  2) push_notifications_sent
--     「このメモについて、この種類の通知はもう送った」という記録。
--     主キーを (note_id, kind) にすることで、cron を何度叩いても
--     同じメモの通知が二度飛ばない。
--
--     notes に列を足す方式は採らない。0005 / 0006 で updated_at を
--     保持するトリガーが列ごとに書かれており、列追加がその条件分岐と
--     端末間同期の挙動に波及するため。
-- ------------------------------------------------------------
create table if not exists public.push_notifications_sent (
  note_id uuid not null references public.notes (id) on delete cascade,
  -- 通知の種類。今は 'expiry_2d'（期限2日前）のみ。
  -- 将来ゴミ箱の完全削除予告などを足す場合はここを増やす。
  kind    text not null,
  sent_at timestamptz not null default now(),
  primary key (note_id, kind)
);

alter table public.push_notifications_sent enable row level security;

-- このテーブルは送信側（service role）だけが読み書きする。
-- authenticated 向けのポリシーは作らない＝アプリからは一切見えない。

-- ------------------------------------------------------------
--  テーブルレベルの権限付与（アプリ側 / authenticated）
--  push_subscriptions のみ。push_notifications_sent は
--  送信側専用なので authenticated には渡さない。
-- ------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ------------------------------------------------------------
--  テーブルレベルの権限付与（配信バッチ / service_role）
--
--  配信バッチ(/api/cron/expiry-notify)は service_role で動く。
--  service_role は RLS（行単位の制御）は迂回するが、テーブルレベルの
--  権限（GRANT）は別物で、無いと
--    permission denied for table notes
--  になる。このプロジェクトのテーブルは SQL Editor から作られており、
--  0001 / 0007 では authenticated にしか GRANT していないため、
--  ここで service_role にも明示的に与える。
--
--  与えるのは配信バッチが実際に使う操作だけに絞る：
--   - notes                   … 期限が近いメモを探す（読むだけ）
--   - push_subscriptions      … 宛先を読む／無効になった宛先を消す
--   - push_notifications_sent … 送信済みを読む／記録する（upsert=insert+update）
-- ------------------------------------------------------------
grant usage on schema public to service_role;
grant select on public.notes to service_role;
grant select, delete on public.push_subscriptions to service_role;
grant select, insert, update on public.push_notifications_sent to service_role;
