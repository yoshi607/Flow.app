import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Note,
  type Folder,
  type UserSettings,
  DEFAULT_SHORT_NOTE_DAYS,
} from "@/lib/types";

// ページ初回描画時にメモ/フォルダ/設定をサーバー側で先読みするための共通クエリ
// （クライアント側フェッチの待ち時間を無くすために使用）
export async function fetchInitialNotesData(supabase: SupabaseClient) {
  const [notesRes, foldersRes, settingsRes] = await Promise.all([
    supabase
      .from("notes")
      .select("*")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase.from("folders").select("*").order("sort_order").order("created_at"),
    // 設定は1行だけ。未作成なら行が無い（＝既定値を使う）ので maybeSingle。
    supabase.from("user_settings").select("*").maybeSingle(),
  ]);

  // エラーを握りつぶすと「取得失敗」が「メモ0件」と区別できなくなるため必ず記録する
  if (notesRes.error) {
    console.error("メモの取得に失敗:", notesRes.error.message);
  }
  if (foldersRes.error) {
    console.error("フォルダの取得に失敗:", foldersRes.error.message);
  }
  // 0007_user_settings.sql 未適用の環境でも、既定値でアプリ全体は動かす
  if (settingsRes.error) {
    console.error("設定の取得に失敗:", settingsRes.error.message);
  }

  const settings = settingsRes.data as UserSettings | null;

  return {
    notes: (notesRes.data as Note[]) ?? [],
    folders: (foldersRes.data as Folder[]) ?? [],
    // 取得に失敗したときだけ null（＝不明）。呼び出し側は今の値を保つ。
    // 行がまだ無いユーザーは既定値。
    shortNoteDays: settingsRes.error
      ? null
      : (settings?.short_note_days ?? DEFAULT_SHORT_NOTE_DAYS),
  };
}
