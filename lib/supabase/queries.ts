import type { SupabaseClient } from "@supabase/supabase-js";
import type { Note, Folder } from "@/lib/types";

// ページ初回描画時にメモ/フォルダをサーバー側で先読みするための共通クエリ
// （クライアント側フェッチの待ち時間を無くすために使用）
export async function fetchInitialNotesData(supabase: SupabaseClient) {
  const [notesRes, foldersRes] = await Promise.all([
    supabase
      .from("notes")
      .select("*")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase.from("folders").select("*").order("sort_order").order("created_at"),
  ]);

  // エラーを握りつぶすと「取得失敗」が「メモ0件」と区別できなくなるため必ず記録する
  if (notesRes.error) {
    console.error("メモの取得に失敗:", notesRes.error.message);
  }
  if (foldersRes.error) {
    console.error("フォルダの取得に失敗:", foldersRes.error.message);
  }

  return {
    notes: (notesRes.data as Note[]) ?? [],
    folders: (foldersRes.data as Folder[]) ?? [],
  };
}
