import { TRASH_RETENTION_DAYS, type Note } from "./types";

// 残り日数を計算（切り上げ）。過去なら 0。
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// 短期メモ: ゴミ箱行きまでの残り日数
export function shortNoteRemainingDays(expiresAt: string | null): number | null {
  return daysUntil(expiresAt);
}

// ゴミ箱メモ: 完全削除までの残り日数
export function trashRemainingDays(trashedAt: string | null): number | null {
  if (!trashedAt) return null;
  const deleteAt = new Date(trashedAt).getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return daysUntil(new Date(deleteAt).toISOString());
}

// 相対的な日時表示（例: 3分前 / 昨日 / 2026/1/5）
export function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24 && now.getDate() === date.getDate()) return `${diffHour}時間前`;
  if (diffDay < 2) return "昨日";
  if (diffDay < 7) return `${diffDay}日前`;

  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

// リッチテキスト本文（HTML）からタグを取り除いたプレーンテキストを得る
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

// 本文からプレビュー用のスニペットを作る
export function snippet(body: string, len = 80): string {
  const oneLine = stripHtml(body).replace(/\s+/g, " ").trim();
  return oneLine.length > len ? oneLine.slice(0, len) + "…" : oneLine;
}

// タイトルが空のときのフォールバック（本文1行目 or "無題のメモ"）
export function displayTitle(title: string, body: string): string {
  if (title.trim()) return title.trim();
  const firstLine = stripHtml(body)
    .split("\n")
    .find((l) => l.trim());
  return firstLine ? firstLine.trim().slice(0, 40) : "無題のメモ";
}

// メモを共有する（⑥）。
// iOS/iPad は Web Share API でネイティブの共有シートが開く。
// Windows などは対応ブラウザなら共有シート、非対応ならクリップボードにコピー。
export async function shareNote(title: string, body: string): Promise<void> {
  const text = `${title ? title + "\n\n" : ""}${snippet(body, 5000)}`.trim();
  const shareTitle = title.trim() || "メモ";
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title: shareTitle, text });
      return;
    }
  } catch (e) {
    // ユーザーがキャンセルした場合などは何もしない
    if (e instanceof DOMException && e.name === "AbortError") return;
  }
  // フォールバック：クリップボードへコピー
  try {
    await navigator.clipboard?.writeText(text);
    window.alert("この端末は共有に非対応のため、内容をクリップボードにコピーしました");
  } catch {
    window.alert("共有・コピーに対応していません");
  }
}

// 録音ロック中か（ネイティブ版が録音中にセットする。Web版は読んで従うだけ）
// recording_lock_until が未来で、recording_lock_by が入っていればロック中。
// 2カラムがまだ無い環境（undefined）や null でも安全に「ロックされていない」扱いにする。
export function isNoteLocked(note: Pick<Note, "recording_lock_by" | "recording_lock_until">): boolean {
  if (!note.recording_lock_by || !note.recording_lock_until) return false;
  return new Date(note.recording_lock_until).getTime() > Date.now();
}

// 添付ファイルのサイズ表示（例: 1.2 MB）
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
