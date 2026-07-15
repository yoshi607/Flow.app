"use client";

// 「Loading chunk 238 failed」系のエラーからの自動復旧。
//
// 原因: 開いているページが古いビルドのHTML/JSのまま動いていると、遅延読み込み
// （音声メモ・手書きなど）が古いチャンク名を取りに行く。新しくデプロイすると
// そのファイルは存在しないため 404 になり、この例外が出る。
// PWA の Service Worker が古いHTMLをキャッシュから返していると起きやすい。
//
// 対策: 古いキャッシュを捨てて再読み込みし、新しいビルドを取り直す。

const RELOAD_FLAG = "flow-chunk-reloaded";

/** チャンク読み込み失敗かどうか（ブラウザごとに文言が違うため広めに判定） */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as Error).name ?? "";
  const message = (error as Error).message ?? "";
  return (
    name === "ChunkLoadError" ||
    /loading chunk [\w-]+ failed/i.test(message) ||
    /loading css chunk/i.test(message) ||
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message)
  );
}

/**
 * キャッシュを消して1度だけ再読み込みする。
 * 復旧できない場合に無限リロードへ陥らないよう、セッション中は1回だけ実行する。
 * @returns 再読み込みを開始したら true（呼び出し側はエラー画面を出さなくてよい）
 */
export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false; // 既に試したので諦める
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // sessionStorage が使えない環境では復旧を試みない（ループ防止のため）
    return false;
  }

  // 古い Service Worker のキャッシュを捨ててから再読み込みする
  const cleanup = async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // 消せなくても再読み込みは行う
    }
    window.location.reload();
  };
  void cleanup();
  return true;
}
