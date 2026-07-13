"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useNotes } from "@/lib/store";
import { type Note } from "@/lib/types";
import { shortNoteRemainingDays, trashRemainingDays } from "@/lib/utils";

// 録音ボタンを押した時だけ使うため遅延読み込みにし、メモを開く際の初期JSを減らす
const VoiceRecorder = dynamic(() => import("./VoiceRecorder"), { ssr: false });
import {
  IconBack,
  IconPin,
  IconMic,
  IconTrash,
  IconRestore,
  IconExpand,
  IconCompress,
  IconWindow,
  IconClose,
} from "./icons";

export default function NoteEditor({
  note,
  onBack,
  isFullscreen,
  onToggleFullscreen,
  onOpenWindow,
  standalone = false,
}: {
  note: Note;
  onBack: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onOpenWindow?: () => void;
  standalone?: boolean;
}) {
  const {
    folders,
    updateNote,
    setNoteType,
    togglePin,
    trashNote,
    restoreNote,
    deleteNotePermanently,
  } = useNotes();
  const [recording, setRecording] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const trashed = note.status === "trashed";
  const tags = note.tags ?? [];

  function handleVoiceResult(result: { title: string; text: string }) {
    setRecording(false);
    const newBody = note.body.trim()
      ? `${note.body.trim()}\n\n${result.text}`
      : result.text;
    const patch: Partial<Note> = { body: newBody };
    if (!note.title.trim() && result.title) patch.title = result.title;
    updateNote(note.id, patch, true);
  }

  function addTag(raw: string) {
    const tag = raw.trim().replace(/^#/, "");
    setTagInput("");
    if (!tag || tags.includes(tag)) return;
    updateNote(note.id, { tags: [...tags, tag] }, true);
  }

  function removeTag(tag: string) {
    updateNote(note.id, { tags: tags.filter((t) => t !== tag) }, true);
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      {/* ヘッダー */}
      <div
        className={`safe-top flex items-center gap-1 border-b border-brand-200/60 px-2 py-2 dark:border-neutral-800 ${
          standalone ? "" : ""
        }`}
      >
        <button
          onClick={onBack}
          className={`rounded-lg p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800 ${
            standalone ? "" : "md:hidden"
          }`}
          title={standalone ? "閉じる" : "戻る"}
        >
          {standalone ? <IconClose /> : <IconBack />}
        </button>

        <select
          value={note.folder_id ?? ""}
          disabled={trashed}
          onChange={(e) =>
            updateNote(note.id, { folder_id: e.target.value || null }, true)
          }
          className="rounded-lg bg-brand-100 px-2 py-1.5 text-sm outline-none disabled:opacity-50 dark:bg-neutral-800"
        >
          <option value="">フォルダなし</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {!trashed && (
          <>
            {onToggleFullscreen && (
              <button
                onClick={onToggleFullscreen}
                className="hidden rounded-lg p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800 md:block"
                title={isFullscreen ? "全画面を解除" : "全画面表示"}
              >
                {isFullscreen ? <IconCompress /> : <IconExpand />}
              </button>
            )}
            {onOpenWindow && (
              <button
                onClick={onOpenWindow}
                className="hidden rounded-lg p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800 md:block"
                title="別ウィンドウで開く"
              >
                <IconWindow />
              </button>
            )}
            <button
              onClick={() => togglePin(note.id)}
              className={`rounded-lg p-2 hover:bg-brand-100 dark:hover:bg-neutral-800 ${
                note.pinned ? "text-brand-500" : "text-neutral-500"
              }`}
              title={note.pinned ? "ピンを外す" : "ピン留め"}
            >
              <IconPin filled={note.pinned} />
            </button>
            <button
              onClick={() => setRecording(true)}
              className="rounded-lg p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
              title="音声メモ"
            >
              <IconMic />
            </button>
            <button
              onClick={() => {
                trashNote(note.id);
                onBack();
              }}
              className="rounded-lg p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
              title="ゴミ箱へ"
            >
              <IconTrash />
            </button>
          </>
        )}
      </div>

      {/* 短期/長期トグル or ゴミ箱バナー */}
      {trashed ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-200/60 bg-red-50 px-4 py-2 text-sm dark:border-neutral-800 dark:bg-red-500/10">
          <span className="text-red-700 dark:text-red-300">
            ゴミ箱にあります
            {(() => {
              const d = trashRemainingDays(note.trashed_at);
              return d !== null ? `（あと${d}日で完全削除）` : "";
            })()}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => {
              restoreNote(note.id);
              onBack();
            }}
            className="flex items-center gap-1 rounded-lg bg-brand-200 px-3 py-1.5 text-sm font-medium hover:bg-brand-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
          >
            <IconRestore className="h-4 w-4" /> 復元
          </button>
          <button
            onClick={() => {
              if (window.confirm("このメモを完全に削除しますか？（元に戻せません）")) {
                deleteNotePermanently(note.id);
                onBack();
              }
            }}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            完全に削除
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-200/60 px-4 py-2 dark:border-neutral-800">
          <div className="flex rounded-lg bg-brand-100 p-0.5 text-sm dark:bg-neutral-800">
            <button
              onClick={() => setNoteType(note.id, "long")}
              className={`rounded-md px-3 py-1 transition ${
                note.type === "long"
                  ? "bg-white shadow-sm dark:bg-neutral-950"
                  : "text-neutral-500"
              }`}
            >
              長期保存
            </button>
            <button
              onClick={() => setNoteType(note.id, "short")}
              className={`rounded-md px-3 py-1 transition ${
                note.type === "short"
                  ? "bg-white shadow-sm dark:bg-neutral-950"
                  : "text-neutral-500"
              }`}
            >
              短期（7日）
            </button>
          </div>
          {note.type === "short" &&
            (() => {
              const d = shortNoteRemainingDays(note.expires_at);
              return d !== null ? (
                <span className="text-xs text-orange-600 dark:text-orange-400">
                  あと{d}日で自動的にゴミ箱へ
                </span>
              ) : null;
            })()}
        </div>
      )}

      {/* タグ */}
      {!trashed && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-brand-200/60 px-4 py-2 dark:border-neutral-800">
          {tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              #{t}
              <button
                onClick={() => removeTag(t)}
                className="text-brand-500 hover:text-red-600"
                title="タグを削除"
              >
                <IconClose className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag(tagInput);
              } else if (e.key === "Backspace" && !tagInput && tags.length) {
                removeTag(tags[tags.length - 1]);
              }
            }}
            onBlur={() => tagInput && addTag(tagInput)}
            placeholder={tags.length ? "タグを追加" : "# タグを追加"}
            className="min-w-[6rem] flex-1 bg-transparent py-1 text-xs outline-none placeholder:text-neutral-400"
          />
        </div>
      )}

      {/* 本文 */}
      <input
        value={note.title}
        readOnly={trashed}
        onChange={(e) => updateNote(note.id, { title: e.target.value })}
        placeholder="タイトル"
        className="bg-transparent px-4 pt-4 text-2xl font-semibold tracking-tight outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
      />
      <textarea
        value={note.body}
        readOnly={trashed}
        onChange={(e) => updateNote(note.id, { body: e.target.value })}
        placeholder="ここにメモを入力…"
        className="thin-scroll flex-1 resize-none bg-transparent px-4 py-3 leading-relaxed outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
      />

      {recording && (
        <VoiceRecorder
          onResult={handleVoiceResult}
          onClose={() => setRecording(false)}
        />
      )}
    </div>
  );
}
