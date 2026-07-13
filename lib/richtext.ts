// Tiptap 本文（HTML文字列）を扱うための小さなヘルパー群

// エディタ（Tiptap）が保存する本文は必ず <p>/<h1>/<h2>/<h3> から始まる。
// それ以外は「移行前のプレーンテキスト」とみなす（本文中に "<a>タグ" のような
// 文字列が含まれるだけで誤判定しないよう、先頭一致のみで判定する）
export function isPlainText(body: string): boolean {
  return !/^\s*<(p|h1|h2|h3)[ >]/i.test(body);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 改行区切りのプレーンテキストを段落(<p>)に変換する
function textToParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// エディタへ読み込む直前に、旧形式（プレーンテキスト）なら段落HTMLへ変換する
export function toEditorHtml(body: string): string {
  if (!body.trim()) return "<p></p>";
  return isPlainText(body) ? textToParagraphs(body) : body;
}

// 音声メモの文字起こし結果をHTML本文の末尾に安全に追記するための段落HTML
export function toAppendedParagraphs(text: string): string {
  return textToParagraphs(text);
}
