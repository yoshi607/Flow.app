import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchInitialNotesData } from "@/lib/supabase/queries";
import { NotesProvider } from "@/lib/store";
import StandaloneNote from "@/components/StandaloneNote";

// メモを別ウィンドウで開いたときの単体表示ページ
export default async function NoteWindow({
  params,
}: {
  params: { id: string };
}) {
  const userId = headers().get("x-user-id");

  if (!userId) redirect("/login");

  const supabase = createClient();
  const { notes, folders } = await fetchInitialNotesData(supabase);

  return (
    <NotesProvider userId={userId} initialNotes={notes} initialFolders={folders}>
      <StandaloneNote noteId={params.id} />
    </NotesProvider>
  );
}
