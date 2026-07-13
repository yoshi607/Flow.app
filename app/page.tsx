import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchInitialNotesData } from "@/lib/supabase/queries";
import { NotesProvider } from "@/lib/store";
import AppShell from "@/components/AppShell";

export default async function Home() {
  const userId = headers().get("x-user-id");
  const userEmail = headers().get("x-user-email");

  if (!userId) redirect("/login");

  const supabase = createClient();
  const { notes, folders } = await fetchInitialNotesData(supabase);

  return (
    <NotesProvider userId={userId} initialNotes={notes} initialFolders={folders}>
      <AppShell userEmail={userEmail ?? ""} />
    </NotesProvider>
  );
}
