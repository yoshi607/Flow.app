// Tiptap 本文（HTML文字列）を扱うための小さなヘルパー群

// エディタ（Tiptap）が保存する本文は、必ずブロック要素のタグから始まる
// （段落 <p>、見出し <h1>〜<h3>、音声メモのコールアウト <div ...>、区切り線 <hr>、
//  箇条書き <ul>）。
// それ以外は「移行前のプレーンテキスト」とみなす（本文中に "<a>タグ" のような
// 文字列が含まれるだけで誤判定しないよう、先頭一致のみで判定する）。
//
// ※ ここでタグを許可し忘れると、そのタグで始まるメモがプレーンテキスト扱いに
//   なり、本文HTMLが丸ごとエスケープされて生タグが文字として表示されてしまう。
// ※ 属性で判定してはいけない。属性の出力順は保証されず、実際に
//   <div data-session="..." data-type="transcript"> のように並ぶため、
//   data-type を前提にした判定はすり抜ける。タグ名だけで判定すること。
// ※ 空要素も来る（<hr>）。閉じ方が <hr> でも <hr/> でも拾えるよう / も許可する。
export function isPlainText(body: string): boolean {
  return !/^\s*<(p|h1|h2|h3|div|hr|ul|ol|li)[\s/>]/i.test(body);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 改行区切りのプレーンテキストを段落(<p>)に変換する。
// 1行=1段落として分割する（<br>でまとめると、見出しが行単位ではなく
// 段落単位で適用されるTiptapの仕様上、隣接行まで巻き込まれてしまうため）
function textToParagraphs(text: string): string {
  return text
    .trim()
    .split(/\n+/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

// 修正前のバグで保存された、<br>で複数行がまとめられた段落/見出しを
// 1行ずつの別ブロックに分割し直す（見出しの巻き込みバグの既存データ修復）
function splitSoftBreaksIntoBlocks(html: string): string {
  return html.replace(
    /<(p|h1|h2|h3)((?: [^>]*)?)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string, inner: string) => {
      const lines = inner.split(/<br\s*\/?>/i).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) return full;
      return lines.map((line) => `<${tag}${attrs}>${line}</${tag}>`).join("");
    },
  );
}

// エディタへ読み込む直前に、旧形式（プレーンテキスト）なら段落HTMLへ変換する
export function toEditorHtml(body: string): string {
  if (!body.trim()) return "<p></p>";
  const html = isPlainText(body) ? textToParagraphs(body) : body;
  return splitSoftBreaksIntoBlocks(html);
}

// 音声メモの文字起こし結果をHTML本文の末尾に安全に追記するための段落HTML
export function toAppendedParagraphs(text: string): string {
  return textToParagraphs(text);
}
