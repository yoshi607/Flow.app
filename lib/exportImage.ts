// メモを1枚の画像（PNG）に書き出す。
//
// 実装方針:
//  DOM を SVG(foreignObject) 経由で canvas に焼く方法は、iOS Safari で
//  不安定（フォント未適用・初回が白紙・外部画像で canvas が汚染される）。
//  本文のスキーマは paragraph / heading / sketch / imageBlock /
//  transcriptCallout と限られているので、doc を走査して canvas に直接
//  描く。依存も増えず、端末差も出ない。
//
//  手書きは線データをそのまま replay する（画面表示と同じ描き方）。
//  画像は fetch → blob URL 経由で読む（cross-origin で canvas が
//  汚染されて toBlob が失敗するのを避けるため）。

import { type Node as PMNode } from "@tiptap/pm/model";
import { deserialize, replay, type Stroke } from "@/lib/sketch/strokes";
import { createClient } from "@/lib/supabase/client";
import { createSignedImageUrl } from "@/lib/attachments";

const WIDTH = 820; // 書き出す画像の幅(CSS px 相当)
const PAD = 44; // 外周の余白
const CONTENT = WIDTH - PAD * 2;
const SCALE = 2; // 2倍で描いて拡大に耐えるようにする
/** Safari の canvas 面積上限（約16.7M px）に対する安全側の目安 */
const MAX_CANVAS_AREA = 16_000_000;

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Segoe UI", Meiryo, sans-serif';

const INK = "#171717"; // neutral-900
const BG = "#ffffff";
const CALLOUT_BG = "#f5f8fa"; // brand-50
const CALLOUT_BORDER = "#dce4ec"; // brand-200
const CALLOUT_PAD = 16;

function fontOf(size: number, weight = 400, italic = false) {
  return `${italic ? "italic " : ""}${weight} ${size}px ${FONT_STACK}`;
}

// 画像URL署名用のブラウザ Supabase クライアント。書き出しはブラウザでのみ実行される
// ため、SSR/ビルド時の import で作らないよう、初回利用時に遅延生成する。
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient();
  return _supabase;
}

type Seg = { text: string; font: string; color: string };
type Piece = Seg & { x: number };
type Line = Piece[];

type Block =
  | {
      kind: "text";
      segs: Seg[];
      lineHeight: number;
      marginTop: number;
      marginBottom: number;
      /** 箇条書きの項目。行頭に「・」を描き、本文はその右へ字下げする */
      bullet?: boolean;
      lines?: Line[];
      height?: number;
    }
  | {
      kind: "image";
      img: HTMLImageElement;
      marginTop: number;
      marginBottom: number;
      height?: number;
      drawW?: number;
      drawH?: number;
    }
  | {
      kind: "sketch";
      strokes: Stroke[];
      refW: number;
      refH: number;
      marginTop: number;
      marginBottom: number;
      height?: number;
    }
  | {
      kind: "callout";
      inner: Block[];
      marginTop: number;
      marginBottom: number;
      height?: number;
    };

// ---- doc の走査 ----------------------------------------------------------

/** テキストノードの装飾（太字・斜体・色）を canvas のフォント指定に写す */
function segsOf(node: PMNode, size: number, baseWeight: number): Seg[] {
  const segs: Seg[] = [];
  node.forEach((child) => {
    // 改行（Shift+Enter）は "\n" として送り、折り返し側で行を分ける
    if (child.type.name === "hardBreak") {
      segs.push({ text: "\n", font: fontOf(size, baseWeight), color: INK });
      return;
    }
    if (!child.isText || !child.text) return;
    let weight = baseWeight;
    let italic = false;
    let color = INK;
    for (const m of child.marks) {
      if (m.type.name === "bold") weight = 700;
      if (m.type.name === "italic") italic = true;
      if (m.type.name === "textStyle" && typeof m.attrs.color === "string" && m.attrs.color)
        color = m.attrs.color;
    }
    segs.push({ text: child.text, font: fontOf(size, weight, italic), color });
  });
  return segs;
}

const HEADING = { 1: 28, 2: 24, 3: 20 } as const;

/** 箇条書きの「・」ぶんの字下がり幅(px)。折り返した2行目以降もここに揃える */
const BULLET_INDENT = 24;

