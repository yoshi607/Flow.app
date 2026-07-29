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
  IconArchive,
  IconCollapse,
  IconChevron,
} from "./icons";

export type View =
  | { type: "all" }
  | { type: "long" }
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
  const longCount = notes.filter(
    (n) => n.status === "active" && n.type === "long",
  ).length;
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

  // 明るい地色の上に置くので、色が付くのは「選択中の1行」だけ。
  // 選択の印は薄いグレーにして、明るい面の中で穏やかに沈んで見えるようにする。
  const rowClass = (active: boolean) =>
    `flex items-center gap-2.5 w-full px-3 py-2 rounded-2xl text-sm text-left transition ${
      active
        ? "bg-neutral-200/80 text-neutral-900"
        : "hover:bg-neutral-100"
    }`;

  // タグのチップ（ピル）表示
  const chipClass = (active: boolean) =>
    `rounded-2xl px-3.5 py-2 text-sm font-medium transition ${
      active
        ? "bg-brand-200 text-brand-700"
        : "bg-brand-100 text-neutral-600 hover:bg-brand-200/70"
    }`;

  return (
    // フォルダ一覧は明るい地色にする（メモ一覧と同じ白ベース）。
    // 以前は brand-50 の青みがかったグレーだったが、その上に行ごとの地色が
    // 乗ることで「グレーの上に明るい塊が並ぶ」見え方になっていた。
    // 地色は面（この div）だけが持ち、行は選択中のものだけ色を付ける。
    <div className="flex h-full flex-col bg-white/80 backdrop-blur-xl safe-top border-r border-brand-200/60">
      <div className="flex items-center gap-1 px-4 py-4">
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Flow</h1>
        {/* フォルダ一覧を最小化（md以上のみ。モバイルはドロワーなので不要） */}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="フォルダ一覧を最小化"
            aria-label="フォルダ一覧を最小化"
            className="flow-press hidden rounded-lg p-1.5 text-neutral-400 hover:bg-brand-100 hover:text-neutral-700 md:block"
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

        {/* 長期メモ：type=long のメモを集めた固定フォルダ。短期メモと対になる。
            短期メモと同じく、データ上のフォルダではなく View で切り替える。 */}
        <button
          className={rowClass(isActive({ type: "long" }))}
          onClick={() => onChangeView({ type: "long" })}
        >
          <IconArchive className="h-4 w-4" />
          <span className="flex-1">長期メモ</span>
          <span className="text-xs text-neutral-400">{longCount}</span>
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
                className="text-neutral-400 hover:text-neutral-700"
                title="フォルダを追加"
              >
                <IconPlus className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => setFoldersOpen((v) => !v)}
              className="text-neutral-400 transition hover:text-neutral-600"
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
                  className="mx-1 mt-1 w-[calc(100%-0.5rem)] rounded-xl border border-brand-300 bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400"
                />
              )}
              {/* ゴミ箱はフォルダ一覧の一番下に、少し間をあけて置く。UI 上の並び
                  だけの話で、データ上はフォルダではない（View も type:"trash" の
                  まま）。折りたたみの中に入れてあるので、フォルダを閉じると
                  一緒に隠れる。 */}
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
            </>
          )}
        </div>

        {/* タグ一覧（折り返すチップ表示）。見出しのチェブロンで開閉できる */}
        <div className="pt-3">
          <button
            onClick={() => setTagsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 pb-1 text-neutral-400 transition hover:text-neutral-600"
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

      <div className="safe-bottom flex items-center gap-2 border-t border-brand-200/60 p-2">
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
