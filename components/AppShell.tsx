"use client";

import { useMemo, useState } from "react";
import { useNotes } from "@/lib/store";
import { type Note } from "@/lib/types";
import { stripHtml } from "@/lib/utils";
import Sidebar, { type View } from "./Sidebar";
import NoteList from "./NoteList";
import NoteEditor from "./NoteEditor";
import SettingsDialog from "./SettingsDialog";

export default function AppShell({ userEmail }: { userEmail: string }) {
  const { notes, folders, loading, createNote } = useNotes();

  const [view, setView] = useState<View>({ type: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // md 以上でフォルダ一覧（サイドバー）を最小化しているか
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // 現在のビュー＋検索でフィルタしたメモ一覧
  const visibleNotes = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list: Note[];
    if (q) {
      // 検索はゴミ箱を除く全メモ横断（タイトル・本文・フォルダ名・タグ）
      list = notes.filter((n) => n.status === "active");
      const folderName = (id: string | null) =>
        folders.find((f) => f.id === id)?.name?.toLowerCase() ?? "";
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          stripHtml(n.body).toLowerCase().includes(q) ||
          folderName(n.folder_id).includes(q) ||
          (n.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    } else if (view.type === "trash") {
      list = notes.filter((n) => n.status === "trashed");
    } else if (view.type === "short") {
      // 短期メモフォルダ（⑧）：type=short のアクティブなメモ
      list = notes.filter((n) => n.status === "active" && n.type === "short");
    } else if (view.type === "folder") {
      list = notes.filter(
        (n) => n.status === "active" && n.folder_id === view.folderId,
      );
    } else if (view.type === "tag") {
      list = notes.filter(
        (n) => n.status === "active" && (n.tags ?? []).includes(view.tag),
      );
    } else {
      list = notes.filter((n) => n.status === "active");
    }

    // ピン留め優先 → 更新日時の新しい順
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });
  }, [notes, folders, view, query]);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  function changeView(v: View) {
    setView(v);
    setSelectedId(null);
    setQuery("");
    setSidebarOpen(false);
    setFullscreen(false);
  }

  function closeEditor() {
    setSelectedId(null);
    setFullscreen(false);
  }

  async function handleCreate() {
    const folderId = view.type === "folder" ? view.folderId : null;
    const tag = view.type === "tag" ? [view.tag] : undefined;
    const note = await createNote({ folder_id: folderId, type: "short", tags: tag });
    if (note) setSelectedId(note.id);
  }

  function openInWindow() {
    if (!selectedId) return;
    window.open(
      `/note/${selectedId}`,
      `flow-note-${selectedId}`,
      "popup,width=480,height=720,noopener",
    );
  }

  return (
    <div className="h-app-screen flex overflow-hidden bg-brand-50 dark:bg-neutral-950">
      {/* サイドバー（モバイルはドロワー / md以上は最小化可能 / 全画面時は非表示） */}
      <div
        className={`fixed inset-y-0 left-0 z-30 w-64 transform transition-transform duration-300 ease-out md:static md:translate-x-0 md:transition-[width,opacity] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${fullscreen ? "md:hidden" : ""} ${
          sidebarCollapsed
            ? "md:w-0 md:overflow-hidden md:opacity-0"
            : "md:w-64 md:opacity-100"
        }`}
      >
        <Sidebar
          view={view}
          onChangeView={changeView}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSidebarOpen(false);
          }}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      </div>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* メモ一覧（全画面時は非表示）
          ※iPad縦(768〜834px)でも本文が潰れないよう、一覧の幅は控えめにする */}
      <div
        className={`w-full shrink-0 flex-col border-r border-brand-200/60 dark:border-neutral-800 md:flex md:w-72 lg:w-80 ${
          selectedId ? "hidden md:flex" : "flex"
        } ${fullscreen ? "md:hidden" : ""}`}
      >
        <NoteList
          notes={visibleNotes}
          loading={loading}
          view={view}
          query={query}
          selectedId={selectedId}
          onQueryChange={setQuery}
          onSelect={setSelectedId}
          onCreate={handleCreate}
          sidebarCollapsed={sidebarCollapsed}
          onOpenMenu={() => {
            setSidebarOpen(true); // モバイル：ドロワーを開く
            setSidebarCollapsed(false); // md以上：最小化を解除
          }}
        />
      </div>

      {/* エディタ */}
      <div
        className={`flex-1 flex-col ${selectedId ? "flex" : "hidden md:flex"}`}
      >
        {selectedNote ? (
          // key で開くたびに再マウントし、モバイルでは右スライドを再生（③）
          <div
            key={selectedNote.id}
            className="flow-slide-in-right flex h-full flex-col"
          >
            <NoteEditor
              note={selectedNote}
              onBack={closeEditor}
              isFullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((v) => !v)}
              onOpenWindow={openInWindow}
            />
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center text-neutral-400 md:flex">
            <div className="text-center">
              <div className="mb-2 text-4xl">🪶</div>
              <p className="text-sm">メモを選択するか、新規作成してください</p>
            </div>
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsDialog
          userEmail={userEmail}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
