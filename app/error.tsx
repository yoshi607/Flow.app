"use client";

import { useEffect } from "react";

// ルートレイアウトより内側（各ページ）の描画エラーを捕捉する
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm">
        <h1 className="mb-2 text-lg font-semibold">エラーが発生しました</h1>
        <p className="mb-3 text-sm text-neutral-500">
          画面の表示中に問題が発生しました。このメッセージのスクリーンショットを
          共有していただけると、原因の特定に役立ちます。
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-brand-100 p-3 text-xs">
          {error.message}
          {error.digest ? `\n(digest: ${error.digest})` : ""}
        </pre>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-brand-200 px-4 py-2 text-sm"
        >
          再読み込み
        </button>
      </div>
    </div>
  );
}
