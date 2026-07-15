import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import SketchNodeView from "@/components/SketchNodeView";

// 本文に埋め込む手書きブロック（Apple メモのインラインスケッチ相当）。
//
// 本文は HTML 文字列として notes.body に保存されるため、
// <div data-type="sketch"> として保存・復元できるようにしている。
// ※ この形式を変える場合は lib/richtext.ts の isPlainText も合わせて直すこと
//   （先頭がこのブロックのメモが「旧形式のプレーンテキスト」と誤判定され、
//    本文HTMLが丸ごとエスケープされて壊れるため）。
//
// 線データは data-strokes に JSON で入る。画像ではなく線で持つ理由は
// lib/sketch/strokes.ts の冒頭を参照。
export const Sketch = Node.create({
  name: "sketch",
  group: "block",
  // 中身は持たない。描画は NodeView（キャンバス）が担当する
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      strokes: {
        default: "[]",
        parseHTML: (el) => el.getAttribute("data-strokes") ?? "[]",
        renderHTML: (attrs) => ({ "data-strokes": attrs.strokes ?? "[]" }),
      },
      // 基準幅における高さ
      h: {
        default: 220,
        parseHTML: (el) => Number(el.getAttribute("data-h")) || 220,
        renderHTML: (attrs) => ({ "data-h": String(attrs.h ?? 220) }),
      },
      // 線データを記録したときの幅。表示時は「今の幅 / これ」を倍率にする
      w: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-w")) || 0,
        renderHTML: (attrs) => ({ "data-w": String(attrs.w ?? 0) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sketch"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "sketch" })];
  },

  addNodeView() {
    // ペン操作は NodeView が自前で処理するため、ProseMirror には手を出させない
    return ReactNodeViewRenderer(SketchNodeView, { stopEvent: () => true });
  },
});
