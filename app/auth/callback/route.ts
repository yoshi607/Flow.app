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
  // 外部サイトへの誘導（オープンリダイレクト）を防ぐため、
  // 自サイト内の絶対パスだけを受け付ける（"//evil.com" も弾く）。
  const nextParam = searchParams.get("next") ?? "/";
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  // Vercel ではリクエストがプロキシ経由で届くため、request.url の origin が
  // 内部ホスト（http://…）になり、公開URLと食い違うことがある。
  // プロキシが付ける x-forwarded-host を優先して公開URLを組み立てる。
  const base = publicOrigin(request, origin);

  const supabase = createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/login?error=auth`);
}

/** ブラウザから見える公開オリジンを返す（ローカル開発では request.url のまま） */
function publicOrigin(request: Request, origin: string): string {
  if (process.env.NODE_ENV === "development") return origin;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return origin;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${forwardedHost}`;
}
