// Flow_icon/ 内のソース画像から PWA / favicon 用アイコンを生成する
// 実行: node scripts/gen-icons.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.join(process.cwd(), "Flow_icon");
const OUT_DIR = path.join(process.cwd(), "public", "icons");
const LIGHT_SRC = path.join(SRC_DIR, "Flow_light_icon.png");
const DARK_SRC = path.join(SRC_DIR, "Flow_dark_icon.png");

fs.mkdirSync(OUT_DIR, { recursive: true });

// 余白の白背景を取り除き、正方形のアイコングリフだけを取り出す
async function trimmedGlyph(src) {
  return sharp(src).trim().toBuffer();
}

// 通常アイコン：グリフをそのまま正方形にリサイズ（透過背景のまま）
async function writeIcon(glyph, size, outFile) {
  await sharp(glyph)
    .resize(size, size, { fit: "cover" })
    .png()
    .toFile(path.join(OUT_DIR, outFile));
}

// maskable アイコン：OS 側で丸型などにマスクされても絵柄が欠けないよう、
// グリフを縮小してセーフゾーン内に収め、周囲をグリフ由来の色で塗りつぶす
async function writeMaskableIcon(glyph, size, outFile) {
  const glyphImg = sharp(glyph);
  const meta = await glyphImg.metadata();

  // 背景色はグリフ上部中央（矢印の線に重なりにくい位置）からサンプリング
  const { data } = await sharp(glyph)
    .extract({
      left: Math.floor(meta.width * 0.45),
      top: Math.floor(meta.height * 0.03),
      width: Math.max(1, Math.floor(meta.width * 0.1)),
      height: Math.max(1, Math.floor(meta.height * 0.05)),
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [r, g, b] = data;

  const inner = Math.round(size * 0.72);
  const resizedGlyph = await sharp(glyph)
    .resize(inner, inner, { fit: "cover" })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .composite([
      { input: resizedGlyph, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) },
    ])
    .png()
    .toFile(path.join(OUT_DIR, outFile));
}

const lightGlyph = await trimmedGlyph(LIGHT_SRC);
const darkGlyph = await trimmedGlyph(DARK_SRC);

// PWA / ホーム画面アイコン（各プラットフォームとも動的なライト/ダーク切替に
// 対応していないため、既定値として指定された Flow_light_icon を使用）
await writeIcon(lightGlyph, 192, "icon-192.png");
await writeIcon(lightGlyph, 512, "icon-512.png");
await writeIcon(lightGlyph, 180, "apple-touch-icon.png");
await writeMaskableIcon(lightGlyph, 512, "icon-maskable-512.png");

// ブラウザタブの favicon はライト/ダーク動的切替に対応できるため両方書き出す
await writeIcon(lightGlyph, 48, "favicon-light-48.png");
await writeIcon(darkGlyph, 48, "favicon-dark-48.png");

console.log("アイコンを public/icons/ に生成しました。");
