"use client";

import { useEffect, useRef, useState } from "react";
import { useNotes } from "@/lib/store";
import { useDevice } from "@/lib/useDevice";
import { type Folder } from "@/lib/types";
import { type View } from "./Sidebar";
import SwipeRow, { type SwipeAction } from "./SwipeRow";
import { IconFolder, IconTrash, IconPencil } from "./icons";

// 長押し開始までの時間(ms)と、それ未満のこの距離(px)を超える移動で
// 「長押しではなくスクロール/スワイプ」と判断してキャンセルする。
const LONG_PRESS_MS = 420;
const CANCEL_MOVE_PX = 10;

// フォルダ一覧。長押し→ドラッグで並べ替え（④）、左スワイプで
// 名前変更・削除（⑥）に対応する。
export default function FolderList({
  view,
  onChangeView,
  rowClass,
}: {
  view: View;
  onChangeView: (v: View) => void;
  rowClass: (active: boolean) => string;
}) {
  const { folders, notes, renameFolder, deleteFolder, reorderFolders } = useNotes();
  const { isTouch } = useDevice();

  const folderCount = (id: string) =>
    notes.filter((n) => n.status === "active" && n.folder_id === id).length;

  // 並べ替え中の一時的な並び順（id配列）。非ドラッグ時は folders に追従。
  const [order, setOrder] = useState<string[]>(folders.map((f) => f.id));
  const [dragId, setDragId] = useState<string | null>(null);

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const draggingRef = useRef(false);

  // folders が変わったら（ドラッグ中でなければ）並び順を同期
  useEffect(() => {
    if (!draggingRef.current) setOrder(folders.map((f) => f.id));
  }, [folders]);

  const orderedFolders = order
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => !!f);

  function clearPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function beginPress(id: string, clientX: number, clientY: number) {
    startX.current = clientX;
    startY.current = clientY;
    clearPress();
    pressTimer.current = setTimeout(() => {
      draggingRef.current = true;
      setDragId(id);
    }, LONG_PRESS_MS);
  }

  // ドラッグ中、ポインタ位置に応じて order を並べ替える
  function updateDrag(clientY: number) {
    if (!draggingRef.current || !dragId) return;
    // 各行の中点と比較して、dragId を挿入すべき index を求める
    let targetIndex = order.length - 1;
    for (let i = 0; i < order.length; i++) {
      const el = rowRefs.current.get(order[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        targetIndex = i;
        break;
      }
    }
    setOrder((prev) => {
      const from = prev.indexOf(dragId);
      if (from === -1 || from === targetIndex) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(targetIndex, 0, dragId);
      return next;
    });
  }

  function endDrag() {
    clearPress();
    if (draggingRef.current) {
      draggingRef.current = false;
      setDragId(null);
      reorderFolders(order);
    }
  }

  // 名前変更・削除（スワイプ・ダブルクリック・ホバーの削除ボタンで共通）
  function promptRename(f: Folder) {
    const name = window.prompt("フォルダ名を変更", f.name);
    if (name && name.trim()) renameFolder(f.id, name.trim());
  }

  function confirmDelete(f: Folder) {
    if (
      window.confirm(
        `フォルダ「${f.name}」を削除しますか？\n（中のメモは削除されず、フォルダ未設定になります）`,
      )
    )
      deleteFolder(f.id);
  }

  const actionsFor = (f: Folder): SwipeAction[] => [
    {
      key: "rename",
      label: "名前変更",
      icon: <IconPencil />,
      className: "bg-neutral-500",
      onClick: () => promptRename(f),
    },
    {
      key: "delete",
      label: "削除",
      icon: <IconTrash />,
      className: "bg-red-600",
      onClick: () => confirmDelete(f),
    },
  ];

  return (
    <div>
      {orderedFolders.map((f) => (
        <div
          key={f.id}
          ref={(el) => {
            if (el) rowRefs.current.set(f.id, el);
            else rowRefs.current.delete(f.id);
          }}
          // 長押し検知（ポインタ）。並べ替え中はポインタを追跡。
          onPointerDown={(e) => {
            // マウス右クリックなどは無視
            if (e.button !== undefined && e.button !== 0) return;
            beginPress(f.id, e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) {
              e.preventDefault();
              updateDrag(e.clientY);
            } else if (
              Math.abs(e.clientX - startX.current) > CANCEL_MOVE_PX ||
              Math.abs(e.clientY - startY.current) > CANCEL_MOVE_PX
            ) {
              // 縦横どちらかに動いた＝スクロール/スワイプ。長押しをキャンセル
              clearPress();
            }
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={dragId === f.id ? "flow-reorder-dragging relative z-10" : ""}
        >
          {/* 前面の地色はサイドバーに合わせる。既定の白のままだと、
              選択ハイライトの丸角のまわりに白い四角が見えてしまう */}
          <SwipeRow
            actions={actionsFor(f)}
            disabled={dragId === f.id}
            compact
            contentClassName="rounded-2xl bg-brand-50 dark:bg-neutral-900"
          >
            <div className="group relative">
              <button
                className={rowClass(
                  view.type === "folder" && view.folderId === f.id,
                )}
                onClick={() => {
                  // ドラッグ直後のクリックは無視
                  if (draggingRef.current) return;
                  onChangeView({ type: "folder", folderId: f.id });
                }}
                // ダブルタップでの名前変更は PC（非タッチ）のみ。
                // タッチ端末は左スワイプの「名前変更」を使う。
                onDoubleClick={isTouch ? undefined : () => promptRename(f)}
              >
                <IconFolder className="h-4 w-4" />
                <span className="flex-1 truncate">{f.name}</span>
                {/* 件数。PC ではホバー時に削除ボタンと重ならないよう消す */}
                <span
                  className={`text-xs text-neutral-400 transition-opacity ${
                    isTouch ? "" : "group-hover:opacity-0"
                  }`}
                >
                  {folderCount(f.id)}
                </span>
              </button>
              {/* PC 向け：ホバーで出る削除ボタン。タッチ端末では出さない
                  （タップ時にホバー状態が残って件数と重なるため。タッチの削除は
                  左スワイプの「削除」で行う）。 */}
              {!isTouch && (
                <button
                  onClick={() => confirmDelete(f)}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-neutral-400 hover:bg-brand-200 hover:text-red-600 group-hover:block dark:hover:bg-neutral-700"
                  title="フォルダを削除"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </SwipeRow>
        </div>
      ))}
    </div>
  );
}
