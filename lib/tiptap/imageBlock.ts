import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ImageBlockView from "@/components/ImageBlockView";

// 本文に埋め込む画像ブロック。
//
// 本文は HTML 文字列として notes.body に保存されるため、
// <div data-type="image"> として保存・復元できるようにしている。
// ※ この形式を変える場合は lib/richtext.ts の isPlainText も合わせて直すこと
//   （先頭がこのブロックのメモが「旧形式のプレーンテキスト」と誤判定され、
//    本文HTMLが丸ごとエスケープされて壊れるため）。
//
// 画像の実体は Storage に置き、本文には URL（data-src）だけを入れる。
// base64 を入れると本文と検索インデックス、リアルタイム同期のペイロードが
// 肥大するため、必ず URL 参照にする。
export const ImageBlock = Node.create({
  name: "imageBlock",
  group: "block",
  atom: true,
  // タップは拡大表示のために使う。ノード選択（青い枠）は出したくないので
  // 選択不可にする。削除は NodeView の削除ボタンから行う。
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-src") ?? "",
        renderHTML: (attrs) => (attrs.src ? { "data-src": attrs.src } : {}),
      },
      // 自然寸法（表示前のレイアウト崩れを防ぐ）
      w: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-w")) || 0,
        renderHTML: (attrs) => (attrs.w ? { "data-w": String(attrs.w) } : {}),
      },
      h: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-h")) || 0,
        renderHTML: (attrs) => (attrs.h ? { "data-h": String(attrs.h) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="image"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "image" })];
  },

  addNodeView() {
    // タップは NodeView 側（拡大・削除）で処理する。ProseMirror には
    // イベントを扱わせない＝選択もされない。
    return ReactNodeViewRenderer(ImageBlockView, { stopEvent: () => true });
  },
});
