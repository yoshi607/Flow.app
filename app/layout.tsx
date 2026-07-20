import type { Metadata, Viewport } from "next";
import splashScreens from "@/lib/splashScreens.json";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flow",
  description: "iPhone / iPad / Windows で同期するクラウドメモ",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Flow",
  },
  icons: {
    // ライト固定（アプリ自体がライトのみのため、OS 設定では切り替えない）
    icon: "/icons/favicon-light-48.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#eaeff3",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        {/* iOS(ホーム画面のPWA)の起動画面。iOS は manifest の background_color を
            見ないため、端末サイズごとに合致する画像を指定する必要がある。
            一覧は scripts/gen-splash.mjs が生成する（端末を足す時はそちらを編集）。 */}
        {splashScreens.map((s) => (
          <link
            key={s.href + s.media}
            rel="apple-touch-startup-image"
            media={s.media}
            href={s.href}
          />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