async function collectBlocks(parent: PMNode): Promise<Block[]> {
  const blocks: Block[] = [];

  for (let i = 0; i < parent.childCount; i++) {
    const node = parent.child(i);
    const name = node.type.name;

    if (name === "paragraph") {
      // 空段落は1行ぶんの余白として残す（見た目を本文に合わせる）
      const segs = segsOf(node, 17, 400);
      blocks.push({
        kind: "text",
        segs,
        lineHeight: 29,
        marginTop: 0,
        marginBottom: 9,
      });
    } else if (name === "heading") {
      const level = (node.attrs.level as 1 | 2 | 3) ?? 1;
      const size = HEADING[level] ?? 20;
      blocks.push({
        kind: "text",
        segs: segsOf(node, size, 600),
        lineHeight: Math.round(size * 1.4),
        marginTop: 14,
        marginBottom: 6,
      });
    } else if (name === "imageBlock") {
      // 本文には Storage パス（旧データは公開URL）が入っている。非公開バケット
      // のため、fetch 可能な署名付きURLへ解決してから読み込む。
      const signed = await createSignedImageUrl(getSupabase(), String(node.attrs.src ?? ""));
      const img = await loadImage(signed);
      if (img) blocks.push({ kind: "image", img, marginTop: 6, marginBottom: 12 });
    } else if (name === "sketch") {
      const strokes = deserialize(String(node.attrs.strokes ?? "[]"));
      const refW = Number(node.attrs.w) || CONTENT;
      const refH = Number(node.attrs.h) || 220;
      blocks.push({ kind: "sketch", strokes, refW, refH, marginTop: 6, marginBottom: 12 });
    } else if (name === "bulletList") {
      // 箇条書き。項目（listItem）の中身は段落なので、その中身をそのまま
      // 集めたうえで、項目の先頭ブロックだけ「・」付き（＝字下げ）にする。
      for (let j = 0; j < node.childCount; j++) {
        const inner = await collectBlocks(node.child(j));
        let first = true;
        for (const b of inner) {
          if (b.kind === "text") {
            // 項目どうしの間隔は、段落より詰める（画面表示に合わせる）
            b.marginBottom = 3;
            if (first) {
              b.bullet = true;
              first = false;
            }
          }
          blocks.push(b);
        }
      }
    } else if (name === "transcriptCallout") {
      blocks.push({
        kind: "callout",
        inner: await collectBlocks(node),
        marginTop: 6,
        marginBottom: 12,
      });
    } else if (node.isTextblock) {
      blocks.push({
        kind: "text",
        segs: segsOf(node, 17, 400),
        lineHeight: 29,
        marginTop: 0,
        marginBottom: 9,
      });
    }
  }

  return blocks;
}

/** blob URL 経由で読む。cross-origin のまま描くと toBlob が SecurityError になる */
async function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("decode failed"));
        img.src = url;
      });
      // blob URL を捨てる前に確実にデコードさせる（Safari は遅延デコードする
      // ことがあり、revoke 後に描くと空になる）
      try {
        await img.decode();
      } catch {
        // decode 未対応でも onload 済みなら大抵描ける
      }
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // 読めない画像1枚で書き出し全体を落とさない
    return null;
  }
}

// ---- 計測（折り返し） ----------------------------------------------------

/** 文字単位で折り返す。日本語には空白が無いため、どこでも折り返してよい */
function layoutSegs(
  ctx: CanvasRenderingContext2D,
  segs: Seg[],
  maxWidth: number,
): Line[] {
  const lines: Line[] = [];
  let line: Line = [];
  let x = 0;

  for (const seg of segs) {
    ctx.font = seg.font;
    let buf = "";
    let bufX = x;

    const flush = () => {
      if (buf) {
        line.push({ text: buf, font: seg.font, color: seg.color, x: bufX });
        buf = "";
      }
    };

    for (const ch of seg.text) {
      if (ch === "\n") {
        flush();
        lines.push(line);
        line = [];
        x = 0;
        bufX = 0;
        continue;
      }
      const w = ctx.measureText(ch).width;
      if (x + w > maxWidth && (line.length > 0 || buf)) {
        flush();
        lines.push(line);
        line = [];
        x = 0;
        bufX = 0;
      }
      if (!buf) bufX = x;
      buf += ch;
      x += w;
    }
    flush();
  }
  lines.push(line);
  return lines;
}

function measureBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  width: number,
): number {
  let total = 0;

  for (const b of blocks) {
    if (b.kind === "text") {
      // 箇条書きは「・」のぶんだけ折り返し幅を狭める（右端が揃う）
      b.lines = layoutSegs(ctx, b.segs, width - (b.bullet ? BULLET_INDENT : 0));
      b.height = Math.max(1, b.lines.length) * b.lineHeight;
    } else if (b.kind === "image") {
      const scale = Math.min(1, width / (b.img.naturalWidth || width));
      b.drawW = Math.round((b.img.naturalWidth || width) * scale);
      b.drawH = Math.round((b.img.naturalHeight || 0) * scale);
      b.height = b.drawH;
    } else if (b.kind === "sketch") {
      b.height = Math.round(b.refH * (width / (b.refW || width)));
    } else {
      const innerH = measureBlocks(ctx, b.inner, width - CALLOUT_PAD * 2);
      b.height = innerH + CALLOUT_PAD * 2;
    }
    total += b.marginTop + (b.height ?? 0) + b.marginBottom;
  }

  return total;
}

