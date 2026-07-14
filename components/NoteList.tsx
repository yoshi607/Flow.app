"use client";

import { useState } from "react";
import { useNotes } from "@/lib/store";
import { type Note } from "@/lib/types";
import {
  displayTitle,
  snippet,
  formatRelative,
  shortNoteRemainingDays,
  trashRemainingDays,
  shareNote,
} from "@/lib/utils";
import { type View } from "./Sidebar";
import SwipeRow, { type SwipeAction } from "./SwipeRow";
import FolderPickerSheet from "./FolderPickerSheet";
import {
  IconPlus,
  IconSearch,
  IconMenu,
  IconPin,
  IconShare,
  IconMove,
  IconTrash,
  IconRestore,
} from "./icons";

function Countdown({ note }: { note: Note }) {
  if (note.status === "trashed") {
    const d = trashRemainingDays(note.trashed_at);
    if (d === null) return null;
    return (
      <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
        完全削除まであと{d}日
      </span>
    );
  }
  if (note.type === "short") {
    const d = shortNoteRemainingDays(note.expires_at);
    if (d === null) return null;
    return (
      <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">
        あと{d}日で自動削除
      </span>
    );
  }
  return null;
}

// ＋ボタン：タップで拡散アニメーション（②）を再生してから onCreate を呼ぶ
function CreateButton({ onCreate }: { onCreate: () => void }) {
  const [bursts, setBursts] = useState<number[]>([]);
  // 放射する粒子の角度（8方向）
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];

  function handleClick() {
    const id = Date.now();
    setBursts((b) => [...b, id]);
    // アニメーション終了後に要素を片付ける
    window.setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 550);
    onCreate();
  }

  return (
    <button
      onClick={handleClick}
      className="relative rounded-full bg-brand-200 p-2 text-brand-700 shadow-sm transition hover:bg-brand-300 active:scale-95 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      title="新規メモ"
    >
      <IconPlus />
      {bursts.map((id) => (
        <span
          key={id}
          className="pointer-events-none absolute inset-0"
          aria-hidden
        >
          <span className="flow-burst-ring absolute inset-0 rounded-full border-2 border-brand-400 dark:border-brand-500" />
          {angles.map((a) => (
            <span
              key={a}
              className="flow-burst-particle absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-brand-500"
              style={{ ["--a" as string]: `${a}deg` }}
            />
          ))}
        </span>
      ))}
    </button>
  );
}

export default function NoteList({
  notes,
  loading,
  view,
  query,
  selectedId,
  onQueryChange,
  onSelect,
  onCreate,
  onOpenMenu,
}: {
  notes: Note[];
  loading: boolean;
  view: View;
  query: string;
  selectedId: string | null;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onOpenMenu: () => void;
}) {
  const {
    folders,
    emptyTrash,
    trashNote,
    restoreNote,
    deleteNotePermanently,
    updateNote,
  } = useNotes();
  // 「移動」対象のメモ（フォルダ選択シートを開く）
  const [movingNote, setMovingNote] = useState<Note | null>(null);

  // 各メモの左スワイプアクションを組み立てる（⑥）
  function actionsFor(note: Note): SwipeAction[] {
    if (note.status === "trashed") {
      return [
        {
          key: "restore",
          label: "復元",
          icon: <IconRestore />,
          className: "bg-brand-500",
          onClick: () => restoreNote(note.id),
        },
        {
          key: "delete",
          label: "完全削除",
          icon: <IconTrash />,
          className: "bg-red-600",
          onClick: () => {
            if (window.confirm("このメモを完全に削除しますか？（元に戻せません）"))
              deleteNotePermanently(note.id);
          },
        },
      ];
    }
    return [
      {
        key: "share",
        label: "共有",
        icon: <IconShare />,
        className: "bg-neutral-500",
        onClick: () => shareNote(note.title, note.body),
      },
      {
        key: "move",
        label: "移動",
        icon: <IconMove />,
        className: "bg-brand-500",
        onClick: () => setMovingNote(note),
      },
      {
        key: "trash",
        label: "削除",
        icon: <IconTrash />,
        className: "bg-red-600",
        onClick: () => trashNote(note.id),
      },
    ];
  }

  const title = query.trim()
    ? "検索結果"
    : view.type === "trash"
      ? "ゴミ箱"
      : view.type === "short"
        ? "短期メモ"
        : view.type === "tag"
          ? `#${view.tag}`
          : view.type === "folder"
            ? (folders.find((f) => f.id === view.folderId)?.name ?? "フォルダ")
            : "すべてのメモ";

  return (
    <div className="flex h-full flex-col bg-white/70 backdrop-blur-xl dark:bg-neutral-950">
      {/* ヘッダー */}
      <div className="safe-top flex items-center gap-2 px-3 pt-3">
        <button
          onClick={onOpenMenu}
          className="rounded-lg p-2 hover:bg-brand-100 dark:hover:bg-neutral-800 md:hidden"
        >
          <IconMenu />
        </button>
        <h2 className="flex-1 truncate text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {view.type === "trash" ? (
          notes.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm("ゴミ箱を空にしますか？（元に戻せません）"))
                  emptyTrash();
              }}
              className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              空にする
            </button>
          )
        ) : (
          <CreateButton onCreate={onCreate} />
        )}
      </div>

      {/* 検索 */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl bg-brand-100/80 px-3 py-2 dark:bg-neutral-800">
          <IconSearch className="h-4 w-4 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="検索"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      {/* 一覧 */}
      <div className="thin-scroll flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <p className="p-6 text-center text-sm text-neutral-400">読み込み中…</p>
        ) : notes.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-400">
            {query.trim()
              ? "一致するメモがありません"
              : view.type === "trash"
                ? "ゴミ箱は空です"
                : "メモがありません。右上の＋で作成できます"}
          </p>
        ) : (
          notes.map((note) => (
            <SwipeRow
              key={note.id}
              actions={actionsFor(note)}
              className="mb-1 rounded-2xl"
            >
            <button
              onClick={() => onSelect(note.id)}
              className={`block w-full rounded-2xl px-3 py-2.5 text-left transition ${
                selectedId === note.id
                  ? "bg-brand-100 dark:bg-brand-500/20"
                  : "hover:bg-brand-100/60 dark:hover:bg-neutral-800/60"
              }`}
            >
              <div className="flex items-center gap-1.5">
                {note.pinned && (
                  <IconPin filled className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                )}
                <span className="flex-1 truncate font-medium">
                  {displayTitle(note.title, note.body)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                <span className="shrink-0">{formatRelative(note.updated_at)}</span>
                <span className="truncate">{snippet(note.body, 40) || "内容なし"}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {note.type === "short" && note.status === "active" && (
                  <span className="rounded-md bg-brand-200 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-neutral-700 dark:text-neutral-300">
                    短期
                  </span>
                )}
                {(note.tags ?? []).slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    #{t}
                  </span>
                ))}
                <Countdown note={note} />
              </div>
            </button>
            </SwipeRow>
          ))
        )}
      </div>

      {movingNote && (
        <FolderPickerSheet
          currentFolderId={movingNote.folder_id}
          onPick={(folderId) => {
            updateNote(movingNote.id, { folder_id: folderId }, true);
            setMovingNote(null);
          }}
          onClose={() => setMovingNote(null)}
        />
      )}
    </div>
  );
}
