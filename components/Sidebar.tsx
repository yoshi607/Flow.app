"use client";

import { useMemo, useState } from "react";
import { useNotes } from "@/lib/store";
import FolderList from "./FolderList";
import {
  IconNotes,
  IconTrash,
  IconPlus,
  IconSettings,
  IconClock,
  IconCollapse,
  IconChevron,
} from "./icons";

export type View =
  | { type: "all" }
  | { type: "short" }
  | { type: "trash" }
  | { type: "folder"; folderId: string }
  | { type: "tag"; tag: string };

export default function Sidebar({
  view,
  onChangeView,
  onOpenSettings,
  onCollapse,
}: {
  view: View;
  onChangeView: (v: View) => void;
  onOpenSettings: () => void;
  onCollapse?: () => void;
}) {
  const { notes, createFolder } = useNotes();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [tagsOpen, setTagsOpen] = useState(true);
  const [foldersOpen, setFoldersOpen] = useState(true);

  const activeCount = notes.filter((n) => n.status === "active").length;
  const shortCount = notes.filter(
    (n) => n.status === "active" && n.type === "short",
  ).length;
  const trashCount = notes.filter((n) => n.status === "trashed").length;

  // ユーザーが作成した全タグ（重複除去・件数付き）
  const tags = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.status !== "active") continue;
      for (const t of n.tags ?? []) map.set(t, (map.get(t) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes]);

  async function submitNewFolder() {
    const name = newName.trim();
    if (name) await createFolder(name);
    setNewName("");
    setAdding(false);
  }

  const isActive = (v: View) => JSON.stringify(v) === JSON.stringify(view);

  const rowClass = (active: boolean) =>
    `flex items-center gap-2.5 w-full px-3 py-2 rounded-2xl text-sm text-left transition ${
      active
        ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200"
        : "hover:bg-brand-100/70 dark:hover:bg-neutral-800/60"
    }`;

  // タグのチップ（ピル）表示
  const chipClass = (active: boolean) =>
    `rounded-2xl px-3.5 py-2 text-sm font-medium transition ${
      active
        ? "bg-brand-200 text-brand-700 dark:bg-brand-500/25 dark:text-brand-100"
        : "bg-brand-100 text-neutral-600 hover:bg-brand-200/70 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
    }`;

  return (
    <div className="flex h-full flex-col bg-brand-50/80 backdrop-blur-xl dark:bg-neutral-900 safe-top border-r border-brand-200/60 dark:border-neutral-800">
      <div className="flex items-center gap-1 px-4 py-4">
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Flow</h1>
        {/* フォルダ一覧を最小化（md以上のみ。モバイルはドロワーなので不要） */}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="フォルダ一覧を最小化"
            aria-label="フォルダ一覧を最小化"
            className="flow-press hidden rounded-lg p-1.5 text-neutral-400 hover:bg-brand-100 hover:text-neutral-700 md:block dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <IconCollapse className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 thin-scroll">
        <button
          className={rowClass(isActive({ type: "all" }))}
          onClick={() => onChangeView({ type: "all" })}
        >
          <IconNotes className="h-4 w-4" />
          <span className="flex-1">すべてのメモ</span>
          <span className="text-xs text-neutral-400">{activeCount}</span>
        </button>

        {/* 短期メモ（⑧）：type=short のメモを集めた固定フォルダ。削除不可。 */}
        <button
          className={rowClass(isActive({ type: "short" }))}
          onClick={() => onChangeView({ type: "short" })}
        >
          <IconClock className="h-4 w-4" />
          <span className="flex-1">短期メモ</span>
          <span className="text-xs text-neutral-400">{shortCount}</span>
        </button>

        <div className="pt-3">
          <div className="flex items-center justify-between px-3 pb-1">
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                フォルダ
              </span>
              <button
                onClick={() => {
                  setFoldersOpen(true);
                  setAdding(true);
                }}
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                title="フォルダを追加"
              >
                <IconPlus className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => setFoldersOpen((v) => !v)}
              className="text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
              title={foldersOpen ? "フォルダを閉じる" : "フォルダを開く"}
            >
              <IconChevron
                className={`h-4 w-4 transition-transform ${
                  foldersOpen ? "" : "-rotate-90"
                }`}
              />
            </button>
          </div>

          {foldersOpen && (
            <>
              <FolderList
                view={view}
                onChangeView={onChangeView}
                rowClass={rowClass}
              />

              {adding && (
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={submitNewFolder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewFolder();
                    if (e.key === "Escape") {
                      setNewName("");
                      setAdding(false);
                    }
                  }}
                  placeholder="フォルダ名"
                  className="mx-1 mt-1 w-[calc(100%-0.5rem)] rounded-xl border border-brand-300 bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400 dark:border-neutral-700 dark:bg-neutral-800"
                />
              )}
            </>
          )}

          {/* ゴミ箱はフォルダ一覧の一番下に、少し間をあけて置く。UI 上の並びだけの
              話で、データ上はフォルダではない（View も type:"trash" のまま）。
              フォルダを閉じていても使えるよう、開閉の外に出しておく。 */}
          <div className="mt-2">
            <button
              className={rowClass(isActive({ type: "trash" }))}
              onClick={() => onChangeView({ type: "trash" })}
            >
              <IconTrash className="h-4 w-4" />
              <span className="flex-1">ゴミ箱</span>
              <span className="text-xs text-neutral-400">{trashCount}</span>
            </button>
          </div>
        </div>

        {/* タグ一覧（折り返すチップ表示）。見出しのチェブロンで開閉できる */}
        <div className="pt-3">
          <button
            onClick={() => setTagsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 pb-1 text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
          >
            <span className="text-xs font-medium uppercase tracking-wide">
              タグ
            </span>
            <IconChevron
              className={`h-4 w-4 transition-transform ${
                tagsOpen ? "" : "-rotate-90"
              }`}
            />
          </button>

          {tagsOpen &&
            (tags.length === 0 ? (
              <p className="px-3 py-1 text-xs text-neutral-400">
                メモにタグを付けると、ここに表示されます
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 px-2 pt-1">
                {tags.map(([tag]) => (
                  <button
                    key={tag}
                    onClick={() => onChangeView({ type: "tag", tag })}
                    className={chipClass(view.type === "tag" && view.tag === tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            ))}
        </div>
      </nav>

      <div className="safe-bottom flex items-center gap-2 border-t border-brand-200/60 p-2 dark:border-neutral-800">
        <button
          className={`${rowClass(false)} flex-1`}
          onClick={onOpenSettings}
        >
          <IconSettings className="h-4 w-4" />
          <span>設定</span>
        </button>
        {/* バージョン（デプロイが反映されているかの確認用） */}
        <span
          className="shrink-0 pr-1 font-mono text-[10px] text-neutral-400"
          title={`ビルド: ${process.env.NEXT_PUBLIC_BUILD_TIME ?? "不明"}`}
        >
          {process.env.NEXT_PUBLIC_APP_COMMIT ?? "local"}
        </span>
      </div>
    </div>
  );
}
