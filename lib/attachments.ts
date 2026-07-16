import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment } from "@/lib/types";

const BUCKET = "attachments";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
// 署名付きURLの有効期限（秒）。閲覧セッション中に切れない程度に長めにしつつ、
// 万一URLが漏れても永続的に見えないよう短めに保つ折衷値。表示のたびに再発行する。
const SIGNED_URL_TTL = 60 * 60; // 1時間

export async function listAttachments(
  supabase: SupabaseClient,
  noteId: string,
): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("note_id", noteId)
    .order("created_at");
  if (error) {
    console.error("添付の取得に失敗:", error.message);
    return [];
  }
  return (data as Attachment[]) ?? [];
}

// 本文の data-src や attachments.file_url に入っている値から、Storage 上の
// パス（{user_id}/{note_id}/...）を取り出す。
// - 新形式：パスがそのまま入っている
// - 旧形式：公開URL（.../object/public/attachments/PATH）や
//           署名URL（.../object/sign/attachments/PATH?token=...）が入っている
// のどちらでも動くよう、"/attachments/" 以降を取り出して正規化する。
export function storagePathFromSrc(src: string): string {
  if (!src) return "";
  // スキーム無し＝すでに素のパス
  if (!/^https?:\/\//i.test(src)) return src.replace(/^\/+/, "");
  const marker = "/attachments/";
  const i = src.indexOf(marker);
  if (i === -1) return ""; // このバケットのURLではない
  let path = src.slice(i + marker.length);
  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q); // 署名トークン等を除去
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// Storage パスから、期限付きの署名付きURLを発行する（非公開バケット用）。
// 失敗時は空文字を返す（呼び出し側で「読み込めない画像」として扱える）。
export async function createSignedImageUrl(
  supabase: SupabaseClient,
  pathOrSrc: string,
  expiresIn: number = SIGNED_URL_TTL,
): Promise<string> {
  const path = storagePathFromSrc(pathOrSrc);
  if (!path) return "";
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) {
    console.error("署名付きURLの発行に失敗:", error.message);
    return "";
  }
  return data?.signedUrl ?? "";
}

// 本文に埋め込む画像を Storage に上げ、Storage パスを返す。
// attachments テーブルの行は作らない（本文が参照元。添付ストリップに
// 重複表示させないため）。実体は圧縮済みを渡す前提。
//
// 【非公開化】本文には公開URLではなく Storage パスを保存する。表示時に
// createSignedImageUrl で都度、期限付きの署名付きURLへ解決する。
export async function uploadImage(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  blob: Blob,
  ext: string,
): Promise<{ path: string }> {
  if (blob.size > MAX_FILE_SIZE) {
    throw new Error("画像が大きすぎます（20MBを超えています）。");
  }
  const safeExt = /^\.[A-Za-z0-9]+$/.test(ext) ? ext : ".img";
  const path = `${userId}/${noteId}/${crypto.randomUUID()}-image${safeExt}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type || undefined });
  if (uploadError) {
    throw new Error(`画像のアップロードに失敗しました: ${uploadError.message}`);
  }

  return { path };
}

export async function deleteAttachment(
  supabase: SupabaseClient,
  attachment: Attachment,
): Promise<void> {
  // file_path が無い旧データでも、file_url からパスを復元して削除を試みる。
  const path = attachment.file_path || storagePathFromSrc(attachment.file_url);
  if (path) {
    await supabase.storage.from(BUCKET).remove([path]);
  }
  const { error } = await supabase.from("attachments").delete().eq("id", attachment.id);
  if (error) {
    console.error("添付の削除に失敗:", error.message);
  }
}
