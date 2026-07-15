import { Node, mergeAttributes } from "@tiptap/core";

// 音声メモの文字起こしを入れるコールアウトブロック（Notion のコールアウト風）。
//
// 本文は HTML 文字列として notes.body に保存されるため、
// <div data-type="transcript"> として保存・復元できるようにしている。
// ※ この形式を変える場合は lib/richtext.ts の isPlainText も合わせて直すこと
//   （先頭がこのブロックのメモが「旧形式のプレーンテキスト」と誤判定され、
//    本文HTMLが丸ごとエスケープされて壊れるため）。
export const TranscriptCallout = Node.create({
  name: "transcriptCallout",
  group: "block",
  // 中身は普通のブロック（段落・見出し）。書き起こし後もユーザーが編集できる
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      // 録音セッションを識別するためのID。録音中に「どのブロックへ
      // 書き込むか」を特定するために使う（保存されても無害）
      sessionId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-session"),
        renderHTML: (attrs) =>
          attrs.sessionId ? { "data-session": attrs.sessionId } : {},
      },
      // 録音中だけ true。CSS で「録音中」の見た目にする
      recording: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-recording") === "true",
        renderHTML: (attrs) =>
          attrs.recording ? { "data-recording": "true" } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="transcript"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "transcript" }),
      0,
    ];
  },
});
