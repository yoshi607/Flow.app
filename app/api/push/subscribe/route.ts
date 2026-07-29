import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// この端末を通知の宛先として登録する（ブラウザの PushSubscription を保存）
export async function POST(request: Request) {
  // ログイン必須。ミドルウェアが検証済みユーザーを x-user-id ヘッダーで渡すので
  // それを信頼する（transcribe と同じ方式に統一）。
  const userId = headers().get("x-user-id");
  if (!userId) {
    return NextResponse.json(
      { error: "アプリの認証エラー：ログインし直してください" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string"
  ) {
    return NextResponse.json(
      { error: "購読情報の形式が正しくありません" },
      { status: 400 },
    );
  }

  const supabase = createClient();

  // 同じ端末で再登録された場合に行が増えないよう endpoint で upsert する。
  // user_id も更新するので、同じ端末を別アカウントで使い直した場合も
  // 宛先が新しい持ち主へ移る（前の持ち主宛には飛ばない）。
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint, p256dh, auth },
      { onConflict: "endpoint" },
    );

  if (error) {
    return NextResponse.json(
      { error: `通知の登録に失敗しました: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
