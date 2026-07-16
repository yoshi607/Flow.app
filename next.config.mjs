import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  // next-pwa が自動追加する "/" 専用キャッシュルート（タイムアウト設定が無く
  // ネットワークを待ち続けうる）を無効化し、下記の navigate ルート1本（3秒タイムアウト）に統一する。
  // ("/" は認証状態でリダイレクトが変わる動的ルートで静的プリキャッシュ対象にはならないため無効化しても安全)
  dynamicStartUrl: false,
  workboxOptions: {
    disableDevLogs: true,
    // 新しい Service Worker が有効になったら古いキャッシュを破棄する。
    // これが無いと、古いビルドのHTMLがキャッシュから返り続け、そこから
    // 参照される旧チャンクが404になって "Loading chunk N failed" が起きる。
    cleanupOutdatedCaches: true,
    // ログイン状態によって内容が変わる HTML は常にネットワークを優先しつつ、
    // 電波が悪い環境でもすぐキャッシュ済みシェルへフォールバックできるよう
    // タイムアウトを短めに設定する。
    runtimeCaching: [
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "html-pages",
          networkTimeoutSeconds: 3,
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // バージョン表示用。デプロイのたびに必ず変わる値をビルド時に埋め込む。
  // コミットSHA(Vercelが自動提供)＋ビルド日時。設定画面で確認できる。
  env: {
    NEXT_PUBLIC_APP_COMMIT:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  // 本番ビルドは型チェックを維持しつつ、ESLintツールの都合でビルドが
  // 止まらないようにする（開発時は `npm run lint` で確認可能）。
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withPWA(nextConfig);
