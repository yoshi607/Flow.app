import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// この端末を通知の宛先から外す
export async function POST(request: Request) {
  const userId = headers().get("x-user-id");
  if (!userId) {
    return NextResponse.json(
      { error: "アプリの認証エラー：ログインし直してください" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string") {
    return NextResponse.json(
      { error: "endpoint がありません" },
      { status: 400 },
    );
  }

  const supabase = createClient();

  // user_id も条件に入れる。RLS でも本人の行しか消せないが、
  // 他人の endpoint を指定された場合に「消えた」と誤解させないため明示する。
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json(
      { error: `通知の解除に失敗しました: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
