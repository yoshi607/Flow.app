"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
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
import { HorizontalRule } from "@/lib/tiptap/horizontalRule";
import { compressImage } from "@/lib/images/compress";
import { downloadNoteAsPng } from "@/lib/exportImage";
import { useClosingPanel } from "@/lib/useClosingPanel";
import { useMediaQuery } from "@/lib/useMediaQuery";
import {
  listAttachments,
  deleteAttachment,
  uploadImage,
} from "@/lib/attachments";
import { useSignedUrl } from "@/lib/useSignedUrl";
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
  IconClip,
  IconDownload,
} from "./icons";

// ポップアップメニューの1項目（3点メニュー・クリップメニュー共通の見た目）
function MenuItem({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 whitespace-nowrap px-4 py-2.5 text-left text-sm disabled:opacity-50 ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "hover:bg-brand-100/70"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

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
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  // 右上の3点メニュー／挿入（クリップ）メニュー／書式（Aa）パネル。
  // いずれも「開くとき flow-format-in・閉じるとき flow-format-out」で動きを揃える
  const menu = useClosingPanel();
  const insertMenu = useClosingPanel();
  const format = useClosingPanel();
  // md 以上（3分割）かどうか。短期バッジの出し分けに使う
  const isWide = useMediaQuery("(min-width: 768px)");
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
  const [exporting, setExporting] = useState(false);
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
        // 区切り線は有効。行頭で --- と入力すると入る（StarterKit の入力ルール）。
        //
        // 箇条書きも有効。行頭で「- 」（ハイフン＋スペース）と入力するとリストに
        // なる（StarterKit の入力ルール。* + でも同じ）。Enter で次の項目、
        // 空の項目で Enter を押すとリストから抜ける。行頭の印は globals.css の
        // .ProseMirror ul li::before で「・」にしている。
        // ※ --- の区切り線とは競合しない：--- は3つ目のハイフンの後にスペースが
        //   来るまで確定しないので、その前に「- 」のルールが走ることはない。
        bulletList: {},
        listItem: {},
        // 番号付きリストは使わない（箇条書きだけにする）
        orderedList: false,
        // Backspace / Delete でリストの項目をきれいに繋げるためのキー操作。
        // 番号付きリストが無くても安全に動く（登録されていないリストは読み飛ばす）。
        listKeymap: {},
        // 標準の区切り線は無効化し、下の HorizontalRule（Backspaceの挙動を
        // 修正したもの）に差し替える
        horizontalRule: false,
      }),
      HorizontalRule,
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
        // pb-[50vh]：本文の下に常に半ページ分の余白を確保する。これが無いと
        // 一番下の行まで書いたときにカーソルが画面最下端（モバイルでは
        // ソフトキーボードの裏）に張り付いて見にくい。余白があるぶんスクロール
        // でき、書いている行を上に送れる。
        class:
          "thin-scroll flex-1 overflow-y-auto break-words px-4 pt-3 pb-[50vh] leading-relaxed outline-none",
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
      // コピーした時のプレーンテキスト化。1行=1段落（<p>）で保存しているため、
      // ProseMirRORの既定（段落間を空行 "\n\n" で連結）のままだと、
      // 他アプリへ貼り付けたときに全行の間に空行が入ってしまう。
      // 段落間を "\n" 1つで連結するようにし、ユーザーが実際に空行を
      // 入れた（空の段落がある）場合だけ結果的に空行になるようにする。
      clipboardTextSerializer: (slice) =>
        slice.content.textBetween(0, slice.content.size, "\n"),
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
        // 本文には Storage パスを保存する（非公開バケット）。表示時に
        // ImageBlockView が署名付きURLへ解決する。
        const { path } = await uploadImage(
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
            { type: "imageBlock", attrs: { src: path, w: img.width, h: img.height } },
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

  // 停止後：文字起こしの全文を確定させる
  function handleFinal(text: string) {
    setRecording(false);
    writeCallout(toAppendedParagraphs(text), false);
    sessionRef.current = null;
    if (!editor) return;
    updateNote(note.id, { body: editor.getHTML() }, true);
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

  // メモ（タイトル＋本文）を1枚のPNGにして保存する
  async function downloadAsImage() {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      await downloadNoteAsPng(editor.state.doc, note.title);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "画像の書き出しに失敗しました",
      );
    } finally {
      setExporting(false);
    }
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
    <div className="flex h-full flex-col bg-white">
      {/* ヘッダー（書式パネルを浮かせるため relative／狭い幅では折り返して
          3点ボタンが見切れないように flex-wrap）。
          上のセーフエリア分を足しつつ、上下の余白を対称（下も 0.5rem）にして
          ボタンが下線に対して上寄りに見えないよう中央に揃える。以前は safe-top が
          py-2 の上パディングを打ち消し、上0・下0.5rem の非対称になっていた。 */}
      <div
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
        className="relative flex flex-wrap items-center gap-1 border-b border-brand-200/60 px-2 pb-2"
      >
        <button
          onClick={onBack}
          className={`flow-press rounded-full p-2 text-neutral-500 hover:bg-brand-100 ${
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
            className="hidden rounded-full p-2 text-neutral-500 hover:bg-brand-100 md:block"
            title={isFullscreen ? "全画面を解除" : "全画面表示"}
          >
            {isFullscreen ? <IconCompress /> : <IconExpand />}
          </button>
        )}
        {/* 共有（全画面ボタンの隣） */}
        {!trashed && (
          <button
            onClick={() => shareNote(note.title, note.body)}
            className="flow-press rounded-full p-2 text-neutral-500 hover:bg-brand-100"
            title="共有"
          >
            <IconShare />
          </button>
        )}
        {/* 短期メモのバッジ。共有ボタンの右に全角空白1つ分あけて表示。
            3分割（md）では出さず、全画面・モバイルでのみ表示する。 */}
        {!trashed && badgeVisible && (
          <span className="flow-badge-in ml-[1em] rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            短期・あと{shortDays}日
          </span>
        )}

        <div className="flex-1" />

        {!trashed && (
          <>
            {/* 書式（Aa）：下の書式ツールバーの表示を切り替える */}
            <button
              onClick={format.toggle}
              className={`flow-press rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                format.open
                  ? "bg-brand-100 text-brand-700"
                  : "text-neutral-500 hover:bg-brand-100"
              }`}
              title="書式"
              aria-pressed={format.open}
            >
              Aa
            </button>

            {/* 挿入（写真・音声・手書き）を1つのクリップボタンにまとめる。
                押すとメニューがボタンの位置から広がって現れる（Aa と同じ動き）。 */}
            <div className="relative">
              <button
                onClick={insertMenu.toggle}
                className={`flow-press rounded-full p-2 transition ${
                  insertMenu.open
                    ? "bg-brand-100 text-brand-700"
                    : "text-neutral-500 hover:bg-brand-100"
                }`}
                title="挿入"
                aria-haspopup="menu"
                aria-expanded={insertMenu.open}
              >
                <IconClip />
              </button>
              {insertMenu.open && (
                <>
                  {/* 画面外タップで閉じる */}
                  <div className="fixed inset-0 z-40" onClick={insertMenu.close} />
                  {/* アニメーションと背景色は Aa パネル・3点メニューと揃える */}
                  <div
                    role="menu"
                    className={`${
                      insertMenu.closing ? "flow-format-out" : "flow-format-in"
                    } absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-2xl border border-brand-200/60 bg-brand-50 py-1 shadow-lg`}
                  >
                    <MenuItem
                      icon={<IconImage className="h-4 w-4 text-neutral-500" />}
                      label="写真"
                      disabled={uploading}
                      onClick={() => {
                        insertMenu.close();
                        imageInputRef.current?.click();
                      }}
                    />
                    <MenuItem
                      icon={<IconMic className="h-4 w-4 text-neutral-500" />}
                      label="音声メモ"
                      disabled={recording}
                      onClick={() => {
                        insertMenu.close();
                        startRecording();
                      }}
                    />
                    {/* 手書き（①）：iPad のみ。Apple Pencil での描画を想定 */}
                    {isIPad && (
                      <MenuItem
                        icon={<IconPencil className="h-4 w-4 text-neutral-500" />}
                        label="手書き"
                        onClick={() => {
                          insertMenu.close();
                          insertSketch();
                        }}
                      />
                    )}
                  </div>
                </>
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
                onClick={menu.toggle}
                className={`flow-press rounded-full p-2 hover:bg-brand-100 ${
                  menu.open
                    ? "bg-brand-100 text-brand-700"
                    : "text-neutral-500"
                }`}
                title="その他"
                aria-haspopup="menu"
                aria-expanded={menu.open}
              >
                <IconDots />
              </button>
              {menu.open && (
                <>
                  {/* 画面外タップで閉じる */}
                  <div className="fixed inset-0 z-40" onClick={menu.close} />
                  {/* アニメーションと背景色は Aa パネルと揃える */}
                  <div
                    role="menu"
                    className={`${
                      menu.closing ? "flow-format-out" : "flow-format-in"
                    } absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-2xl border border-brand-200/60 bg-brand-50 py-1 shadow-lg`}
                  >
                    <MenuItem
                      icon={
                        <IconPin
                          filled={note.pinned}
                          className="h-4 w-4 text-brand-500"
                        />
                      }
                      label={note.pinned ? "ピンを外す" : "メモをピン留め"}
                      onClick={() => {
                        togglePin(note.id);
                        menu.close();
                      }}
                    />
                    {/* 長期保存にする（⑦）。すでに長期保存のメモでは非表示 */}
                    {note.type === "short" && (
                      <MenuItem
                        icon={<IconArchive className="h-4 w-4 text-neutral-500" />}
                        label="長期保存にする"
                        onClick={() => {
                          setNoteType(note.id, "long");
                          menu.close();
                        }}
                      />
                    )}
                    {onOpenWindow && (
                      <MenuItem
                        icon={<IconWindow className="h-4 w-4 text-neutral-500" />}
                        label="別ウィンドウで開く"
                        onClick={() => {
                          onOpenWindow();
                          menu.close();
                        }}
                      />
                    )}
                    <MenuItem
                      icon={<IconMove className="h-4 w-4 text-neutral-500" />}
                      label="フォルダを変更"
                      onClick={() => {
                        menu.close();
                        setFolderPickerOpen(true);
                      }}
                    />
                    <MenuItem
                      icon={
                        <IconDownload className="h-4 w-4 shrink-0 text-neutral-500" />
                      }
                      label={exporting ? "書き出し中…" : "画像としてダウンロード"}
                      disabled={exporting}
                      onClick={() => {
                        menu.close();
                        void downloadAsImage();
                      }}
                    />
                    <div className="my-1 border-t border-brand-200/60" />
                    <MenuItem
                      icon={<IconTrash className="h-4 w-4" />}
                      label="削除"
                      danger
                      onClick={() => {
                        menu.close();
                        requestDelete(false);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* 書式（Aa）パネル。本文やタグを押し下げないよう、ヘッダーの下に
            浮かせて表示する（幅は内容ぶんだけ・右寄せ）。Aa の位置から広がる。 */}
        {format.open && (
          <div
            className={`${
              format.closing ? "flow-format-out" : "flow-format-in"
            } absolute right-2 top-full z-30 mt-1 max-w-[calc(100%-1rem)] rounded-2xl border border-brand-200/60 bg-brand-50 px-2 py-1.5 shadow-lg`}
          >
            <RichTextToolbar editor={editor} />
          </div>
        )}
      </div>

      {folderPickerOpen && (
        <FolderPickerSheet
          currentFolderId={note.folder_id}
          onPick={(folderId) => {
            // フォルダは整理用の情報なので編集日時は動かさない（touch=false）。
            // DB 側のトリガーも据え置くので、表示とサーバーの値がずれない。
            updateNote(note.id, { folder_id: folderId }, true, false);
            setFolderPickerOpen(false);
          }}
          onClose={() => setFolderPickerOpen(false)}
        />
      )}

      {/* 短期/長期トグル or ゴミ箱バナー */}
      {trashed ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-200/60 bg-red-50 px-4 py-2 text-sm">
          <span className="text-red-700">
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
            className="flex items-center gap-1 rounded-lg bg-brand-200 px-3 py-1.5 text-sm font-medium hover:bg-brand-300"
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
      ) : null}

      {/* タグ */}
      {!trashed && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-brand-200/60 px-4 py-2">
          {tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700"
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
        className="bg-transparent px-4 pt-4 text-2xl font-semibold tracking-tight outline-none placeholder:text-neutral-300"
      />

      {/* 本文（リッチテキスト） */}
      <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col" />

      {/* 添付ファイル */}
      {attachments.length > 0 && (
        <div className="thin-scroll flex flex-wrap gap-2 border-t border-brand-200/60 px-4 py-3">
          {attachments.map((a) => (
            <AttachmentItem
              key={a.id}
              attachment={a}
              trashed={trashed}
              onDelete={() => handleDeleteAttachment(a)}
            />
          ))}
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

// 添付ストリップの1件。file_url（Storageパス／旧URL）を署名付きURLへ解決して表示する。
function AttachmentItem({
  attachment: a,
  trashed,
  onDelete,
}: {
  attachment: Attachment;
  trashed: boolean;
  onDelete: () => void;
}) {
  const url = useSignedUrl(a.file_url);

  if (a.type === "image") {
    return (
      <div className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-100">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={a.file_name}
              className="h-full w-full object-cover"
            />
          </a>
        ) : (
          <div className="h-full w-full animate-pulse" />
        )}
        {!trashed && (
          <button
            onClick={onDelete}
            title="削除"
            className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
          >
            <IconClose className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex max-w-[12rem] items-center gap-2 rounded-lg bg-brand-100 py-1.5 pl-3 pr-2 text-sm">
      <a
        href={url || undefined}
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
          onClick={onDelete}
          title="削除"
          className="shrink-0 text-neutral-400 hover:text-red-600"
        >
          <IconClose className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
