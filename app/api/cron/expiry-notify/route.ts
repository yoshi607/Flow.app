import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush, { WebPushError } from "web-push";
import { displayTitle } from "@/lib/utils";

// web-push は Node の crypto に依存するため Edge では動かない
export const runtime = "nodejs";
// cron から毎回その時点のデータを見る必要があるのでキャッシュしない
export const dynamic = "force-dynamic";

// 通知の種類。push_notifications_sent.kind に入る値。
const KIND = "expiry_2d";
// 期限まで何日以内のメモを対象にするか
const WITHIN_DAYS = 2;
// 1行に並べるメモのタイトル数の上限（超えた分は「ほか◯件」にまとめる）
const MAX_TITLES = 3;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type NoteRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  expires_at: string;
};

/** 通知用に「残り日数」と「表示名」を添えたメモ */
type NoteForNotify = {
  id: string;
  name: string;
  daysLeft: number;
};

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * ある時刻が属する「JST の暦日の 00:00」を UTC のミリ秒で返す。
 *
 * expires_at は時刻付き（timestamptz）なので、そのまま引き算すると
 * 「23時間差なら0日」のような直感に反する結果になる。暦日に丸めてから
 * 比較することで、「本日中」「あと1日」が見た目どおりになる。
 * JST は UTC+9 固定（夏時間なし）。
 */
function jstDayStartUtcMs(ms: number): number {
  const jst = new Date(ms + JST_OFFSET_MS);
  return (
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) -
    JST_OFFSET_MS
  );
}

/** 通知のタイトルと本文を組み立てる */
function buildMessage(notes: NoteForNotify[]): {
  title: string;
  body: string;
  url: string;
} {
  // 期限が近い順に並べてから「本日中」と「2日以内」に振り分ける。
  // 期限を過ぎたまま残っているメモ（自動削除バッチ前など）は
  // マイナスになりうるので「本日中」に含める。
  const sorted = [...notes].sort((a, b) => a.daysLeft - b.daysLeft);
  const today = sorted.filter((n) => n.daysLeft <= 0);
  const soon = sorted.filter((n) => n.daysLeft >= 1);

  const line = (label: string, list: NoteForNotify[]) => {
    const shown = list
      .slice(0, MAX_TITLES)
      .map((n) => n.name)
      .join(" / ");
    const rest = list.length - MAX_TITLES;
    return `${label} ${list.length}件：${shown}${rest > 0 ? ` ほか${rest}件` : ""}`;
  };

  const lines: string[] = [];
  if (today.length > 0) lines.push(line("本日中", today));
  if (soon.length > 0) lines.push(line(`${WITHIN_DAYS}日以内`, soon));

  return {
    title: `${WITHIN_DAYS}日以内に消去予定のメモがあります【${notes.length}件】`,
    body: lines.join("\n"),
    // 1件だけならそのメモを直接開く。複数なら短期メモ一覧へ。
    url: sorted.length === 1 ? `/note/${sorted[0].id}` : "/?view=short",
  };
}

