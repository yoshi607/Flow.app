import type { SupabaseClient } from "@supabase/supabase-js";
import type { Note, Folder } from "@/lib/types";

// ページ初回描画時にメモ/フォルダをサーバー側で先読みするための共通クエリ
// （クライアント側フェッチの待ち時間を無くすために使用）
export async function fetchInitialNotesData(supabase: SupabaseClient) {
  const [{ data: notes }, { data: folders }] = await Promise.all([
    supabase
      .from("notes")
      .select("*")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase.from("folders").select("*").order("sort_order").order("created_at"),
  ]);

  return {
    notes: (notes as Note[]) ?? [],
    folders: (folders as Folder[]) ?? [],
  };
}
