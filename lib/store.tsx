"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Note,
  type Folder,
  type NoteType,
  SHORT_NOTE_DAYS,
} from "@/lib/types";

interface NotesContextValue {
  notes: Note[];
  folders: Folder[];
  loading: boolean;
  userId: string;
  createNote: (partial?: Partial<Note>) => Promise<Note | null>;
  updateNote: (id: string, patch: Partial<Note>, immediate?: boolean) => void;
  setNoteType: (id: string, type: NoteType) => void;
  togglePin: (id: string) => void;
  trashNote: (id: string) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  deleteNotePermanently: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  createFolder: (name: string) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
}

const NotesContext = createContext<NotesContextValue | null>(null);

// 今から N 日後の ISO 文字列
function daysFromNowISO(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function NotesProvider({
  userId,
  initialNotes = [],
  initialFolders = [],
  children,
}: {
  userId: string;
  initialNotes?: Note[];
  initialFolders?: Folder[];
  children: React.ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  // メモ/フォルダはサーバー側で先読み済みのため常に false
  // （NotesContextValue の互換性のため型としては残す）
  const [loading] = useState(false);

  // デバウンス保存用タイマーと、保存中ノートの管理
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingPatches = useRef<Record<string, Partial<Note>>>({});
  const savingIds = useRef<Set<string>>(new Set());
  // 直近にローカル編集した時刻（リアルタイム上書きの誤爆防止）
  const lastEditedAt = useRef<Record<string, number>>({});

  // リアルタイム購読（他デバイスの変更を反映）
  useEffect(() => {
    const channel = supabase
      .channel("realtime-notes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setNotes((prev) => prev.filter((x) => x.id !== old.id));
            return;
          }
          const row = payload.new as Note;
          // 自分が編集中・保存直後のノートはローカルを優先し上書きしない
          if (savingIds.current.has(row.id)) return;
          if (Date.now() - (lastEditedAt.current[row.id] ?? 0) < 3000) return;
          setNotes((prev) => {
            const idx = prev.findIndex((x) => x.id === row.id);
            if (idx === -1) return [row, ...prev];
            const copy = [...prev];
            copy[idx] = row;
            return copy;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "folders", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setFolders((prev) => prev.filter((x) => x.id !== old.id));
            return;
          }
          const row = payload.new as Folder;
          setFolders((prev) => {
            const idx = prev.findIndex((x) => x.id === row.id);
            if (idx === -1) return [...prev, row];
            const copy = [...prev];
            copy[idx] = row;
            return copy;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  // ローカル状態を1件更新
  const patchLocal = useCallback((id: string, patch: Partial<Note>) => {
    lastEditedAt.current[id] = Date.now();
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n,
      ),
    );
  }, []);

  // DB へ保存（デバウンスされた差分をまとめて）
  const flushSave = useCallback(
    async (id: string) => {
      const patch = pendingPatches.current[id];
      delete pendingPatches.current[id];
      if (!patch || Object.keys(patch).length === 0) return;
      savingIds.current.add(id);
      const { error } = await supabase.from("notes").update(patch).eq("id", id);
      savingIds.current.delete(id);
      if (error) console.error("保存に失敗:", error.message);
    },
    [supabase],
  );

  const updateNote = useCallback(
    (id: string, patch: Partial<Note>, immediate = false) => {
      patchLocal(id, patch);
      pendingPatches.current[id] = { ...pendingPatches.current[id], ...patch };
      if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
      if (immediate) {
        flushSave(id);
      } else {
        saveTimers.current[id] = setTimeout(() => flushSave(id), 700);
      }
    },
    [patchLocal, flushSave],
  );

  const createNote = useCallback(
    async (partial: Partial<Note> = {}) => {
      const type: NoteType = partial.type ?? "long";
      const insert = {
        user_id: userId,
        folder_id: partial.folder_id ?? null,
        title: partial.title ?? "",
        body: partial.body ?? "",
        type,
        status: "active" as const,
        tags: partial.tags ?? [],
        expires_at: type === "short" ? daysFromNowISO(SHORT_NOTE_DAYS) : null,
      };
      const { data, error } = await supabase
        .from("notes")
        .insert(insert)
        .select()
        .single();
      if (error) {
        console.error("作成に失敗:", error.message);
        return null;
      }
      const note = data as Note;
      setNotes((prev) => [note, ...prev]);
      return note;
    },
    [supabase, userId],
  );

  const setNoteType = useCallback(
    (id: string, type: NoteType) => {
      const patch: Partial<Note> =
        type === "short"
          ? { type, expires_at: daysFromNowISO(SHORT_NOTE_DAYS) }
          : { type, expires_at: null };
      updateNote(id, patch, true);
    },
    [updateNote],
  );

  const togglePin = useCallback(
    (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      updateNote(id, { pinned: !note.pinned }, true);
    },
    [notes, updateNote],
  );

  const trashNote = useCallback(
    async (id: string) => {
      patchLocal(id, { status: "trashed", trashed_at: new Date().toISOString() });
      await supabase
        .from("notes")
        .update({ status: "trashed", trashed_at: new Date().toISOString() })
        .eq("id", id);
    },
    [supabase, patchLocal],
  );

  const restoreNote = useCallback(
    async (id: string) => {
      const note = notes.find((n) => n.id === id);
      // 短期メモを復元するときは期限を今から7日後に再設定
      const patch: Partial<Note> = {
        status: "active",
        trashed_at: null,
        expires_at: note?.type === "short" ? daysFromNowISO(SHORT_NOTE_DAYS) : null,
      };
      patchLocal(id, patch);
      await supabase.from("notes").update(patch).eq("id", id);
    },
    [supabase, notes, patchLocal],
  );

  const deleteNotePermanently = useCallback(
    async (id: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      await supabase.from("notes").delete().eq("id", id);
    },
    [supabase],
  );

  const emptyTrash = useCallback(async () => {
    const trashedIds = notes.filter((n) => n.status === "trashed").map((n) => n.id);
    if (trashedIds.length === 0) return;
    setNotes((prev) => prev.filter((n) => n.status !== "trashed"));
    await supabase.from("notes").delete().in("id", trashedIds);
  }, [supabase, notes]);

  const createFolder = useCallback(
    async (name: string) => {
      const { data, error } = await supabase
        .from("folders")
        .insert({ user_id: userId, name, sort_order: folders.length })
        .select()
        .single();
      if (error) {
        console.error("フォルダ作成に失敗:", error.message);
        return null;
      }
      const folder = data as Folder;
      setFolders((prev) => [...prev, folder]);
      return folder;
    },
    [supabase, userId, folders.length],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
      await supabase.from("folders").update({ name }).eq("id", id);
    },
    [supabase],
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      setFolders((prev) => prev.filter((f) => f.id !== id));
      // フォルダ内メモは folder_id が null になる（DB 側 ON DELETE SET NULL）
      setNotes((prev) =>
        prev.map((n) => (n.folder_id === id ? { ...n, folder_id: null } : n)),
      );
      await supabase.from("folders").delete().eq("id", id);
    },
    [supabase],
  );

  const value: NotesContextValue = {
    notes,
    folders,
    loading,
    userId,
    createNote,
    updateNote,
    setNoteType,
    togglePin,
    trashNote,
    restoreNote,
    deleteNotePermanently,
    emptyTrash,
    createFolder,
    renameFolder,
    deleteFolder,
  };

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes は NotesProvider の中で使ってください");
  return ctx;
}
