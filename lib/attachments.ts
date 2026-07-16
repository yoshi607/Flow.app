import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment } from "@/lib/types";

const BUCKET = "attachments";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

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

// 本文に埋め込む画像を Storage に上げ、公開URLを返す。
// attachments テーブルの行は作らない（本文が参照元。添付ストリップに
// 重複表示させないため）。実体は圧縮済みを渡す前提。
export async function uploadImage(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  blob: Blob,
  ext: string,
): Promise<{ url: string; path: string }> {
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

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function deleteAttachment(
  supabase: SupabaseClient,
  attachment: Attachment,
): Promise<void> {
  if (attachment.file_path) {
    await supabase.storage.from(BUCKET).remove([attachment.file_path]);
  }
  const { error } = await supabase.from("attachments").delete().eq("id", attachment.id);
  if (error) {
    console.error("添付の削除に失敗:", error.message);
  }
}
