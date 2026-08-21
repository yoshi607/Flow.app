import { nodeInputRule } from "@tiptap/core";
import { HorizontalRule as BaseHorizontalRule } from "@tiptap/extension-horizontal-rule";

// StarterKit標準の区切り線（---入力）は、入力ルールの直後1回だけ
// Backspaceが「オートフォーマットの取り消し（undoInputRule）」を優先してしまい、
// 改行と区切り線が両方まとめて消えてしまう（本来は区切り線が選択状態になるだけで、
// もう一度Backspaceを押さないと消えないのが正しい挙動。他のタイミングでの
// Backspaceはこの正しい挙動になっている）。
// undoable: false にして、常に joinBackward/selectNodeBackward 側の
// 「まず選択状態にする」挙動へ倒し、タイミングによって挙動が変わらないようにする。
export const HorizontalRule = BaseHorizontalRule.extend({
  addInputRules() {
    return [
      nodeInputRule({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        type: this.type,
        undoable: false,
      }),
    ];
  },
});
