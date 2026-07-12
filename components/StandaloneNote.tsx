"use client";

import { useNotes } from "@/lib/store";
import NoteEditor from "./NoteEditor";

export default function StandaloneNote({ noteId }: { noteId: string }) {
  const { notes, loading } = useNotes();
  const note = notes.find((n) => n.id === noteId) ?? null;

  return (
    <div className="h-app-screen bg-white dark:bg-neutral-950">
      {note ? (
        <NoteEditor note={note} standalone onBack={() => window.close()} />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-neutral-400">
          {loading ? "読み込み中…" : "メモが見つかりません"}
        </div>
      )}
    </div>
  );
}
