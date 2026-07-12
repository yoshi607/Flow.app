import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
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
