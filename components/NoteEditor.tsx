"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import { useNotes } from "@/lib/store";
import { useDevice } from "@/lib/useDevice";
import { createClient } from "@/lib/supabase/client";
import { type Note, type Attachment } from "@/lib/types";
import { shortNoteRemainingDays, trashRemainingDays, formatFileSize, shareNote } from "@/lib/utils";
import { toEditorHtml, toAppendedParagraphs } from "@/lib/richtext";
import { TranscriptCallout } from "@/lib/tiptap/transcriptCallout";
import { listAttachments, uploadAttachment, deleteAttachment } from "@/lib/attachments";
import RichTextToolbar from "./RichTextToolbar";
import FolderPickerSheet from "./FolderPickerSheet";

// 録音ボタンを押した時だけ使うため遅延読み込みにし、メモを開く際の初期JSを減らす
const VoiceRecorder = dynamic(() => import("./VoiceRecorder"), { ssr: false });
// 手書きキャンバスも同様に遅延読み込み（iPad で開いた時だけ必要）
const HandwritingCanvas = dynamic(() => import("./HandwritingCanvas"), { ssr: false });
import {
  IconBack,
  IconPin,
  IconMic,
  IconClip,
  IconFile,
  IconTrash,
  IconRestore,
  IconExpand,
  IconCompress,
  IconWindow,
  IconClose,
  IconDots,
  IconMove,
  IconPencil,
  IconArchive,
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
    userId,
    updateNote,
    setNoteType,
    togglePin,
    trashNote,
    restoreNote,
    deleteNotePermanently,
  } = useNotes();
  const [recording, setRecording] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const { isIPad } = useDevice();
  const supabase = useMemo(() => createClient(), []);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 録音中に書き込む対象のコールアウトを特定するID
  const sessionRef = useRef<string | null>(null);

  const trashed = note.status === "trashed";
  const tags = note.tags ?? [];

  // key={note.id} で都度マウントされるため、この effect は「ノートが
  // 開かれるたび1回」だけ走る（他デバイスでの添付操作はRealtime対象外）
  useEffect(() => {
    listAttachments(supabase, note.id).then(setAttachments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 添付はリアルタイム購読の対象外のため、アプリへ復帰した時に取り直して
  // 他端末での添付・削除に追いつく
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        listAttachments(supabase, note.id).then(setAttachments);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [supabase, note.id]);

  async function handleFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      try {
        const attachment = await uploadAttachment(supabase, userId, note.id, file);
        setAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "添付に失敗しました");
      }
    }
    setUploading(false);
  }

  // 手書きキャンバスで描いた内容を PNG 画像として添付に保存（①）
  async function handleDrawingSave(blob: Blob) {
    setDrawing(false);
    const file = new File([blob], `手書き-${Date.now()}.png`, { type: "image/png" });
    setUploading(true);
    try {
      const attachment = await uploadAttachment(supabase, userId, note.id, file);
      setAttachments((prev) => [...prev, attachment]);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "手書きの保存に失敗しました");
    }
    setUploading(false);
  }

  async function handleDeleteAttachment(attachment: Attachment) {
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    await deleteAttachment(supabase, attachment);
  }

  // key={note.id} で親から都度マウントされるため、ノート切り替え時は
  // このエディタインスタンス自体が再生成される（setContentでの手動同期は不要）
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !trashed,
    content: toEditorHtml(note.body),
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
      }),
      TranscriptCallout,
      TextStyle,
      Color,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? `見出し${node.attrs.level}` : "ここにメモを入力…",
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "thin-scroll flex-1 overflow-y-auto px-4 py-3 leading-relaxed outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      updateNote(note.id, { body: editor.getHTML() });
    },
  });

  // 録音開始：文字起こし用のコールアウトを本文末尾に置き、そこへ書き込んでいく
  function startRecording() {
    if (!editor) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now());
    sessionRef.current = id;
    editor
      .chain()
      .focus("end")
      .insertContent({
        type: "transcriptCallout",
        attrs: { sessionId: id, recording: true },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "聞き取り中…" }] },
        ],
      })
      .run();
    setRecording(true);
  }

  // sessionId が一致するコールアウトの中身を差し替える。
  // 位置はその都度探す（ユーザーが他所を編集して位置がずれても追従するため）
  function writeCallout(html: string, stillRecording: boolean) {
    const id = sessionRef.current;
    if (!editor || !id) return;

    let from: number | null = null;
    let to: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (from !== null) return false;
      if (node.type.name === "transcriptCallout" && node.attrs.sessionId === id) {
        from = pos;
        to = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    if (from === null || to === null) return;

    editor
      .chain()
      // 中身（開始/終了タグの内側）だけを差し替える。カーソルは動かさない
      .insertContentAt({ from: from + 1, to: to - 1 }, html, {
        updateSelection: false,
      })
      .command(({ tr }) => {
        // 上の差し替えで位置が変わるため、改めて探して属性を更新する
        let pos: number | null = null;
        tr.doc.descendants((node, p) => {
          if (pos !== null) return false;
          if (
            node.type.name === "transcriptCallout" &&
            node.attrs.sessionId === id
          ) {
            pos = p;
            return false;
          }
          return true;
        });
        if (pos === null) return true;
        const node = tr.doc.nodeAt(pos);
        if (node) {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            recording: stillRecording,
          });
        }
        return true;
      })
      .run();
  }

  // 録音中：ここまでの文字起こしを随時反映（保存はデバウンスに任せる）
  function handlePartial(text: string) {
    writeCallout(toAppendedParagraphs(text), true);
  }

  // 停止後：整形済みのテキストを確定させる
  function handleFinal(result: { title: string; text: string }) {
    setRecording(false);
    writeCallout(toAppendedParagraphs(result.text), false);
    sessionRef.current = null;
    if (!editor) return;
    const patch: Partial<Note> = { body: editor.getHTML() };
    if (!note.title.trim() && result.title) patch.title = result.title;
    updateNote(note.id, patch, true);
  }

  // 取り消し／無音だった場合：空のコールアウトを残さず削除する
  function handleVoiceCancel() {
    setRecording(false);
    const id = sessionRef.current;
    sessionRef.current = null;
    if (!editor || !id) return;
    let from: number | null = null;
    let to: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (from !== null) return false;
      if (node.type.name === "transcriptCallout" && node.attrs.sessionId === id) {
        from = pos;
        to = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    if (from === null || to === null) return;
    editor.chain().deleteRange({ from, to }).run();
    updateNote(note.id, { body: editor.getHTML() }, true);
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
          className={`rounded-lg p-2 text-neutral-500 transition-transform duration-150 hover:bg-brand-100 active:-translate-x-1 active:scale-90 dark:hover:bg-neutral-800 ${
            standalone ? "" : "md:hidden"
          }`}
          title={standalone ? "閉じる" : "戻る"}
        >
          {standalone ? <IconClose /> : <IconBack />}
        </button>

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
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg p-2 text-neutral-500 hover:bg-brand-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              title="ファイル・写真を添付"
            >
              <IconClip />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
            <button
              onClick={startRecording}
              disabled={recording}
              className="rounded-lg p-2 text-neutral-500 transition hover:bg-brand-100 active:scale-90 disabled:opacity-40 dark:hover:bg-neutral-800"
              title="音声メモ"
            >
              <IconMic />
            </button>
            {/* 手書き（①）：iPad のみ表示。Apple Pencil での描画を想定 */}
            {isIPad && (
              <button
                onClick={() => setDrawing(true)}
                className="rounded-lg p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
                title="手書き"
              >
                <IconPencil />
              </button>
            )}

            {/* 右上の3点メニュー（⑤） */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className={`rounded-lg p-2 transition-transform duration-150 hover:bg-brand-100 active:scale-90 dark:hover:bg-neutral-800 ${
                  menuOpen
                    ? "scale-95 bg-brand-100 text-brand-700 dark:bg-neutral-800"
                    : "text-neutral-500"
                }`}
                title="その他"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <IconDots />
              </button>
              {menuOpen && (
                <>
                  {/* 画面外タップで閉じる */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="flow-menu-in absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-brand-200/60 bg-white py-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        togglePin(note.id);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-100/70 dark:hover:bg-neutral-800/70"
                    >
                      <IconPin filled={note.pinned} className="h-4 w-4 text-brand-500" />
                      {note.pinned ? "ピンを外す" : "メモをピン留め"}
                    </button>
                    {/* 長期保存にする（⑦）。すでに長期保存のメモでは非表示 */}
                    {note.type === "short" && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setNoteType(note.id, "long");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-100/70 dark:hover:bg-neutral-800/70"
                      >
                        <IconArchive className="h-4 w-4 text-neutral-500" />
                        長期保存にする
                      </button>
                    )}
                    {onOpenWindow && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          onOpenWindow();
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-100/70 dark:hover:bg-neutral-800/70"
                      >
                        <IconWindow className="h-4 w-4 text-neutral-500" />
                        別ウィンドウで開く
                      </button>
                    )}
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setFolderPickerOpen(true);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-100/70 dark:hover:bg-neutral-800/70"
                    >
                      <IconMove className="h-4 w-4 text-neutral-500" />
                      フォルダを変更
                    </button>
                    <div className="my-1 border-t border-brand-200/60 dark:border-neutral-800" />
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        trashNote(note.id);
                        onBack();
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      <IconTrash className="h-4 w-4" />
                      削除
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {folderPickerOpen && (
        <FolderPickerSheet
          currentFolderId={note.folder_id}
          onPick={(folderId) => {
            updateNote(note.id, { folder_id: folderId }, true);
            setFolderPickerOpen(false);
          }}
          onClose={() => setFolderPickerOpen(false)}
        />
      )}

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
        // 書式ツールバー行（短期/長期トグルは廃止し、3点メニューへ移動 ⑦）
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-200/60 px-4 py-2 dark:border-neutral-800">
          {note.type === "short" &&
            (() => {
              const d = shortNoteRemainingDays(note.expires_at);
              return d !== null ? (
                <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">
                  短期・あと{d}日
                </span>
              ) : null;
            })()}
          <div className="flex-1" />
          <RichTextToolbar editor={editor} />
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

      {/* タイトル */}
      <input
        value={note.title}
        readOnly={trashed}
        onChange={(e) => updateNote(note.id, { title: e.target.value })}
        placeholder="タイトル"
        className="bg-transparent px-4 pt-4 text-2xl font-semibold tracking-tight outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
      />

      {/* 本文（リッチテキスト） */}
      <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col" />

      {/* 添付ファイル */}
      {attachments.length > 0 && (
        <div className="thin-scroll flex flex-wrap gap-2 border-t border-brand-200/60 px-4 py-3 dark:border-neutral-800">
          {attachments.map((a) =>
            a.type === "image" ? (
              <div
                key={a.id}
                className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-100 dark:bg-neutral-800"
              >
                <a href={a.file_url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.file_url}
                    alt={a.file_name}
                    className="h-full w-full object-cover"
                  />
                </a>
                {!trashed && (
                  <button
                    onClick={() => handleDeleteAttachment(a)}
                    title="削除"
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                  >
                    <IconClose className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : (
              <div
                key={a.id}
                className="flex max-w-[12rem] items-center gap-2 rounded-lg bg-brand-100 py-1.5 pl-3 pr-2 text-sm dark:bg-neutral-800"
              >
                <a
                  href={a.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2"
                >
                  <IconFile className="h-4 w-4 shrink-0 text-neutral-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.file_name}</span>
                    <span className="block text-xs text-neutral-400">
                      {formatFileSize(a.file_size)}
                    </span>
                  </span>
                </a>
                {!trashed && (
                  <button
                    onClick={() => handleDeleteAttachment(a)}
                    title="削除"
                    className="shrink-0 text-neutral-400 hover:text-red-600"
                  >
                    <IconClose className="h-3 w-3" />
                  </button>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {recording && (
        <VoiceRecorder
          onPartial={handlePartial}
          onFinal={handleFinal}
          onCancel={handleVoiceCancel}
        />
      )}

      {drawing && (
        <HandwritingCanvas
          onSave={handleDrawingSave}
          onClose={() => setDrawing(false)}
        />
      )}
    </div>
  );
}
