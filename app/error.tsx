"use client";

import { useEffect, useState } from "react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunkRecovery";

// ルートレイアウトより内側（各ページ）の描画エラーを捕捉する
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
    // 新しいデプロイ直後などに出る「チャンク読み込み失敗」は、
    // reset() では直らない（ファイル自体が無い）ため取り直して復旧する
    if (isChunkLoadError(error) && recoverFromChunkError()) {
      setRecovering(true);
    }
  }, [error]);

  if (recovering) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-neutral-500">最新版を読み込んでいます…</p>
      </div>
    );
  }

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
        <div className="mt-4 flex gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-brand-200 px-4 py-2 text-sm"
          >
            再試行
          </button>
          {/* reset() で直らない場合の最終手段。キャッシュを捨てて取り直す */}
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem("flow-chunk-reloaded");
              } catch {
                /* 使えない環境では単に再読み込みする */
              }
              if (!recoverFromChunkError()) window.location.reload();
            }}
            className="rounded-lg border border-brand-300 px-4 py-2 text-sm"
          >
            最新版を取得して再読み込み
          </button>
        </div>
      </div>
    </div>
  );
}
