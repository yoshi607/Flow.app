import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotesProvider } from "@/lib/store";
import StandaloneNote from "@/components/StandaloneNote";

// メモを別ウィンドウで開いたときの単体表示ページ
export default async function NoteWindow({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <NotesProvider userId={user.id}>
      <StandaloneNote noteId={params.id} />
    </NotesProvider>
  );
}
