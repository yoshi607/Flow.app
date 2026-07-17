// iOS（ホーム画面に追加したPWA）用の起動画面（スプラッシュ）を生成する。
// 実行: node scripts/gen-splash.mjs
//
// iOS は Android と違い manifest の background_color を見てくれず、
// 端末サイズごとに用意した apple-touch-startup-image が必要。合致する画像が
// 無いと真っ白な画面が出るため、主要な端末サイズ分を書き出す。
//
// 画像と同時に、<link> を組み立てるための一覧を lib/splashScreens.json に
// 出力する。app/layout.tsx はこれを読むだけなので、端末リストの二重管理に
// ならない（端末を足すときはこのファイルの DEVICES だけ直す）。
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "Flow_icon", "Flow_light_icon.png");
const OUT_DIR = path.join(process.cwd(), "public", "splash");
const LIST_FILE = path.join(process.cwd(), "lib", "splashScreens.json");

// 背景色：アイコンと同系の淡い水色。アイコンが際立ち、アプリ本体の
// 地色(#f5f8fa)へも自然につながる。
const BG = "#dceef8";

// アイコンの大きさ（CSSピクセル）。画面の短辺に対する比率で決め、
// 大画面(iPad)で大きくなりすぎないよう上限を設ける。
const ICON_RATIO = 0.28;
const ICON_MIN = 96;
const ICON_MAX = 180;

// 対象端末（CSSピクセルの縦持ち寸法と、解像度倍率）
const DEVICES = [
  // --- iPhone ---
  { w: 440, h: 956, r: 3 }, // 15 Pro Max / 16 Plus
  { w: 430, h: 932, r: 3 }, // 14 Pro Max / 15 Plus
  { w: 402, h: 874, r: 3 }, // 16 Pro
  { w: 393, h: 852, r: 3 }, // 14 Pro / 15 / 16
  { w: 428, h: 926, r: 3 }, // 12·13 Pro Max / 14 Plus
  { w: 390, h: 844, r: 3 }, // 12 / 13 / 14
  { w: 375, h: 812, r: 3 }, // X / XS / 11 Pro / 13 mini
  { w: 414, h: 896, r: 3 }, // XS Max / 11 Pro Max
  { w: 414, h: 896, r: 2 }, // XR / 11
  { w: 375, h: 667, r: 2 }, // 8 / SE(2·3)
  { w: 414, h: 736, r: 3 }, // 8 Plus
  { w: 320, h: 568, r: 2 }, // SE(1)
  // --- iPad ---
  // ※Pro は M4 世代(2024)で画面寸法が変わっている。旧11インチ(2388x1668)の
  //   指定しか無いと、M4/M5 の 11インチ(2420x1668) では一致せず真っ白になる。
  //
  // ※さらに「設定 > 画面表示と明るさ > 拡大表示」を「スペースを拡大」にすると、
  //   パネルより大きい論理解像度で描画して縮小するため、公称スペックから
  //   計算した寸法とは別の値になる。実機で確認した値を併記しておく
  //   （設定画面の端末情報に screen の実測値が出るので、合わない端末が
  //    あればその値をここに足す）。
  { w: 970, h: 1408, r: 2 }, // Pro 11 (M4 / M5) 拡大表示=スペースを拡大【実機確認】
  { w: 834, h: 1210, r: 2 }, // Pro 11 (M4 / M5) 既定    実ピクセル 1668x2420
  { w: 1032, h: 1376, r: 2 }, // Pro 13 (M4 / M5) 既定   実ピクセル 2064x2752
  { w: 834, h: 1194, r: 2 }, // Pro 11 (M1 / M2)   実ピクセル 1668x2388
  { w: 1024, h: 1366, r: 2 }, // Pro 12.9 / Air 13
  { w: 834, h: 1112, r: 2 }, // Pro 10.5
  { w: 820, h: 1180, r: 2 }, // Air 11 / 第10・11世代
  { w: 810, h: 1080, r: 2 }, // 10.2（第9世代）
  { w: 768, h: 1024, r: 2 }, // 9.7
  { w: 744, h: 1133, r: 2 }, // mini 6 / mini 7
];

fs.mkdirSync(OUT_DIR, { recursive: true });

// 余白を落としてアイコンのグリフだけにする（gen-icons.mjs と同じ方針）
const glyph = await sharp(SRC).trim().toBuffer();

/** 1枚書き出す。w/h は実ピクセル（CSSピクセル×倍率） */
async function writeSplash(pxW, pxH, iconPx) {
  const icon = await sharp(glyph)
    .resize(iconPx, iconPx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const file = `apple-splash-${pxW}x${pxH}.png`;
  await sharp({
    create: { width: pxW, height: pxH, channels: 4, background: BG },
  })
    .composite([
      {
        input: icon,
        left: Math.round((pxW - iconPx) / 2),
        top: Math.round((pxH - iconPx) / 2),
      },
    ])
    // 背景が単色でアイコンだけ多色のため、パレットPNGにすると画質をほぼ
    // 落とさずファイルサイズが1/10近くになる（38枚あるので効果が大きい）
    .png({ palette: true, quality: 90, effort: 8, compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, file));
  return file;
}

const links = [];
const written = new Set();

for (const d of DEVICES) {
  const iconCss = Math.max(
    ICON_MIN,
    Math.min(ICON_MAX, Math.round(Math.min(d.w, d.h) * ICON_RATIO)),
  );
  const iconPx = Math.round(iconCss * d.r);

  for (const orientation of ["portrait", "landscape"]) {
    // iOS の device-width/height は縦持ち基準のまま。向きで画像だけ入れ替える。
    const pxW = (orientation === "portrait" ? d.w : d.h) * d.r;
    const pxH = (orientation === "portrait" ? d.h : d.w) * d.r;

    const file = `apple-splash-${pxW}x${pxH}.png`;
    if (!written.has(file)) {
      await writeSplash(pxW, pxH, iconPx);
      written.add(file);
    }
    links.push({
      media:
        `(device-width: ${d.w}px) and (device-height: ${d.h}px) ` +
        `and (-webkit-device-pixel-ratio: ${d.r}) and (orientation: ${orientation})`,
      href: `/splash/${file}`,
    });
  }
}

fs.writeFileSync(LIST_FILE, `${JSON.stringify(links, null, 2)}\n`);

console.log(`スプラッシュを ${written.size} 枚 public/splash/ に生成しました。`);
console.log(`リンク定義を lib/splashScreens.json に書き出しました（${links.length}件）。`);
