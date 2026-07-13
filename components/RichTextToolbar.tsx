"use client";

import { type Editor } from "@tiptap/react";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconHeading1,
  IconHeading2,
  IconHeading3,
  IconParagraph,
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
  if (!editor) return null;

  const isHeadingActive = (level: 0 | 1 | 2 | 3) =>
    level === 0 ? editor.isActive("paragraph") : editor.isActive("heading", { level });

  const toggleHeading = (level: 0 | 1 | 2 | 3) => {
    if (level === 0) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
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

      {/* 文字色 */}
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => {
          const active = editor.isActive("textStyle", { color: c.hex });
          return (
            <button
              key={c.hex}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                active
                  ? editor.chain().focus().unsetColor().run()
                  : editor.chain().focus().setColor(c.hex).run()
              }
              title={c.name}
              className={`h-5 w-5 shrink-0 rounded-full ring-offset-2 transition dark:ring-offset-neutral-950 ${
                active ? "ring-2 ring-neutral-400" : ""
              }`}
              style={{ backgroundColor: c.hex }}
            />
          );
        })}
      </div>
    </div>
  );
}
