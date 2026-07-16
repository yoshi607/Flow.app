// アップロード前に画像をブラウザ側で縮小・再圧縮する。
//
// 本文には画像URLだけを入れ（base64は本文と検索インデックスを肥大させる）、
// 実体は圧縮した1枚だけを Storage に置く。これにより本文もリアルタイム同期の
// ペイロードも小さく保たれる。

// 長辺の上限。これを超える画像は縮小する
const MAX_DIM = 1600;
// WebP/JPEG の画質
const QUALITY = 0.8;

export type CompressedImage = {
  blob: Blob;
  /** 表示前のレイアウト崩れを防ぐための自然寸法（CSS px 相当） */
  width: number;
  height: number;
  /** 拡張子（アップロードのファイル名に使う） */
  ext: string;
};

// File を canvas 経由で縮小・再圧縮する。
async function drawToCanvas(
  source: CanvasImageSource,
  sw: number,
  sh: number,
): Promise<CompressedImage> {
  const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした");
  ctx.drawImage(source, 0, 0, width, height);

  // まず WebP を試す。使えない環境では JPEG にフォールバックする。
  const blob =
    (await toBlob(canvas, "image/webp")) ??
    (await toBlob(canvas, "image/jpeg"));
  if (!blob) throw new Error("画像の変換に失敗しました");

  const ext = blob.type === "image/webp" ? ".webp" : ".jpg";
  return { blob, width, height, ext };
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b && b.type === type ? b : null),
      type,
      QUALITY,
    );
  });
}

// <img> で読み込んで自然寸法を得るフォールバック（createImageBitmap 非対応時）
function loadViaImg(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const out = await drawToCanvas(img, img.naturalWidth, img.naturalHeight);
        resolve(out);
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}

export async function compressImage(file: File): Promise<CompressedImage> {
  // アニメーションGIFは1フレームに潰れてしまうため、原本のまま扱う
  if (file.type === "image/gif") {
    const dim = await naturalSize(file);
    return { blob: file, width: dim.w, height: dim.h, ext: ".gif" };
  }

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const out = await drawToCanvas(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return out;
    } catch {
      // 一部フォーマットで createImageBitmap が失敗するので <img> で再挑戦
    }
  }
  return loadViaImg(file);
}

function naturalSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}
