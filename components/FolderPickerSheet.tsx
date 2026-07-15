"use client";

import { useNotes } from "@/lib/store";
import { IconFolder, IconClose, IconPlus } from "./icons";

// メモの移動先フォルダを選ぶボトムシート。3点メニュー・左スワイプの
// 「移動」から共通で使う。
export default function FolderPickerSheet({
  currentFolderId,
  onPick,
  onClose,
}: {
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const { folders, createFolder } = useNotes();

  async function handleCreate() {
    const name = window.prompt("新しいフォルダ名を入力");
    if (!name || !name.trim()) return;
    const folder = await createFolder(name.trim());
    if (folder) onPick(folder.id); // 作成したフォルダへそのまま移動
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="safe-bottom relative z-10 max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-white p-2 shadow-xl dark:bg-neutral-900 sm:max-w-sm sm:rounded-2xl">
        <div className="flex items-center gap-1 px-3 py-2">
          <span className="flex-1 text-sm font-semibold">フォルダを変更</span>
          {/* 新しいフォルダを作成（アイコンのみ） */}
          <button
            onClick={handleCreate}
            title="新しいフォルダを作成"
            aria-label="新しいフォルダを作成"
            className="flow-press rounded-lg p-1.5 text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-neutral-800"
          >
            <IconPlus className="h-5 w-5" />
          </button>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="flow-press rounded-lg p-1.5 text-neutral-400 hover:bg-brand-100 dark:hover:bg-neutral-800"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={() => onPick(null)}
          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition ${
            currentFolderId === null
              ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200"
              : "hover:bg-brand-100/70 dark:hover:bg-neutral-800/60"
          }`}
        >
          <IconFolder className="h-4 w-4 opacity-60" />
          フォルダなし
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            onClick={() => onPick(f.id)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition ${
              currentFolderId === f.id
                ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200"
                : "hover:bg-brand-100/70 dark:hover:bg-neutral-800/60"
            }`}
          >
            <IconFolder className="h-4 w-4" />
            <span className="truncate">{f.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
