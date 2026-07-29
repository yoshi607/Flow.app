import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下を除く全パスにマッチ:
     * - _next/static, _next/image（静的アセット）
     * - favicon / アイコン / manifest / service worker
     * - worker-*.js（カスタム Service Worker。sw.js から importScripts される。
     *   ここを除外しないと未ログイン扱いで /login へリダイレクトされ、
     *   importScripts が失敗してプッシュ通知が丸ごと動かなくなる）
     * - api/cron（Vercel Cron からの呼び出し。ログインセッションを持たないため
     *   ここでは通し、ルート側で CRON_SECRET を検証する）
     * - 画像ファイル
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-|worker-|api/cron|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
