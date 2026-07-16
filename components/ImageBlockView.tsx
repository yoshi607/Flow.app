"use client";

import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { IconTrash } from "./icons";

// 本文に埋め込んだ画像。本文では小さく表示し、タップで全画面拡大する。
export default function ImageBlockView({
  node,
  deleteNode,
  editor,
}: NodeViewProps) {
  const src: string = node.attrs.src || "";
  const w: number = node.attrs.w || 0;
  const h: number = node.attrs.h || 0;
  const [zoom, setZoom] = useState(false);
  const editable = editor.isEditable;

  function confirmDelete() {
    if (!window.confirm("この画像を削除しますか？")) return;
    deleteNode();
  }

  return (
    <NodeViewWrapper as="div" data-type="image" contentEditable={false}>
      <div className="relative inline-block">
        {/* サムネイル（小さく表示）。タップで全画面 */}
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="block overflow-hidden rounded-lg"
          title="タップで拡大"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            width={w || undefined}
            height={h || undefined}
            className="max-h-56 w-auto max-w-full object-contain"
            style={h && w ? { aspectRatio: `${w} / ${h}` } : undefined}
          />
        </button>

        {editable && (
          <button
            type="button"
            onClick={confirmDelete}
            className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1.5 text-white transition hover:bg-black/70"
            title="画像を削除"
            aria-label="画像を削除"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 全画面ライトボックス。どこをタップしても閉じる */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}
