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
import { Sketch } from "@/lib/tiptap/sketch";
import { ImageBlock } from "@/lib/tiptap/imageBlock";
import { compressImage } from "@/lib/images/compress";
import {
  listAttachments,
  deleteAttachment,
  uploadImage,
} from "@/lib/attachments";
import RichTextToolbar from "./RichTextToolbar";
import FolderPickerSheet from "./FolderPickerSheet";

// 録音ボタンを押した時だけ使うため遅延読み込みにし、メモを開く際の初期JSを減らす
const VoiceRecorder = dynamic(() => import("./VoiceRecorder"), { ssr: false });
import {
  IconBack,
  IconPin,
  IconMic,
  IconFile,
  IconTrash,
  IconRestore,
  IconExpand,
  IconCompress,
  IconShare,
  IconWindow,
  IconClose,
  IconDots,
  IconMove,
  IconPencil,
  IconImage,
  IconArchive,
} from "./icons";

export default function NoteEditor({
  note,
  onBack,
  isFullscreen,
  onToggleFullscreen,
  onOpenWindow,
  onRequestDelete,
  standalone = false,
}: {
  note: Note;
  onBack: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onOpenWindow?: () => void;
  /** 削除を依頼する。確認・アニメーション・実際の削除は AppShell が担う。
   *  未指定（別ウィンドウ表示）のときはこの場で削除して閉じる。 */
  onRequestDelete?: (permanent?: boolean) => void;
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
  const [tagInput, setTagInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  // 書式ツールバーの表示（「Aa」で開閉。既定は畳んでおき上部をすっきりさせる）
  const [formatOpen, setFormatOpen] = useState(false);
  const [formatClosing, setFormatClosing] = useState(false);
  // md 以上（3分割）かどうか。短期バッジの出し分けに使う
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Aa の開閉。閉じるときはアニメーションを見せてから畳む
  function toggleFormat() {
    if (formatOpen && !formatClosing) {
      setFormatClosing(true);
      window.setTimeout(() => {
        setFormatOpen(false);
        setFormatClosing(false);
      }, 240); // flow-format-out と同じ長さ
    } else if (!formatOpen) {
      setFormatOpen(true);
    }
  }
  const { isIPad } = useDevice();

  // 削除。一覧・本文それぞれの消えるアニメーションを揃えるため、
  // 通常は親（AppShell）に委ねる。別ウィンドウ表示のときは親がいないので
  // この場で削除して閉じる。
  function requestDelete(permanent: boolean) {
    if (onRequestDelete) {
      onRequestDelete(permanent);
      return;
    }
    if (
      permanent &&
      !window.confirm("このメモを完全に削除しますか？（元に戻せません）")
    )
      return;
    if (permanent) deleteNotePermanently(note.id);
    else trashNote(note.id);
    onBack();
  }
  const supabase = useMemo(() => createClient(), []);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // 録音中に書き込む対象のコールアウトを特定するID
  const sessionRef = useRef<string | null>(null);

  const trashed = note.status === "trashed";
  const tags = note.tags ?? [];

  // 短期メモの残り日数バッジ。3分割（md かつ全画面でない）では出さず、
  // 全画面表示のとき・モバイルでのみ表示する。
  const shortDays =
    note.type === "short" ? shortNoteRemainingDays(note.expires_at) : null;
  const badgeVisible = shortDays !== null && (isFullscreen || !isWide);

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
      // 描画中は editor.setEditable(false) でエディタごと編集不可にするため、
      // ブロック側は editor.isEditable ではなくこの値で判定する
      Sketch.configure({ editable: !trashed }),
      ImageBlock,
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
          "thin-scroll flex-1 overflow-y-auto break-words px-4 py-3 leading-relaxed outline-none",
      },
      // 画像の貼り付け（PC）。画像が含まれていたら取り込む
      handlePaste: (_view, event) => {
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
      // 画像のドラッグ&ドロップ（PC）
      handleDrop: (_view, event) => {
        const files = imageFilesFrom(
          (event as DragEvent).dataTransfer,
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      updateNote(note.id, { body: editor.getHTML() });
    },
  });

  // リモート（他端末）での本文変更を、開いたままのエディタへ流し込む。
  // 単一ユーザーの複数端末を想定した軽量同期（last-writer-wins）。
  useEffect(() => {
    if (!editor) return;
    // 手書きの描画モード中はエディタごと編集不可。巻き込まないよう触らない
    if (!editor.isEditable) return;
    // この端末で入力中なら上書きしない（操作している端末が勝つ）
    if (editor.isFocused) return;
    const incoming = toEditorHtml(note.body);
    // 変化なし／自分の入力のエコーなら何もしない
    if (incoming === editor.getHTML()) return;
    // emitUpdate:false で onUpdate を発火させない（保存のエコーループを防ぐ）
    editor.commands.setContent(incoming, { emitUpdate: false });
    // note.body の変化だけに反応させる（editor は同一インスタンス）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.body]);

  // フォーカス中に来て見送ったリモート変更を、離した瞬間に取り込む
  useEffect(() => {
    if (!editor) return;
    const onBlur = () => {
      if (!editor.isEditable) return;
      const incoming = toEditorHtml(note.body);
      if (incoming === editor.getHTML()) return;
      editor.commands.setContent(incoming, { emitUpdate: false });
    };
    editor.on("blur", onBlur);
    return () => {
      editor.off("blur", onBlur);
    };
  }, [editor, note.body]);

  // 手書き（①）：カーソル位置に手書きブロックを挿入する。
  // 基準幅(w)は 0 のままにしておき、ブロック自身が最初に測れた幅を入れる
  // （本文の内側パディングを引いた実際の描画幅と一致させるため）。
  function insertSketch() {
    if (!editor) return;
    editor
      .chain()
      // 【重要】ここで focus() を呼んではいけない。iOS では focus コマンドが
      // view.dom.focus() を呼んだうえ、requestAnimationFrame でもう一度
      // view.focus() を後追いする。そのため描画モードで editable を false に
      // した「後」にフォーカスが戻り、文字入力セッションが生きたままになって
      // スクリブルが手書きを文字認識してしまう
      // （実機で「挿入直後だけ文字認識される」原因がこれだった）。
      // insertContent は DOM フォーカスが無くても現在の選択位置に挿入される。
      .insertContent([
        // 挿入直後はそのまま描けるよう描画モードで始める（drawing は本文に
        // 保存されない一時的な属性）
        { type: "sketch", attrs: { strokes: "[]", h: 220, w: 0, drawing: true } },
        { type: "paragraph" },
      ])
      .run();
  }

  // DataTransfer / ClipboardData から画像ファイルだけ取り出す
  function imageFilesFrom(dt: DataTransfer | null): File[] {
    if (!dt) return [];
    return Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
  }

  // 画像を圧縮してアップロードし、本文のカーソル位置に挿入する。
  // 本文には URL だけを入れる（base64にしない）。
  async function insertImages(files: File[]) {
    if (!editor || files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      try {
        const img = await compressImage(file);
        const { url } = await uploadImage(
          supabase,
          userId,
          note.id,
          img.blob,
          img.ext,
        );
        editor
          .chain()
          .focus()
          .insertContent([
            { type: "imageBlock", attrs: { src: url, w: img.width, h: img.height } },
            { type: "paragraph" },
          ])
          .run();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "画像の挿入に失敗しました");
      }
    }
    setUploading(false);
  }

  async function handleImageSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    e.target.value = "";
    await insertImages(files);
  }

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
      {/* ヘッダー（書式パネルを浮かせるため relative） */}
      <div className="safe-top relative flex items-center gap-1 border-b border-brand-200/60 px-2 py-2 dark:border-neutral-800">
        <button
          onClick={onBack}
          className={`flow-press rounded-full p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800 ${
            standalone ? "" : "md:hidden"
          }`}
          title={standalone ? "閉じる" : "戻る"}
        >
          {standalone ? <IconClose /> : <IconBack />}
        </button>

        {/* 全画面 / 全画面解除（md 以上のみ）。左側に配置 */}
        {!trashed && onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="hidden rounded-full p-2 text-neutral-500 hover:bg-brand-100 md:block dark:hover:bg-neutral-800"
            title={isFullscreen ? "全画面を解除" : "全画面表示"}
          >
            {isFullscreen ? <IconCompress /> : <IconExpand />}
          </button>
        )}
        {/* 共有（全画面ボタンの隣） */}
        {!trashed && (
          <button
            onClick={() => shareNote(note.title, note.body)}
            className="flow-press rounded-full p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
            title="共有"
          >
            <IconShare />
          </button>
        )}

        <div className="flex-1" />

        {!trashed && (
          <>
            {/* 書式（Aa）：下の書式ツールバーの表示を切り替える */}
            <button
              onClick={toggleFormat}
              className={`flow-press rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                formatOpen
                  ? "bg-brand-100 text-brand-700 dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
              }`}
              title="書式"
              aria-pressed={formatOpen}
            >
              Aa
            </button>

            {/* 挿入（画像・音声・手書き）を1つのピルにまとめる */}
            <div className="flex items-center gap-0.5 rounded-full bg-brand-100/70 p-0.5 dark:bg-neutral-800/70">
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={uploading}
                className="flow-press rounded-full p-1.5 text-neutral-600 hover:bg-brand-200/70 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
                title="写真を本文に挿入"
              >
                <IconImage />
              </button>
              <button
                onClick={startRecording}
                disabled={recording}
                className="flow-press rounded-full p-1.5 text-neutral-600 hover:bg-brand-200/70 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700"
                title="音声メモ"
              >
                <IconMic />
              </button>
              {/* 手書き（①）：iPad のみ表示。Apple Pencil での描画を想定 */}
              {isIPad && (
                <button
                  onClick={insertSketch}
                  className="flow-press rounded-full p-1.5 text-neutral-600 hover:bg-brand-200/70 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  title="手書き"
                >
                  <IconPencil />
                </button>
              )}
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageSelected}
            />

            {/* 右上の3点メニュー（⑤） */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className={`flow-press rounded-full p-2 hover:bg-brand-100 dark:hover:bg-neutral-800 ${
                  menuOpen
                    ? "bg-brand-100 text-brand-700 dark:bg-neutral-800"
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
                        requestDelete(false);
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

        {/* 書式（Aa）パネル。本文やタグを押し下げないよう、ヘッダーの下に
            浮かせて表示する（幅は内容ぶんだけ・右寄せ）。Aa の位置から広がる。 */}
        {formatOpen && (
          <div
            className={`${
              formatClosing ? "flow-format-out" : "flow-format-in"
            } absolute right-2 top-full z-30 mt-1 max-w-[calc(100%-1rem)] rounded-2xl border border-brand-200/60 bg-brand-50 px-2 py-1.5 shadow-lg dark:border-neutral-800 dark:bg-neutral-800`}
          >
            <RichTextToolbar editor={editor} />
          </div>
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
            onClick={() => requestDelete(true)}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            完全に削除
          </button>
        </div>
      ) : badgeVisible ? (
        // 短期メモのバッジ行。3分割（md）では出さず、全画面・モバイルでのみ表示。
        // ※ 書式ツール（Aa）はヘッダー下に浮かせているのでこの行には無い＝
        //   Aa を押しても本文やタグは動かない。
        <div className="flex items-center border-b border-brand-200/60 px-4 py-2 dark:border-neutral-800">
          <span className="flow-badge-in rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">
            短期・あと{shortDays}日
          </span>
        </div>
      ) : null}

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

    </div>
  );
}