export async function GET(request: Request) {
  // --- 認証。Vercel Cron は CRON_SECRET を Bearer で送ってくる ---
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET が設定されていません" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceRoleKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    return NextResponse.json(
      { error: "通知に必要な環境変数が不足しています" },
      { status: 500 },
    );
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  // 全ユーザーを横断して読むので service role を使う（RLS を迂回する）。
  // このキーはこのファイル以外から読まないこと。
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- 1) 期限まで WITHIN_DAYS 日以内のメモを集める ---
  //
  // 「ちょうど2日前」ではなく「2日以内」で拾う。日次実行なので一点狙いだと、
  // 保存日数を短く設定したメモ（1日など）がその瞬間を飛び越えてしまい、
  // 一度も通知されないため。過去に通知済みでも、条件を満たす限り毎日通知する。
  const todayStartMs = jstDayStartUtcMs(Date.now());
  // JST の (今日 + WITHIN_DAYS) 日の翌日 00:00 まで＝暦日で「今日+2」以下
  const windowEndMs = todayStartMs + (WITHIN_DAYS + 1) * DAY_MS;

  const { data: notes, error: notesError } = await supabase
    .from("notes")
    .select("id, user_id, title, body, expires_at")
    .eq("type", "short")
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lt("expires_at", new Date(windowEndMs).toISOString());

  if (notesError) {
    return NextResponse.json(
      { error: `メモの取得に失敗: ${notesError.message}` },
      { status: 500 },
    );
  }
  if (!notes || notes.length === 0) {
    return NextResponse.json({ ok: true, targets: 0, sent: 0 });
  }

  // --- 2) ユーザーごとにまとめる（1ユーザー1通） ---
  const byUser = new Map<string, NoteForNotify[]>();
  for (const row of notes as NoteRow[]) {
    const daysLeft = Math.round(
      (jstDayStartUtcMs(Date.parse(row.expires_at)) - todayStartMs) / DAY_MS,
    );
    const item: NoteForNotify = {
      id: row.id,
      // 一覧の表示と文言を揃える（タイトル未入力なら本文1行目 or「無題のメモ」）
      name: displayTitle(row.title, row.body),
      daysLeft,
    };
    const list = byUser.get(row.user_id);
    if (list) list.push(item);
    else byUser.set(row.user_id, [item]);
  }

  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", Array.from(byUser.keys()));

  if (subsError) {
    return NextResponse.json(
      { error: `購読情報の取得に失敗: ${subsError.message}` },
      { status: 500 },
    );
  }

  const subsByUser = new Map<string, SubscriptionRow[]>();
  for (const s of subs ?? []) {
    const row = s as SubscriptionRow & { user_id: string };
    const list = subsByUser.get(row.user_id);
    if (list) list.push(row);
    else subsByUser.set(row.user_id, [row]);
  }

  // --- 3) 配信 ---
  let sentCount = 0;
  const notifiedNoteIds: string[] = [];
  const deadEndpoints: string[] = [];

  // tsconfig の target が ES5 のため Map を直接 for...of できない。
  for (const [userId, userNotes] of Array.from(byUser.entries())) {
    const userSubs = subsByUser.get(userId);
    // 通知をONにしていないユーザーは宛先が無い
    if (!userSubs || userSubs.length === 0) continue;

    const payload = JSON.stringify({ ...buildMessage(userNotes), tag: KIND });

    // 同じユーザーの端末すべてへ送る。1台でも成功すれば「通知した」とみなす。
    let deliveredToAny = false;
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        deliveredToAny = true;
        sentCount++;
      } catch (err) {
        // 404/410 は「その宛先はもう存在しない」の意味。アプリを消した、
        // 通知を切った等で起きる。放置すると毎日失敗し続けるので行ごと消す。
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          deadEndpoints.push(sub.endpoint);
        } else {
          console.error("プッシュ送信に失敗:", sub.endpoint, err);
        }
      }
    }

    if (deliveredToAny) {
      notifiedNoteIds.push(...userNotes.map((n) => n.id));
    }
  }

  // --- 4) 後始末 ---
  // push_notifications_sent は「最後にいつ通知したか」の記録（ログ）。
  // 以前は二重送信を防ぐ抑制リストとして使っていたが、2日以内なら毎日
  // 通知する方針にしたため、いまは配信の判定には使っていない。
  // 動作確認（バッチが走ったか）のために残している。
  if (notifiedNoteIds.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("push_notifications_sent")
      .upsert(
        notifiedNoteIds.map((note_id) => ({ note_id, kind: KIND, sent_at: now })),
        { onConflict: "note_id,kind" },
      );
    if (error) console.error("送信ログの記録に失敗:", error.message);
  }

  if (deadEndpoints.length > 0) {
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .in("endpoint", deadEndpoints);
    if (error) console.error("無効な購読の削除に失敗:", error.message);
  }

  return NextResponse.json({
    ok: true,
    targets: notes.length,
    users: byUser.size,
    sent: sentCount,
    removedSubscriptions: deadEndpoints.length,
  });
}
