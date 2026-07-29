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
// 期限の何日前に通知するか
const DAYS_BEFORE = 2;
// 通知本文に並べるメモのタイトル数の上限
const MAX_TITLES = 3;

type NoteRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
};

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * 「JST の暦日で DAYS_BEFORE 日後」の1日ぶんを UTC の範囲で返す。
 *
 * expires_at は timestamptz なので、日付だけで比較するには範囲に直す必要がある。
 * JST(UTC+9・夏時間なし) の D 日は UTC では [D 00:00 - 9h, D+1 00:00 - 9h)。
 */
function targetDayRangeUtc(): { start: Date; end: Date } {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // 「いまの JST の日付」を取り出す。9時間ずらした時刻の UTC 表記を読めばよい。
  const nowJst = new Date(Date.now() + JST_OFFSET_MS);
  const y = nowJst.getUTCFullYear();
  const m = nowJst.getUTCMonth();
  const d = nowJst.getUTCDate();

  // 対象日の JST 00:00 を UTC に直す（月跨ぎ・年跨ぎは Date.UTC が吸収する）
  const startMs = Date.UTC(y, m, d + DAYS_BEFORE, 0, 0, 0, 0) - JST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/** 通知のタイトルと本文を組み立てる */
function buildMessage(notes: NoteRow[]): { title: string; body: string; url: string } {
  const titles = notes.map((n) => displayTitle(n.title, n.body));

  // 1件だけの日は、そのメモの名前を出してタップで直接開けるようにする
  if (notes.length === 1) {
    return {
      title: `「${titles[0]}」があと${DAYS_BEFORE}日でゴミ箱に移動します`,
      body: "",
      url: `/note/${notes[0].id}`,
    };
  }

  // 複数件はまとめて1通。本文にタイトルを並べ、多すぎる分は件数で省略する。
  const shown = titles.slice(0, MAX_TITLES).join(" / ");
  const rest = titles.length - MAX_TITLES;
  return {
    title: `${notes.length}件の短期メモが${DAYS_BEFORE}日後にゴミ箱へ移動します`,
    body: rest > 0 ? `${shown} … ほか${rest}件` : shown,
    url: "/?view=short",
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

  // --- 1) 対象のメモを集める ---
  const { start, end } = targetDayRangeUtc();
  const { data: notes, error: notesError } = await supabase
    .from("notes")
    .select("id, user_id, title, body")
    .eq("type", "short")
    .eq("status", "active")
    .gte("expires_at", start.toISOString())
    .lt("expires_at", end.toISOString());

  if (notesError) {
    return NextResponse.json(
      { error: `メモの取得に失敗: ${notesError.message}` },
      { status: 500 },
    );
  }
  if (!notes || notes.length === 0) {
    return NextResponse.json({ ok: true, targets: 0, sent: 0 });
  }

  // --- 2) 送信済みを除く ---
  const { data: sentRows, error: sentError } = await supabase
    .from("push_notifications_sent")
    .select("note_id")
    .eq("kind", KIND)
    .in(
      "note_id",
      notes.map((n) => n.id),
    );

  if (sentError) {
    return NextResponse.json(
      { error: `送信履歴の取得に失敗: ${sentError.message}` },
      { status: 500 },
    );
  }

  const alreadySent = new Set((sentRows ?? []).map((r) => r.note_id as string));
  const pending = (notes as NoteRow[]).filter((n) => !alreadySent.has(n.id));
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, targets: notes.length, sent: 0 });
  }

  // --- 3) ユーザーごとにまとめる（1ユーザー1通） ---
  const byUser = new Map<string, NoteRow[]>();
  for (const n of pending) {
    const list = byUser.get(n.user_id);
    if (list) list.push(n);
    else byUser.set(n.user_id, [n]);
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

  // --- 4) 配信 ---
  let sentCount = 0;
  const notifiedNoteIds: string[] = [];
  const deadEndpoints: string[] = [];

  // tsconfig の target が ES5 のため Map を直接 for...of できない。
  // Array.from で配列に直してから回す（keys() 側と同じ書き方）。
  for (const [userId, userNotes] of Array.from(byUser.entries())) {
    const userSubs = subsByUser.get(userId);
    // 通知をONにしていないユーザーは宛先が無い。ここで記録も残さないので、
    // 後から通知をONにすれば次回以降のメモから届くようになる。
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

    // 1台も届かなかったユーザーは記録を残さない（次回の実行で再挑戦する）
    if (deliveredToAny) {
      notifiedNoteIds.push(...userNotes.map((n) => n.id));
    }
  }

  // --- 5) 後始末：送信済みの記録と、無効になった宛先の削除 ---
  if (notifiedNoteIds.length > 0) {
    const { error } = await supabase
      .from("push_notifications_sent")
      .upsert(
        notifiedNoteIds.map((note_id) => ({ note_id, kind: KIND })),
        { onConflict: "note_id,kind" },
      );
    if (error) console.error("送信履歴の記録に失敗:", error.message);
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
