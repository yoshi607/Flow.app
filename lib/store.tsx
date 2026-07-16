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
import { fetchInitialNotesData } from "@/lib/supabase/queries";
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
  reorderFolders: (orderedIds: string[]) => Promise<void>;
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
  const refreshing = useRef(false);
  // 一度でも購読に成功したか（初回とその後の再接続を区別するため）
  const subscribedOnce = useRef(false);

  // このメモはローカルを優先すべきか
  // （保存中 or 未保存の差分が残っている or 直近3秒に自分が編集した）。
  // pendingPatches を見ないと、オフライン中などに保存できなかった編集が
  // 3秒経過後の refresh でサーバーの古い内容に巻き戻されてしまう。
  const keepLocal = useCallback(
    (id: string) =>
      savingIds.current.has(id) ||
      pendingPatches.current[id] !== undefined ||
      Date.now() - (lastEditedAt.current[id] ?? 0) < 3000,
    [],
  );

  // DB から最新を取り直して追いつく。
  // リアルタイム購読は「切断中に起きた変更」を受け取れないため、
  // アプリ復帰・再接続・オンライン復帰のタイミングでこれを呼ぶ。
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const { notes: fresh, folders: freshFolders } =
        await fetchInitialNotesData(supabase);

      setNotes((prev) => {
        const prevById = new Map(prev.map((n) => [n.id, n]));
        // 編集中のメモはサーバー値で上書きしない（入力中の文字が消えるのを防ぐ）
        const merged = fresh.map((n) =>
          keepLocal(n.id) ? (prevById.get(n.id) ?? n) : n,
        );
        // 取得結果に無い＝他端末で削除済み。ただし編集直後のものは念のため残す
        const freshIds = new Set(fresh.map((n) => n.id));
        const localOnly = prev.filter(
          (n) => !freshIds.has(n.id) && keepLocal(n.id),
        );
        return [...localOnly, ...merged];
      });
      setFolders(freshFolders);
    } finally {
      refreshing.current = false;
    }
  }, [supabase, keepLocal]);

  // アプリへ復帰した/オンラインに戻ったときに最新へ追いつく
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

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
          // 自分が編集中・保存直後・未保存の差分が残っているノートは
          // ローカルを優先し上書きしない
          if (keepLocal(row.id)) return;
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
      .subscribe((status) => {
        // 再接続時は、切断中に取りこぼした変更に追いつくため取り直す。
        // 初回の購読成功時はサーバー側で先読み済みなのでスキップする。
        if (status === "SUBSCRIBED") {
          if (subscribedOnce.current) refresh();
          subscribedOnce.current = true;
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, userId, refresh, keepLocal]);

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
      let error: { message: string } | null = null;
      try {
        ({ error } = await supabase.from("notes").update(patch).eq("id", id));
      } catch (e) {
        // オフライン等で fetch 自体が失敗した場合
        error = { message: e instanceof Error ? e.message : "通信エラー" };
      }
      savingIds.current.delete(id);
      if (error) {
        console.error("保存に失敗:", error.message);
        // 失敗した差分は捨てずに再キューし、次の編集・オンライン復帰・
        // アプリ非表示時の flush で再送する。保存待ちの間により新しい編集が
        // 入っていた場合はそちらを優先してマージする。
        pendingPatches.current[id] = { ...patch, ...pendingPatches.current[id] };
      }
    },
    [supabase],
  );

  // 保存待ちの差分を全て即時保存する。
  // 350ms のデバウンス待ちの間にアプリを閉じたり切り替えたりすると
  // （特に iOS はバックグラウンドでタイマーが止まる）最後の入力が
  // 保存されないため、画面が隠れる瞬間に flush する。
  const flushAll = useCallback(() => {
    for (const id of Object.keys(pendingPatches.current)) {
      if (saveTimers.current[id]) {
        clearTimeout(saveTimers.current[id]);
        delete saveTimers.current[id];
      }
      void flushSave(id);
    }
  }, [flushSave]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    document.addEventListener("visibilitychange", onHidden);
    // タブを閉じる/リロードする直前の最後の望み（ベストエフォート）
    window.addEventListener("pagehide", flushAll);
    // オフラインで失敗して再キューされた差分を、復帰したら再送する
    window.addEventListener("online", flushAll);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("online", flushAll);
    };
  }, [flushAll]);

  const updateNote = useCallback(
    (id: string, patch: Partial<Note>, immediate = false) => {
      patchLocal(id, patch);
      pendingPatches.current[id] = { ...pendingPatches.current[id], ...patch };
      if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
      if (immediate) {
        flushSave(id);
      } else {
        // 入力が落ち着いてから保存。短すぎると書き込みが増え、長すぎると
        // 他端末への同期が遅く感じるためこの値にしている。
        saveTimers.current[id] = setTimeout(() => flushSave(id), 350);
      }
    },
    [patchLocal, flushSave],
  );

  const createNote = useCallback(
    async (partial: Partial<Note> = {}) => {
      const type: NoteType = partial.type ?? "short";
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
      const note = notes.find((n) => n.id === id);
      // すでに同じ type の場合は期限を延長しない（再クリックで7日が延びるのを防ぐ）
      if (note && note.type === type) return;
      const patch: Partial<Note> =
        type === "short"
          ? { type, expires_at: daysFromNowISO(SHORT_NOTE_DAYS) }
          : { type, expires_at: null };
      updateNote(id, patch, true);
    },
    [notes, updateNote],
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

  // フォルダの並べ替え（④）。新しい並び順の id 配列を受け取り、
  // ローカルを即時更新してから各フォルダの sort_order を保存する。
  const reorderFolders = useCallback(
    async (orderedIds: string[]) => {
      setFolders((prev) => {
        const byId = new Map(prev.map((f) => [f.id, f]));
        const next = orderedIds
          .map((id, i) => {
            const f = byId.get(id);
            return f ? { ...f, sort_order: i } : null;
          })
          .filter((f): f is Folder => f !== null);
        return next;
      });
      await Promise.all(
        orderedIds.map((id, i) =>
          supabase.from("folders").update({ sort_order: i }).eq("id", id),
        ),
      );
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
    reorderFolders,
  };

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes は NotesProvider の中で使ってください");
  return ctx;
}
