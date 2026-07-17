import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// 認証メール・OAuth からのコールバック。次の2方式に対応する。
//
//  1) ?code=...            … OAuth(Google) / PKCE のマジックリンク。
//                            申請したブラウザに残る code_verifier が必要。
//  2) ?token_hash=&type=   … メールリンク（パスワード再設定など）。
//                            検証キー不要で、どのブラウザで開いても成立する。
//                            メールアプリが内蔵ブラウザで開くケースがあるため、
//                            再設定メールはこちらの方式を使う。
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
