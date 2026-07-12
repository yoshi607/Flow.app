// 外部依存なしで PWA 用アイコン PNG を生成する（Node 標準の zlib のみ使用）
// 実行: node scripts/gen-icons.mjs
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "icons");

// CRC32（PNG チャンク用）
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// RGBA ピクセル配列を PNG バッファに変換
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 各行の先頭にフィルタバイト(0)を付与
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 簡易ドローイング
function makeIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  };

  // 背景（ブランドカラー #6b8296 スレート）。maskable は全面塗り、通常は角丸
  const bg = [107, 130, 150];
  const radius = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (radius > 0) {
        // 角丸判定
        const rx = Math.min(x, size - 1 - x);
        const ry = Math.min(y, size - 1 - y);
        if (rx < radius && ry < radius) {
          const dx = radius - rx;
          const dy = radius - ry;
          if (dx * dx + dy * dy > radius * radius) {
            set(x, y, 0, 0, 0, 0); // 透明
            continue;
          }
        }
      }
      set(x, y, bg[0], bg[1], bg[2], 255);
    }
  }

  // 中央に白いメモカード
  const pad = size * (maskable ? 0.3 : 0.26);
  const cardX0 = Math.round(pad);
  const cardY0 = Math.round(pad * 0.9);
  const cardX1 = size - cardX0;
  const cardY1 = size - Math.round(pad * 0.7);
  const cardR = size * 0.05;
  for (let y = cardY0; y < cardY1; y++) {
    for (let x = cardX0; x < cardX1; x++) {
      const rx = Math.min(x - cardX0, cardX1 - 1 - x);
      const ry = Math.min(y - cardY0, cardY1 - 1 - y);
      if (rx < cardR && ry < cardR) {
        const dx = cardR - rx;
        const dy = cardR - ry;
        if (dx * dx + dy * dy > cardR * cardR) continue;
      }
      set(x, y, 255, 255, 255, 255);
    }
  }

  // カード内に横線（テキストのイメージ）
  const lineColor = [159, 176, 192];
  const lineH = Math.max(2, Math.round(size * 0.028));
  const lineX0 = cardX0 + Math.round(size * 0.09);
  const lineX1 = cardX1 - Math.round(size * 0.09);
  const nLines = 3;
  const gap = (cardY1 - cardY0) / (nLines + 1.5);
  for (let n = 1; n <= nLines; n++) {
    const yBase = Math.round(cardY0 + gap * n + gap * 0.3);
    const x1 = n === nLines ? lineX0 + (lineX1 - lineX0) * 0.6 : lineX1;
    for (let y = yBase; y < yBase + lineH; y++) {
      for (let x = lineX0; x < x1; x++) {
        set(x, y, lineColor[0], lineColor[1], lineColor[2], 255);
      }
    }
  }

  return encodePNG(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "icon-192.png"), makeIcon(192));
fs.writeFileSync(path.join(OUT_DIR, "icon-512.png"), makeIcon(512));
fs.writeFileSync(
  path.join(OUT_DIR, "icon-maskable-512.png"),
  makeIcon(512, { maskable: true }),
);

console.log("アイコンを public/icons/ に生成しました。");
