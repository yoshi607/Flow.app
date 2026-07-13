import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// 各リクエストで Supabase セッションを更新し、未ログインなら /login へ誘導する
export async function updateSession(request: NextRequest) {
  let cookiesToSetLater: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSetLater = cookiesToSet;
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/auth");

  // 未ログインでアプリ画面にアクセス → ログインへ
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // ログイン済みでログイン画面にアクセス → メモ一覧へ
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // 検証済みユーザー情報をヘッダーで下流の Server Component に渡し、
  // ページ側で getUser() を再度呼ばずに済むようにする（起動時の往復を1回に減らす）
  const requestHeaders = new Headers(request.headers);
  if (user) {
    requestHeaders.set("x-user-id", user.id);
    if (user.email) requestHeaders.set("x-user-email", user.email);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  cookiesToSetLater.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );

  return response;
}
