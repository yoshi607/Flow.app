"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SHORT_NOTE_DAYS, TRASH_RETENTION_DAYS } from "@/lib/types";
import { IconClose } from "./icons";

export default function SettingsDialog({
  userEmail,
  onClose,
}: {
  userEmail: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">設定</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconClose />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <div className="text-neutral-400">ログイン中のアカウント</div>
            <div className="font-medium">{userEmail || "（不明）"}</div>
          </div>

          <div className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
            <div className="mb-1 font-medium">自動削除ルール</div>
            <ul className="list-inside list-disc space-y-0.5 text-neutral-600 dark:text-neutral-300">
              <li>短期メモは作成から {SHORT_NOTE_DAYS} 日でゴミ箱へ移動</li>
              <li>ゴミ箱のメモは {TRASH_RETENTION_DAYS} 日で完全削除</li>
            </ul>
            <p className="mt-2 text-xs text-neutral-400">
              ※ 実際の自動処理は Supabase 側（pg_cron）で毎日実行されます。
            </p>
          </div>

          <button
            onClick={signOut}
            className="w-full rounded-lg border border-red-200 py-2.5 font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}
