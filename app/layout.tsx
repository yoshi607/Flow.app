import type { Metadata, Viewport } from "next";
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
    // ブラウザタブのアイコンは OS のライト/ダーク設定に応じて切り替わる
    icon: [
      { url: "/icons/favicon-light-48.png", media: "(prefers-color-scheme: light)" },
      { url: "/icons/favicon-dark-48.png", media: "(prefers-color-scheme: dark)" },
    ],
    // ホーム画面アイコンは端末側が動的切替に対応していないため既定（ライト）を使用
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
      <body>{children}</body>
    </html>
  );
}