// ---- 描画 ----------------------------------------------------------------

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  x: number,
  y: number,
  width: number,
): number {
  for (const b of blocks) {
    y += b.marginTop;

    if (b.kind === "text") {
      ctx.textBaseline = "alphabetic";
      const indent = b.bullet ? BULLET_INDENT : 0;
      if (b.bullet) {
        // 行頭の「・」。1行目のベースラインに合わせて左端に置く
        ctx.font = b.segs[0]?.font ?? fontOf(17);
        ctx.fillStyle = "#737373"; // neutral-500（画面表示と同じ）
        ctx.fillText("・", x, y + b.lineHeight * 0.74);
      }
      for (const line of b.lines ?? []) {
        for (const p of line) {
          ctx.font = p.font;
          ctx.fillStyle = p.color;
          // 行の下寄せ位置（ざっくり行高の 3/4 をベースラインにする）
          ctx.fillText(p.text, x + indent + p.x, y + b.lineHeight * 0.74);
        }
        y += b.lineHeight;
      }
      if ((b.lines?.length ?? 0) === 0) y += b.lineHeight;
    } else if (b.kind === "image") {
      ctx.drawImage(b.img, x, y, b.drawW ?? width, b.drawH ?? 0);
      y += b.drawH ?? 0;
    } else if (b.kind === "sketch") {
      const scale = width / (b.refW || width);
      ctx.save();
      // 画面側のブロックは overflow:hidden で切れているので、書き出しでも
      // 同じように枠外へはみ出した線を出さない（キャンバスの外にある線や、
      // 下端で見切れている線が丸ごと見えてしまうのを防ぐ）
      ctx.beginPath();
      ctx.rect(x, y, width, b.height ?? 0);
      ctx.clip();
      ctx.translate(x, y);
      replay(ctx, b.strokes, scale);
      ctx.restore();
      y += b.height ?? 0;
    } else {
      ctx.fillStyle = CALLOUT_BG;
      ctx.strokeStyle = CALLOUT_BORDER;
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, width, b.height ?? 0, 8);
      ctx.fill();
      ctx.stroke();
      drawBlocks(
        ctx,
        b.inner,
        x + CALLOUT_PAD,
        y + CALLOUT_PAD,
        width - CALLOUT_PAD * 2,
      );
      y += b.height ?? 0;
    }

    y += b.marginBottom;
  }

  return y;
}

// ---- 公開 API ------------------------------------------------------------

/** メモ（タイトル＋本文）を PNG の Blob にする */
export async function noteToPngBlob(doc: PMNode, title: string): Promise<Blob> {
  const blocks = await collectBlocks(doc);

  // 計測用の使い捨てコンテキスト
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("canvas を利用できません");

  const titleText = title.trim();
  const titleSegs: Seg[] = titleText
    ? [{ text: titleText, font: fontOf(32, 600), color: INK }]
    : [];
  const titleLines = titleSegs.length
    ? layoutSegs(measure, titleSegs, CONTENT)
    : [];
  const titleH = titleLines.length * 44 + (titleLines.length ? 18 : 0);

  const bodyH = measureBlocks(measure, blocks, CONTENT);
  const height = Math.max(200, Math.ceil(PAD * 2 + titleH + bodyH));

  // 長いメモだと 2倍解像度では Safari の canvas 面積上限(約16.7M px)を
  // 超えて真っ白になる。超えそうなら解像度を落として確実に書き出す。
  const scale = WIDTH * SCALE * height * SCALE > MAX_CANVAS_AREA ? 1 : SCALE;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas を利用できません");
  ctx.scale(scale, scale);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);

  let y = PAD;
  if (titleLines.length) {
    ctx.textBaseline = "alphabetic";
    for (const line of titleLines) {
      for (const p of line) {
        ctx.font = p.font;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, PAD + p.x, y + 33);
      }
      y += 44;
    }
    y += 18;
  }

  drawBlocks(ctx, blocks, PAD, y, CONTENT);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画像の生成に失敗しました"))),
      "image/png",
    );
  });
}

/** ファイル名に使えない文字を落とす */
function safeFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
  return `${base || "メモ"}.png`;
}

/** メモを PNG として端末に保存する */
export async function downloadNoteAsPng(doc: PMNode, title: string): Promise<void> {
  const blob = await noteToPngBlob(doc, title);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName(title);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // click 直後に revoke すると Safari で保存されないことがあるため少し待つ
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
