"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { passwordIssue } from "@/lib/passwordPolicy";
import { SHORT_NOTE_DAYS, TRASH_RETENTION_DAYS } from "@/lib/types";
import splashScreens from "@/lib/splashScreens.json";
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

  // パスワード変更用の状態。
  // このプロジェクトは Supabase 側で「パスワード変更時に現在のパスワードを必須」
  // （GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD）が有効。
  // そのため updateUser に current_password を渡す必要がある（メールコードは不要）。
  const [pwOpen, setPwOpen] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("current-password") ?? "");
    const password = String(data.get("new-password") ?? "");
    const confirm = String(data.get("confirm-password") ?? "");

    setPwError(null);
    setPwDone(false);

    const issue = passwordIssue(password);
    if (issue) {
      setPwError(issue);
      return;
    }
    if (password !== confirm) {
      setPwError("確認用パスワードが一致しません。");
      return;
    }
    if (password === currentPassword) {
      setPwError("現在と異なるパスワードを設定してください。");
      return;
    }

    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password,
        current_password: currentPassword,
      });
      if (error) throw error;
      setPwDone(true);
      form.reset();
      setPwOpen(false);
    } catch (err: unknown) {
      const e2 = err as { message?: string; code?: string; status?: number };
      // 開発者確認用にコンソールへ生のまま残す
      console.error("password change error:", err);
      // 現在のパスワード違い・必須系はわかりやすい日本語にする
      if (
        e2?.code === "current_password_required" ||
        e2?.code === "current_password_invalid" ||
        e2?.status === 400 ||
        /current password/i.test(e2?.message ?? "")
      ) {
        setPwError("現在のパスワードが正しくありません。");
      } else {
        setPwError(e2?.message ?? "パスワードの変更に失敗しました。");
      }
    } finally {
      setPwSaving(false);
    }
  }

  // バージョン情報（デプロイのたびに変わる。反映されているかの確認用）
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT ?? "local";
  const buildTimeRaw = process.env.NEXT_PUBLIC_BUILD_TIME;
  const buildTime = buildTimeRaw
    ? new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tokyo",
      }).format(new Date(buildTimeRaw))
    : "不明";

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // 端末情報（起動画像がどの端末で一致していないかを調べるための表示）。
  // iOS のスプラッシュは media が実機と完全一致しないと真っ白になるため、
  // 実測値と「一致した起動画像があるか」をここで確認できるようにする。
  const [deviceInfo, setDeviceInfo] = useState<{
    screen: string;
    dpr: number;
    viewport: string;
    standalone: boolean;
    matched: string | null;
  } | null>(null);

  useEffect(() => {
    const matched =
      splashScreens.find((s) => window.matchMedia(s.media).matches) ?? null;
    setDeviceInfo({
      screen: `${window.screen.width}x${window.screen.height}`,
      dpr: window.devicePixelRatio,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari 独自
        (window.navigator as unknown as { standalone?: boolean }).standalone === true,
      matched: matched?.href ?? null,
    });
  }, []);

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

          {/* パスワード変更（現在のパスワードで本人確認する方式） */}
          <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
            <button
              onClick={() => {
                setPwOpen((v) => !v);
                setPwDone(false);
                setPwError(null);
              }}
              className="flex w-full items-center justify-between font-medium"
            >
              <span>パスワードを変更</span>
              <span className="text-neutral-400">{pwOpen ? "−" : "＋"}</span>
            </button>

            {pwDone && !pwOpen && (
              <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                パスワードを変更しました。
              </p>
            )}

            {pwOpen && (
              <form onSubmit={handleChangePassword} className="mt-3 space-y-2">
                {/* 自動入力のためユーザー名欄を隠して置く */}
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  defaultValue={userEmail}
                  className="hidden"
                  readOnly
                  aria-hidden
                />
                <input
                  type="password"
                  name="current-password"
                  required
                  autoComplete="current-password"
                  placeholder="現在のパスワード"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <input
                  type="password"
                  name="new-password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  placeholder="新しいパスワード（10文字以上）"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <input
                  type="password"
                  name="confirm-password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  placeholder="新しいパスワード（確認）"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <p className="text-xs text-neutral-400">
                  10文字以上。英小文字・英大文字・数字・記号のうち3種類以上。
                </p>
                {pwError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{pwError}</p>
                )}
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="w-full rounded-lg bg-brand-500 py-2 font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  {pwSaving ? "変更中…" : "パスワードを変更する"}
                </button>
              </form>
            )}
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

          {/* バージョン（反映されているかの確認用） */}
          <div className="flex items-center justify-between pt-1 text-xs text-neutral-400">
            <span>バージョン</span>
            <span className="font-mono">
              {commit} ・ {buildTime}
            </span>
          </div>

          {/* 端末情報（起動画面の不一致を調べるための一時的な表示） */}
          {deviceInfo && (
            <div className="rounded-lg bg-neutral-100 p-2 font-mono text-[10px] leading-relaxed text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <div>screen: {deviceInfo.screen} @{deviceInfo.dpr}x</div>
              <div>viewport: {deviceInfo.viewport}</div>
              <div>standalone: {String(deviceInfo.standalone)}</div>
              <div className={deviceInfo.matched ? "" : "text-red-500"}>
                splash: {deviceInfo.matched ?? "一致なし"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
