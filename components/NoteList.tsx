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
      <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
        完全削除まであと{d}日
      </span>
    );
  }
  if (note.type === "short") {
    const d = shortNoteRemainingDays(note.expires_at);
    if (d === null) return null;
    return (
      <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
        あと{d}日で自動削除
      </span>
    );
  }
  return null;
}

// ＋ボタン：タップで外側へ広がるリングを一度だけ再生してから onCreate を呼ぶ。
// 粒子を飛ばすような派手な演出はせず、control 一点から広がる感覚だけを残す。
// このボタンの位置を onCreate へ渡し、本文側を「このボタンから育った」ように
// 展開させる（実際の変形は AppShell 側で行う）。
function CreateButton({ onCreate }: { onCreate: (origin: DOMRect) => void }) {
  const [rings, setRings] = useState<number[]>([]);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const id = Date.now();
    setRings((r) => [...r, id]);
    // アニメーション終了後に要素を片付ける
    window.setTimeout(() => setRings((r) => r.filter((x) => x !== id)), 500);
    onCreate(e.currentTarget.getBoundingClientRect());
  }

  return (
    <button
      onClick={handleClick}
      className="flow-press rounded-full bg-brand-200 p-2 text-brand-700 shadow-sm hover:bg-brand-300"
      title="新規メモ"
    >
      <IconPlus />
      {rings.map((id) => (
        <span
          key={id}
          className="flow-burst-ring pointer-events-none absolute inset-0 rounded-full border border-brand-400"
          aria-hidden
        />
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
  onRequestDelete,
  poppedId = null,
  deletingId = null,
  sidebarCollapsed = false,
}: {
  notes: Note[];
  loading: boolean;
  view: View;
  query: string;
  selectedId: string | null;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  onCreate: (origin: DOMRect) => void;
  onOpenMenu: () => void;
  /** 削除を依頼する（確認・アニメーション・実際の削除は AppShell が担う） */
  onRequestDelete: (id: string, permanent?: boolean) => void;
  /** 作成直後のメモ。上から「ぽんっ」と出す演出に使う */
  poppedId?: string | null;
  /** 削除アニメーション再生中のメモ。左へ滑り出て消える */
  deletingId?: string | null;
  sidebarCollapsed?: boolean;
}) {
  const { folders, emptyTrash, restoreNote, updateNote, togglePin } = useNotes();
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
          keepOpen: true,
          onClick: () => onRequestDelete(note.id, true),
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
        keepOpen: true,
        onClick: () => onRequestDelete(note.id),
      },
    ];
  }

  // 右スワイプで出す単一アクション：ピン留め／解除（アクティブなメモのみ）。
  // スワイプしきると押さずにトグルする。
  function leadingActionFor(note: Note): SwipeAction | undefined {
    if (note.status !== "active") return undefined;
    return {
      key: "pin",
      label: note.pinned ? "ピン解除" : "ピン留め",
      icon: <IconPin filled={note.pinned} />,
      className: "bg-amber-500",
      onClick: () => togglePin(note.id),
    };
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
    <div className="flex h-full flex-col bg-white/70 backdrop-blur-xl">
      {/* ヘッダー（☰・タイトル・＋を少しだけ下げて視覚的に揃える。transform なので
          下の検索欄などのレイアウトには影響しない） */}
      <div className="safe-top flex translate-y-[5px] items-center gap-2 px-3 pt-3">
        {/* モバイル：ドロワーを開く / md以上：最小化中のみ表示してフォルダを再表示 */}
        <button
          onClick={onOpenMenu}
          title="フォルダを表示"
          className={`flow-press rounded-lg p-2 hover:bg-brand-100 ${
            sidebarCollapsed ? "" : "md:hidden"
          }`}
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
              className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
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
        <div className="flex items-center gap-2 rounded-xl bg-brand-100/80 px-3 py-2">
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
              leadingAction={leadingActionFor(note)}
              className={`mb-1 rounded-2xl ${
                deletingId === note.id
                  ? "flow-row-delete"
                  : poppedId === note.id
                    ? "flow-note-pop"
                    : ""
              }`}
            >
            <button
              onClick={() => onSelect(note.id)}
              className={`flow-press block w-full rounded-2xl px-3 py-2.5 text-left ${
                selectedId === note.id
                  ? "bg-brand-100"
                  : "hover:bg-brand-100/60"
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
                  <span className="rounded-md bg-brand-200 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                    短期
                  </span>
                )}
                {(note.tags ?? []).slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-600"
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
            // フォルダは整理用の情報なので編集日時は動かさない（touch=false）。
            // DB 側のトリガーも据え置くので、表示とサーバーの値がずれない。
            updateNote(movingNote.id, { folder_id: folderId }, true, false);
            setMovingNote(null);
          }}
          onClose={() => setMovingNote(null)}
        />
      )}
    </div>
  );
}
