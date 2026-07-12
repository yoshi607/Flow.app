"use client";

// ルートレイアウトを含めた描画エラーを捕捉し、白画面の代わりに
// エラー内容を表示する（iOS Safari 等での原因特定のため）
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ maxWidth: 480 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              エラーが発生しました
            </h1>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>
              画面の表示中に問題が発生しました。このメッセージのスクリーンショットを
              共有していただけると、原因の特定に役立ちます。
            </p>
            <pre
              style={{
                fontSize: 12,
                background: "#f3f3f3",
                padding: 12,
                borderRadius: 8,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error.message}
              {error.digest ? `\n(digest: ${error.digest})` : ""}
            </pre>
            <button
              onClick={reset}
              style={{
                marginTop: 16,
                padding: "8px 16px",
                borderRadius: 8,
                background: "#eaeff3",
                border: "none",
                fontSize: 14,
              }}
            >
              再読み込み
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
