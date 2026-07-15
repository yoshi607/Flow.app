// 手書きブロックの線データ。
//
// 画像ではなく「線」で持つ理由:
//  - 本文(notes.body)はデバウンスのたびに全文が UPDATE され、Realtime でも
//    行ごと配信される。base64 画像を埋めると同期・検索・FTSが軒並み壊れる。
//  - あとから線単位で消したり、取り消し(Cmd+Z)したりできる。
//  - 画面幅が変わっても、描き直せば崩れない。
//
// 座標は「基準幅(w)におけるピクセル」で保存する。表示するときは
// scale = 現在の幅 / 基準幅 を掛ける。

export type Stroke = {
  /** 色 */
  c: string;
  /** 基準の太さ */
  w: number;
  /** [x, y, 筆圧, x, y, 筆圧, ...] の平坦な配列（座標は基準幅におけるpx） */
  p: number[];
};

/** 前の点からこれ未満しか動いていない点は捨てる（本文サイズ対策） */
const MIN_POINT_DIST = 1;

/** 保存時に丸める小数の桁 */
const ROUND = 10;

export function serialize(strokes: Stroke[]): string {
  return JSON.stringify(
    strokes.map((s) => ({
      c: s.c,
      w: s.w,
      p: s.p.map((n) => Math.round(n * ROUND) / ROUND),
    })),
  );
}

export function deserialize(json: string | null | undefined): Stroke[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Stroke =>
        !!s &&
        typeof s === "object" &&
        typeof (s as Stroke).c === "string" &&
        typeof (s as Stroke).w === "number" &&
        Array.isArray((s as Stroke).p),
    );
  } catch {
    // 壊れたデータで本文ごと道連れにしない
    return [];
  }
}

/** 点を足す。近すぎる点は捨てる（足したら true） */
export function pushPoint(
  s: Stroke,
  x: number,
  y: number,
  pressure: number,
): boolean {
  const n = s.p.length;
  if (n >= 3) {
    const dx = x - s.p[n - 3];
    const dy = y - s.p[n - 2];
    if (dx * dx + dy * dy < MIN_POINT_DIST * MIN_POINT_DIST) return false;
  }
  s.p.push(x, y, pressure);
  return true;
}

/** 1本の線を描く。筆圧の効き方は全画面キャンバスと同じ */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  scale: number,
): void {
  const n = s.p.length / 3;
  if (n < 1) return;

  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 書き始めの点（速く短い筆は線分がほぼ無いため、点だけは必ず打つ）
  const w0 = s.w * (0.5 + s.p[2]) * scale;
  ctx.beginPath();
  ctx.arc(s.p[0] * scale, s.p[1] * scale, Math.max(w0 / 2, 0.5), 0, Math.PI * 2);
  ctx.fill();

  for (let i = 1; i < n; i++) {
    const px = s.p[(i - 1) * 3] * scale;
    const py = s.p[(i - 1) * 3 + 1] * scale;
    const x = s.p[i * 3] * scale;
    const y = s.p[i * 3 + 1] * scale;
    ctx.lineWidth = s.w * (0.5 + s.p[i * 3 + 2]) * scale;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
}

export function replay(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  scale: number,
): void {
  for (const s of strokes) drawStroke(ctx, s, scale);
}

/** 線分と点の距離の2乗 */
function segDistSq(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x: number,
  y: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((x - ax) * dx + (y - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy);
}

/** 消しゴム判定：線が (x, y) の半径 r 以内を通っているか（座標は基準幅px） */
export function strokeNear(
  s: Stroke,
  x: number,
  y: number,
  r: number,
): boolean {
  const n = s.p.length / 3;
  if (n === 0) return false;
  if (n === 1) {
    const dx = s.p[0] - x;
    const dy = s.p[1] - y;
    return dx * dx + dy * dy <= r * r;
  }
  for (let i = 1; i < n; i++) {
    const d = segDistSq(
      s.p[(i - 1) * 3],
      s.p[(i - 1) * 3 + 1],
      s.p[i * 3],
      s.p[i * 3 + 1],
      x,
      y,
    );
    if (d <= r * r) return true;
  }
  return false;
}

/** 線の一番下の y（ブロックを自動で伸ばす判定に使う） */
export function bottomOf(strokes: Stroke[]): number {
  let max = 0;
  for (const s of strokes) {
    for (let i = 0; i < s.p.length; i += 3) {
      if (s.p[i + 1] > max) max = s.p[i + 1];
    }
  }
  return max;
}
