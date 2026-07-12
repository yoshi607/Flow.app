import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    // ログイン状態によって内容が変わる HTML は常にネットワークを優先し、
    // 古いキャッシュ（真っ白画面の原因になりうる）を出さないようにする。
    runtimeCaching: [
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "html-pages",
          networkTimeoutSeconds: 10,
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 本番ビルドは型チェックを維持しつつ、ESLintツールの都合でビルドが
  // 止まらないようにする（開発時は `npm run lint` で確認可能）。
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withPWA(nextConfig);
