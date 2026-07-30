"use client";

import { useRouter } from "next/navigation";
import { useNotes } from "@/lib/store";
import NoteEditor from "./NoteEditor";

export default function StandaloneNote({ noteId }: { noteId: string }) {
  const router = useRouter();
  const { notes, loading } = useNotes();
  const note = notes.find((n) => n.id === noteId) ?? null;

  // 閉じるボタンの戻り先。この画面には2通りの入り口がある。
  //
  //  1) PC の「別ウィンドウで開く」… window.open で開いた独立ウィンドウ。
  //     opener があるので window.close() で閉じられる（従来どおり）。
  //  2) プッシュ通知のタップ … opener が無いため window.close() は無視される。
  //     閉じるボタンを押しても何も起きなかったので、アプリ本体へ戻す。
  //
  // 戻った先の見せ方（iPad は3分割のままこのメモを開く／iPhone はメモ一覧）は、
  // 画面幅に応じて AppShell 側が ?note= を見て決める。
  function handleBack() {
    if (window.opener) {
      window.close();
      // ブラウザが close を拒否することがあるので、閉じられなければ戻す
      window.setTimeout(() => router.replace(`/?note=${noteId}`), 150);
      return;
    }
    router.replace(`/?note=${noteId}`);
  }

  return (
    <div className="h-app-screen bg-white">
      {note ? (
        <NoteEditor note={note} standalone onBack={handleBack} />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-neutral-400">
          {loading ? "読み込み中…" : "メモが見つかりません"}
        </div>
      )}
    </div>
  );
}
