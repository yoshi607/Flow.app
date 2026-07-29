import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  // オンライン復帰時に location.reload() させない。
  // next-pwa は true だと `window.addEventListener("online", () => location.reload())`
  // を仕込む（sw-entry.js）。PWA は起動直後にネットワーク状態が確定する際 online が
  // 発火しやすく、その結果アプリが丸ごと再読み込みされていた。
  //  - 起動アニメーションが2回再生される
  //  - 起動のたびに余計な全ページ再読み込みが走り、起動が遅くなる
  //  - 編集中に電波が復帰すると画面が作り直される
  // データはリアルタイム同期で追従し、HTML も navigate を NetworkFirst で
  // 取り直すため、リロードで取り戻すものは無い。
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
  // worker/index.js をコンパイルして public/worker-*.js を生成し、sw.js から
  // importScripts させる。プッシュ通知の push / notificationclick ハンドラは
  // そこに置いている（next-pwa が生成する sw.js は直接編集できないため）。
  customWorkerSrc: "worker",
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
