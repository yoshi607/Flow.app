import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// 通信失敗・サーバー側の一時障害など、「ログアウトした」ことを意味しないエラーか
function isTransientAuthError(error: { name?: string; status?: number }) {
  return (
    error.name === "AuthRetryableFetchError" ||
    (typeof error.status === "number" && error.status >= 500)
  );
}

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
    data: { user: verifiedUser },
    error: userError,
  } = await supabase.auth.getUser();
  let user = verifiedUser;

  // 【重要】通信の一時的な失敗（電波が弱い・タイムアウト・Supabase側の一時障害）を
  // 「未ログイン」と取り違えない。取り違えると、スマホで電波が不安定なだけで
  // 保存済みのログインが生きていても毎回 /login に飛ばされてしまう。
  // 一時的な失敗のときは、Cookie に残っているセッションをそのまま信用する
  // （データ取得は下流で JWT 検証＋RLS が行うので、安全性は変わらない）。
  if (!user && userError && isTransientAuthError(userError)) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    user = session?.user ?? null;

    if (!user) {
      // セッションの有無すら確認できない＝ログイン状態を判断できないので、
      // ログアウト扱いにせず「接続できない」と返す（Cookie は消さない）。
      return new NextResponse(
        "接続できませんでした。電波の良いところで、もう一度開いてください。",
        {
          status: 503,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }
  }

  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/auth");

  // リダイレクト時も、更新後のトークンをブラウザに保存させる
  const withRefreshedCookies = (res: NextResponse) => {
    cookiesToSetLater.forEach(({ name, value, options }) =>
      res.cookies.set(name, value, options),
    );
    return res;
  };

  // 未ログインでアプリ画面にアクセス → ログインへ
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // ログイン済みでログイン画面にアクセス → メモ一覧へ
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  const requestHeaders = new Headers(request.headers);

  // 【重要】トークンが更新された場合、下流（Server Component / Route Handler）へは
  // 「更新後の」Cookie を渡す必要がある。元の request.headers には古いトークンが
  // 入ったままなので、setAll で更新済みの request.cookies から作り直して上書きする。
  // これを怠ると、下流の Supabase クライアントが期限切れ＆ローテーション済みの
  // トークンで実行され、RLS により取得0件（メモ一覧が空）や 401 になる。
  requestHeaders.set("cookie", request.cookies.toString());

  // 検証済みユーザー情報をヘッダーで下流に渡し、ページ・API 側で getUser() を
  // 再度呼ばずに済むようにする（起動時の往復を1回に減らす）。
  // ※クライアントからの偽装を防ぐため、まず受信ヘッダーを必ず削除してから設定する。
  requestHeaders.delete("x-user-id");
  requestHeaders.delete("x-user-email");
  if (user) {
    requestHeaders.set("x-user-id", user.id);
    if (user.email) requestHeaders.set("x-user-email", user.email);
  }

  return withRefreshedCookies(
    NextResponse.next({ request: { headers: requestHeaders } }),
  );
}
