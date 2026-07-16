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

export async function uploadAttachment(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  file: File,
): Promise<Attachment> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`「${file.name}」は20MBを超えているため添付できません。`);
  }

  // Supabase Storage のキーは ASCII のみ安全なので、パスに使う名前は
  // 非ASCII（日本語など）を除去する。表示名(file_name)は元の名前を保持。
  // （手書き画像「手書き…png」などが Invalid key で失敗するのを防ぐ）
  const extMatch = file.name.match(/\.[A-Za-z0-9]+$/);
  const ext = extMatch ? extMatch[0] : "";
  const asciiBase =
    file.name
      .slice(0, file.name.length - ext.length)
      .replace(/[^\w.\-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "file";
  const path = `${userId}/${noteId}/${crypto.randomUUID()}-${asciiBase}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file);
  if (uploadError) {
    throw new Error(`アップロードに失敗しました: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const insert = {
    note_id: noteId,
    file_url: publicUrlData.publicUrl,
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    type: file.type.startsWith("image/") ? "image" : "file",
  };

  const { data, error } = await supabase
    .from("attachments")
    .insert(insert)
    .select()
    .single();
  if (error) {
    // DB行の作成に失敗した場合はアップロード済みファイルを掃除する
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`添付の保存に失敗しました: ${error.message}`);
  }

  return data as Attachment;
}

// 本文に埋め込む画像を Storage に上げ、公開URLを返す。
// uploadAttachment と違い attachments 行は作らない（本文が参照元。添付ストリップに
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
