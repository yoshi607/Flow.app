"use client";

import { useState } from "react";
import { type Editor } from "@tiptap/react";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconHeading1,
  IconHeading2,
  IconHeading3,
  IconParagraph,
  IconUndo,
  IconRedo,
} from "./icons";

const COLORS: { name: string; hex: string }[] = [
  { name: "ブルー", hex: "#007AFF" },
  { name: "ミント", hex: "#00C7BE" },
  { name: "オレンジ", hex: "#FF9500" },
  { name: "ピンク", hex: "#FF2D55" },
  { name: "パープル", hex: "#AF52DE" },
];

const HEADINGS: { level: 0 | 1 | 2 | 3; icon: typeof IconParagraph; title: string }[] = [
  { level: 1, icon: IconHeading1, title: "見出し1" },
  { level: 2, icon: IconHeading2, title: "見出し2" },
  { level: 3, icon: IconHeading3, title: "見出し3" },
  { level: 0, icon: IconParagraph, title: "テキスト" },
];

export default function RichTextToolbar({ editor }: { editor: Editor | null }) {
  const [colorOpen, setColorOpen] = useState(false);
  if (!editor) return null;

  // 現在選択中の文字色（未設定なら null）
  const currentColor: string | null =
    editor.getAttributes("textStyle").color ?? null;

  const isHeadingActive = (level: 0 | 1 | 2 | 3) =>
    level === 0 ? editor.isActive("paragraph") : editor.isActive("heading", { level });

  const toggleHeading = (level: 0 | 1 | 2 | 3) => {
    if (level === 0) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level }).run();
  };

  const canUndo = editor.can().undo();
  const canRedo = editor.can().redo();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 1つ戻す / 1つ送る */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!canUndo}
          title="1つ戻す (Ctrl/Cmd+Z)"
          aria-label="1つ戻す"
          className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-brand-100 disabled:opacity-30 dark:hover:bg-neutral-800"
        >
          <IconUndo className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!canRedo}
          title="1つ送る (Ctrl/Cmd+Shift+Z)"
          aria-label="1つ送る"
          className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-brand-100 disabled:opacity-30 dark:hover:bg-neutral-800"
        >
          <IconRedo className="h-4 w-4" />
        </button>
      </div>

      {/* 見出し / テキスト */}
      <div className="flex items-center gap-0.5 rounded-lg bg-brand-100 p-0.5 dark:bg-neutral-800">
        {HEADINGS.map(({ level, icon: Icon, title }) => (
          <button
            key={level}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleHeading(level)}
            title={title}
            className={`rounded-md p-1.5 transition ${
              isHeadingActive(level)
                ? "bg-white shadow-sm dark:bg-neutral-950"
                : "text-neutral-500"
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* 太字・斜体・下線 */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="太字 (Ctrl/Cmd+B)"
          className={`rounded-lg p-1.5 transition ${
            editor.isActive("bold")
              ? "bg-brand-200 text-brand-700 dark:bg-neutral-700 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
          }`}
        >
          <IconBold className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="斜体 (Ctrl/Cmd+I)"
          className={`rounded-lg p-1.5 transition ${
            editor.isActive("italic")
              ? "bg-brand-200 text-brand-700 dark:bg-neutral-700 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
          }`}
        >
          <IconItalic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="下線 (Ctrl/Cmd+U)"
          className={`rounded-lg p-1.5 transition ${
            editor.isActive("underline")
              ? "bg-brand-200 text-brand-700 dark:bg-neutral-700 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
          }`}
        >
          <IconUnderline className="h-4 w-4" />
        </button>
      </div>

      {/* 文字色（1つのボタンにまとめ、タップで色選択） */}
      <div className="relative">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setColorOpen((v) => !v)}
          title="文字色"
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            colorOpen
              ? "bg-brand-200 dark:bg-neutral-700"
              : "hover:bg-brand-100 dark:hover:bg-neutral-800"
          }`}
        >
          {/* 現在色の丸（未設定時はグレー枠） */}
          <span
            className="h-5 w-5 rounded-full border-2 border-black/30 dark:border-white/40"
            style={{ backgroundColor: currentColor ?? "transparent" }}
          />
        </button>
        {colorOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setColorOpen(false)} />
            <div className="flow-menu-in absolute right-0 top-full z-50 mt-1 flex items-center gap-2 rounded-xl border border-brand-200/60 bg-white p-2 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
              {COLORS.map((c) => {
                const active = editor.isActive("textStyle", { color: c.hex });
                return (
                  <button
                    key={c.hex}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      editor.chain().focus().setColor(c.hex).run();
                      setColorOpen(false);
                    }}
                    title={c.name}
                    className={`h-6 w-6 shrink-0 rounded-full ring-offset-2 transition dark:ring-offset-neutral-900 ${
                      active ? "ring-2 ring-neutral-400" : ""
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
              {/* 色を解除（標準色に戻す） */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().unsetColor().run();
                  setColorOpen(false);
                }}
                title="標準色"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[10px] text-neutral-500 dark:border-neutral-600"
              >
                A
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
