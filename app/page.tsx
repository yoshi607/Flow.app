import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotesProvider } from "@/lib/store";
import AppShell from "@/components/AppShell";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <NotesProvider userId={user.id}>
      <AppShell userEmail={user.email ?? ""} />
    </NotesProvider>
  );
}
