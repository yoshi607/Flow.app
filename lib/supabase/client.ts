"use client";

import { createBrowserClient } from "@supabase/ssr";

// ブラウザ（クライアントコンポーネント）用の Supabase クライアント
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
