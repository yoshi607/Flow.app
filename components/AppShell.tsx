"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import { useNotes } from "@/lib/store";
import { type Note } from "@/lib/types";
import { stripHtml } from "@/lib/utils";
import Sidebar, { type View } from "./Sidebar";
import NoteList from "./NoteList";

// 本文エディタは Tiptap 一式・手書き・画像書き出しを連れてくるため重い。
// 起動時（メモ未選択）は不要なので、初期JSから切り離して遅延読み込みする。
// ※起動直後にアイドルで先読みするので、実際に開く時には既に読み込み済みで、
//   ＋ボタンの展開アニメーション（寸法の実測）も従来どおり動く。
const NoteEditor = dynamic(() => import("./NoteEditor"), { ssr: false });
// 設定ダイアログも開くまで不要
const SettingsDialog = dynamic(() => import("./SettingsDialog"), { ssr: false });

export default function AppShell({ userEmail }: { userEmail: string }) {
  const { notes, folders, loading, createNote, trashNote, deleteNotePermanently } =
    useNotes();

  const [view, setView] = useState<View>({ type: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // md 以上でフォルダ一覧（サイドバー）を最小化しているか
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // 戻るアニメーション再生中（モバイル）
  const [closing, setClosing] = useState(false);
  // ＋ボタンから作った直後のメモ。一覧で「ぽんっ」と出す演出に使う
  const [poppedId, setPoppedId] = useState<string | null>(null);
  // ＋ボタンからの展開を再生中。この間はモバイルの右スライドを重ねない
  const [expanding, setExpanding] = useState(false);
  // 削除アニメーション再生中のメモ
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 全画面から抜けた直後。メモ一覧を左から滑り込ませる
  const [listSlidingIn, setListSlidingIn] = useState(false);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // --- ジェスチャー追従（指の動きに完全同期させる） ---
  // dragX: サイドバーの現在位置(px, -幅〜0)。null なら CSS 側の開閉に任せる
  const [dragX, setDragX] = useState<number | null>(null);
  // backX: 「戻る」で本文を右へずらした量(px)。null なら通常表示
  const [backX, setBackX] = useState<number | null>(null);
  // 指を離した後の確定/復帰の最中か（この間だけ transition を効かせる）
  const [settling, setSettling] = useState(false);
  const gesture = useRef<{
    kind: "none" | "sidebar" | "back";
    startX: number;
    startY: number;
    base: number;
    axis: "none" | "x" | "y";
  }>({ kind: "none", startX: 0, startY: 0, base: 0, axis: "none" });

  // 画面左端からのドラッグとみなす幅
  const EDGE_PX = 28;

  // 一覧を描き終えた後、手が空いた時間にエディタ本体を先読みしておく。
  // 起動の速さは保ったまま、メモを開く瞬間は待たされない。
  useEffect(() => {
    const preload = () => {
      void import("./NoteEditor");
    };
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      ric(preload);
      return;
    }
    const t = window.setTimeout(preload, 1200); // Safari 等の保険
    return () => window.clearTimeout(t);
  }, []);

  const isMobile = () =>
    typeof window !== "undefined" &&
    !window.matchMedia("(min-width: 768px)").matches;

  const sidebarWidth = () => sidebarRef.current?.offsetWidth || 256;

  function onTouchStart(e: React.TouchEvent) {
    if (!isMobile() || settling) return;
    const t = e.touches[0];
    const fromEdge = t.clientX <= EDGE_PX;

    let kind: "none" | "sidebar" | "back" = "none";
    let base = 0;
    if (sidebarOpen) {
      // 開いている間はどこを掴んでも閉じる方向へ動かせる
      kind = "sidebar";
      base = 0;
    } else if (fromEdge && selectedId) {
      // メモを開いている時の左端ドラッグは「一覧へ戻る」
      kind = "back";
    } else if (fromEdge) {
      // それ以外の左端ドラッグはサイドバーを引き出す
      kind = "sidebar";
      base = -sidebarWidth();
    }
    gesture.current = {
      kind,
      startX: t.clientX,
      startY: t.clientY,
      base,
      axis: "none",
    };
  }

  function onTouchMove(e: React.TouchEvent) {
    const g = gesture.current;
    if (g.kind === "none") return;
    const t = e.touches[0];
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    // 最初の動きで縦横どちらの操作かを決める（縦スクロールは邪魔しない）
    if (g.axis === "none") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "y") {
        g.kind = "none";
        return;
      }
    }

    if (g.kind === "sidebar") {
      const w = sidebarWidth();
      let next = g.base + dx;
      if (next > 0) next = 0;
      if (next < -w) next = -w;
      setDragX(next);
    } else {
      // 戻るは右方向のみ
      setBackX(Math.max(0, dx));
    }
  }

  function onTouchEnd() {
    const g = gesture.current;
    gesture.current = { kind: "none", startX: 0, startY: 0, base: 0, axis: "none" };

    if (g.kind === "sidebar" && dragX !== null) {
      // 半分より開いていれば開く。指を離した位置で開閉を確定する
      const open = dragX > -sidebarWidth() / 2;
      setSidebarOpen(open);
      setDragX(null);
      return;
    }

    if (g.kind === "back" && backX !== null) {
      const width = rootRef.current?.offsetWidth || window.innerWidth;
      setSettling(true);
      if (backX > width * 0.3) {
        // 確定：指の位置から画面外まで送り出してから閉じる
        setBackX(width);
        window.setTimeout(() => {
          setSelectedId(null);
          setFullscreen(false);
          setBackX(null);
          setSettling(false);
        }, 260);
      } else {
        // 復帰：元の位置へ戻す
        setBackX(0);
        window.setTimeout(() => {
          setBackX(null);
          setSettling(false);
        }, 260);
      }
    }
  }

  // 全画面の切り替え（展開アニメーション）。
  // 「別画面に切り替わった」ではなく「このペインが育って画面になった」と
  // 感じさせるため、切替の前後で位置・サイズを実測し、元の姿から現在の姿へ
  // 連続的に変形させる（FLIP）。動き始めは速く、終わりで減速する。
  function toggleFullscreen() {
    const el = editorPaneRef.current;
    // 動きを止める設定の人や、要素が取れない場合は素直に切り替える
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduced || typeof el.animate !== "function") {
      setFullscreen((v) => !v);
      return;
    }

    const first = el.getBoundingClientRect();
    // レイアウトを確定させてから最終形を測る
    flushSync(() => setFullscreen((v) => !v));
    const last = el.getBoundingClientRect();
    if (!last.width || !last.height) return;

    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width / last.width;
    const sy = first.height / last.height;
    // 変化が無いなら何もしない
    if (!dx && !dy && sx === 1 && sy === 1) return;

    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: "none" },
      ],
      {
        duration: 340,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        fill: "none",
      },
    );
  }

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

  // 一覧へ戻る。モバイルでは右へスライドさせてから閉じる（③の逆再生）
  function closeEditor() {
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches;
    if (isDesktop) {
      setSelectedId(null);
      setFullscreen(false);
      return;
    }
    setClosing(true);
    window.setTimeout(() => {
      setSelectedId(null);
      setFullscreen(false);
      setClosing(false);
    }, 220); // CSS の flow-slide-out-right とほぼ同じ長さ
  }

  // ＋ボタンからの新規作成。origin は押されたボタンの画面上の位置。
  async function handleCreate(origin?: DOMRect) {
    const folderId = view.type === "folder" ? view.folderId : null;
    const tag = view.type === "tag" ? [view.tag] : undefined;
    const note = await createNote({ folder_id: folderId, type: "short", tags: tag });
    if (!note) return;

    // 一覧側：新しい行を上から「ぽんっ」と落として収める
    const id = note.id;
    setPoppedId(id);
    window.setTimeout(
      () => setPoppedId((cur) => (cur === id ? null : cur)),
      600,
    );

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pane = editorPaneRef.current;
    if (!origin || reduced || !pane || typeof pane.animate !== "function") {
      setSelectedId(id);
      return;
    }

    // 本文側：押した＋ボタンから育ったように見せる。
    // ペイン全体をボタンの大きさまで潰すと文字が極端に歪むため、
    // 変形の「原点」だけをボタンの中心に合わせ、拡大率は控えめにして
    // 不透明度で繋ぐ。
    setExpanding(true);
    flushSync(() => setSelectedId(id));
    const rect = pane.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      setExpanding(false);
      return;
    }
    const ox = origin.left + origin.width / 2 - rect.left;
    const oy = origin.top + origin.height / 2 - rect.top;
    const origin2 = `${ox}px ${oy}px`;
    const anim = pane.animate(
      [
        { transformOrigin: origin2, transform: "scale(0.2)", opacity: 0 },
        { transformOrigin: origin2, opacity: 1, offset: 0.45 },
        { transformOrigin: origin2, transform: "scale(1)", opacity: 1 },
      ],
      {
        duration: 360,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        fill: "none",
      },
    );
    const done = () => setExpanding(false);
    anim.addEventListener("finish", done);
    anim.addEventListener("cancel", done);
  }

  // メモの削除。一覧の行は左へ、開いている本文は右へ滑り出て消え、
  // そのあと本文には最新のメモを表示する。
  // 一覧から消しても本文の3点メニューから消しても同じ動きになるよう、
  // 削除の入口をここに一本化し、store の更新は再生が終わるまで待つ
  // （先に消すと、消える様子を見せる相手がいなくなるため）。
  function requestDelete(id: string, permanent = false) {
    if (
      permanent &&
      !window.confirm("このメモを完全に削除しますか？（元に戻せません）")
    )
      return;

    const wasSelected = id === selectedId;
    const wasFullscreen = wasSelected && fullscreen;
    // 消したあとに開く「最新のメモ」＝ 消すメモを除いた一覧の先頭。
    // 残りが無ければ未選択に戻す。
    const nextId = wasSelected
      ? (visibleNotes.find((n) => n.id !== id)?.id ?? null)
      : null;

    const commit = () => {
      if (permanent) deleteNotePermanently(id);
      else trashNote(id);
      setDeletingId((cur) => (cur === id ? null : cur));
      if (!wasSelected) return;

      setSelectedId((cur) => (cur === id ? nextId : cur));
      setClosing(false);
      setBackX(null);

      // 全画面で消した場合は全画面を抜け、メモ一覧を左から滑り込ませる。
      // フォルダ一覧は最小化のままにする。
      if (wasFullscreen) {
        setFullscreen(false);
        setSidebarCollapsed(true);
        setListSlidingIn(true);
        window.setTimeout(() => setListSlidingIn(false), 340);
      } else if (!nextId) {
        // 表示するメモが無くなったら全画面のままだと何も見えなくなる
        setFullscreen(false);
      }
    };

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      commit();
      return;
    }
    setDeletingId(id);
    window.setTimeout(commit, 260); // CSS の削除アニメーションと同じ長さ
  }

  function openInWindow() {
    if (!selectedId) return;
    window.open(
      `/note/${selectedId}`,
      `flow-note-${selectedId}`,
      "popup,width=480,height=720,noopener",
    );
  }

  const dragging = dragX !== null || backX !== null;

  return (
    <div
      ref={rootRef}
      className="h-app-screen flex overflow-hidden bg-brand-50 dark:bg-neutral-950"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* サイドバー（モバイルはドロワー / md以上は最小化可能 / 全画面時は非表示）
          ※最小化の幅変化（md:w-64↔md:w-0）は「即時」にしている（transition なし）。
            幅を連続アニメーションすると右のエディタ幅が毎フレーム変わり、本文が
            1文字ずつ折り返し直されて見える。幅は1回で確定させ、アニメーションは
            下の内側ラッパーの transform（translateX）だけで見せる＝リフローしない。 */}
      <div
        ref={sidebarRef}
        style={
          dragX !== null ? { transform: `translateX(${dragX}px)` } : undefined
        }
        className={`fixed inset-y-0 left-0 z-30 w-64 transform md:static md:translate-x-0 ${
          dragX !== null
            ? "flow-sidebar-drag"
            : sidebarOpen
              ? "flow-sidebar-enter translate-x-0"
              : "flow-sidebar-leave -translate-x-full"
        } ${fullscreen ? "md:hidden" : ""} ${
          sidebarCollapsed ? "md:w-0" : "md:w-64"
        }`}
      >
        {/* 内側ラッパー：幅は固定のまま、最小化時は左へスライドさせる（md のみ）。
            transform はレイアウトを起こさないので本文の再折り返しが発生しない。 */}
        <div
          className={`h-full w-64 md:transition-transform md:duration-300 md:ease-out ${
            sidebarCollapsed ? "md:-translate-x-full" : "md:translate-x-0"
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
      </div>
      {/* 背景タップでも閉じる。ドラッグ中は暗さも指の位置に追従させる */}
      {(sidebarOpen || dragX !== null) && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          style={
            dragX !== null
              ? {
                  opacity: 1 + dragX / sidebarWidth(),
                  transition: "none",
                }
              : undefined
          }
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* メイン（一覧＋本文）。サイドバーが出ている間は奥へ引っ込める */}
      <div
        className={`flex min-w-0 flex-1 ${
          sidebarOpen && dragX === null ? "flow-main-pushed" : "flow-main-idle"
        }`}
      >
      {/* メモ一覧（全画面時は非表示）
          ※iPad縦(768〜834px)でも本文が潰れないよう、一覧の幅は控えめにする */}
      <div
        className={`w-full shrink-0 flex-col border-r border-brand-200/60 dark:border-neutral-800 md:flex md:w-72 lg:w-80 ${
          selectedId ? "hidden md:flex" : "flex"
        } ${fullscreen ? "md:hidden" : ""} ${
          listSlidingIn ? "flow-slide-in-left" : ""
        }`}
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
          onRequestDelete={requestDelete}
          poppedId={poppedId}
          deletingId={deletingId}
          sidebarCollapsed={sidebarCollapsed}
          onOpenMenu={() => {
            // モバイルのみドロワーを開く。md以上で立てると、暗幕（閉じる手段）が
            // md:hidden のため開きっぱなしの状態が残ってしまう
            if (isMobile()) setSidebarOpen(true);
            setSidebarCollapsed(false); // md以上：最小化を解除
          }}
        />
      </div>

      {/* エディタ（全画面ボタンでは、このペインが育って画面になるよう変形させる）
          min-w-0：画像や手書きなど幅を持つ要素が入っても、ペインが利用可能幅を
          超えて広がらないようにする（iPad縦の3分割で右側が見切れるのを防ぐ） */}
      <div
        ref={editorPaneRef}
        className={`min-w-0 flex-1 flex-col ${selectedId ? "flex" : "hidden md:flex"}`}
      >
        {selectedNote ? (
          // key で開くたびに再マウントし、モバイルでは右スライドを再生。
          // 指で戻している最中は指の位置に完全同期させる。
          <div
            key={selectedNote.id}
            style={
              backX !== null ? { transform: `translateX(${backX}px)` } : undefined
            }
            className={`flex h-full flex-col ${
              deletingId === selectedNote.id
                ? "flow-note-delete-out"
                : backX !== null
                  ? settling
                    ? "flow-drag-settle"
                    : "flow-drag-follow"
                  : closing
                    ? "flow-slide-out-right"
                    : expanding
                      ? "" // ＋からの展開中は右スライドを重ねない
                      : "flow-slide-in-right"
            }`}
          >
            <NoteEditor
              note={selectedNote}
              onBack={closeEditor}
              isFullscreen={fullscreen}
              onToggleFullscreen={toggleFullscreen}
              onOpenWindow={openInWindow}
              onRequestDelete={(permanent) =>
                requestDelete(selectedNote.id, permanent)
              }
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
