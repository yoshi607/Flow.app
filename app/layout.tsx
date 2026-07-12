import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

// React のエラーバウンダリより早いタイミング（スクリプト読込・実行時）の
// クラッシュを捕捉し、白画面の代わりに直接 DOM へ書き出す診断用スクリプト。
// 原因特定後は削除して構わない。
const earlyErrorCatcher = `
(function () {
  function showError(title, detail) {
    var el = document.getElementById('__boot_error__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__boot_error__';
      el.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#fff;color:#111;padding:20px;font-family:sans-serif;font-size:13px;overflow:auto;white-space:pre-wrap;word-break:break-word;';
      document.documentElement.appendChild(el);
    }
    var p = document.createElement('div');
    p.style.marginBottom = '12px';
    p.innerHTML = '<b>' + title + '</b><br>' + detail;
    el.appendChild(p);
  }
  window.addEventListener('error', function (e) {
    showError('起動時エラー (error)', (e && e.message) + ' @ ' + (e && e.filename) + ':' + (e && e.lineno) + ':' + (e && e.colno));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e && e.reason;
    var msg = reason && reason.message ? reason.message : String(reason);
    showError('起動時エラー (promise)', msg);
  });
  setTimeout(function () {
    var root = document.body && document.body.firstElementChild;
    var hasRealContent = document.body && document.body.textContent && document.body.textContent.trim().length > 0;
    if (!hasRealContent) {
      showError('診断: 5秒経ってもコンテンツが表示されていません', 'JS: ' + navigator.userAgent);
    }
  }, 5000);
})();
`;

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
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
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
      <body>
        <Script
          id="early-error-catcher"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: earlyErrorCatcher }}
        />
        {children}
      </body>
    </html>
  );
}
