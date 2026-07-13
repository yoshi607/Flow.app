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

  const safeName = file.name.replace(/[^\w.\-ぁ-んァ-ヶ一-龠]/g, "_");
  const path = `${userId}/${noteId}/${crypto.randomUUID()}-${safeName}`;

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
