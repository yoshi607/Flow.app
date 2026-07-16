"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { passwordIssue } from "@/lib/passwordPolicy";
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

  // パスワード変更用の状態。
  // Supabase の「Secure password change」が有効なため、変更前にメールで届く
  // 確認コード（nonce）での再認証が必須。そのため2段階にする:
  //   step "form" … 新パスワードを入力 → reauthenticate() でコード送信
  //   step "code" … 届いたコードを入力 → updateUser({ password, nonce })
  const [pwOpen, setPwOpen] = useState(false);
  const [pwStep, setPwStep] = useState<"form" | "code">("form");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwInfo, setPwInfo] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  // 新パスワードは段階をまたいで保持する（コード入力画面では再入力させない）
  const [pendingPassword, setPendingPassword] = useState("");

  function resetPwFlow() {
    setPwStep("form");
    setPwError(null);
    setPwInfo(null);
    setPendingPassword("");
  }

  // step1: 新パスワードを検証し、確認コードをメール送信する
  async function handleSendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get("new-password") ?? "");
    const confirm = String(data.get("confirm-password") ?? "");

    setPwError(null);
    setPwInfo(null);
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

    setPwSaving(true);
    try {
      // ログイン中ユーザーのメール（または電話）へ確認コードを送る
      const { error } = await supabase.auth.reauthenticate();
      if (error) throw error;
      setPendingPassword(password);
      setPwStep("code");
      setPwInfo(`確認コードを ${userEmail} に送りました。メールを確認してください。`);
    } catch (err: unknown) {
      setPwError(
        err instanceof Error ? err.message : "確認コードの送信に失敗しました。",
      );
    } finally {
      setPwSaving(false);
    }
  }

  // step2: 届いたコード（nonce）でパスワードを確定する
  async function handleConfirmCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const nonce = String(data.get("code") ?? "").trim();

    setPwError(null);

    if (!nonce) {
      setPwError("確認コードを入力してください。");
      return;
    }

    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: pendingPassword,
        nonce,
      });
      if (error) throw error;
      setPwDone(true);
      setPwOpen(false);
      resetPwFlow();
    } catch (err: unknown) {
      setPwError(
        err instanceof Error
          ? err.message
          : "コードが正しくないか、パスワードの変更に失敗しました。",
      );
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

          {/* パスワード変更（Secure password change 対応：メール確認コード方式） */}
          <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
            <button
              onClick={() => {
                setPwOpen((v) => !v);
                setPwDone(false);
                resetPwFlow();
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

            {pwOpen && pwStep === "form" && (
              <form onSubmit={handleSendCode} className="mt-3 space-y-2">
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
                  本人確認のため、続けてメールに届くコードの入力が必要です。
                </p>
                {pwError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{pwError}</p>
                )}
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="w-full rounded-lg bg-brand-500 py-2 font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  {pwSaving ? "送信中…" : "確認コードを送る"}
                </button>
              </form>
            )}

            {pwOpen && pwStep === "code" && (
              <form onSubmit={handleConfirmCode} className="mt-3 space-y-2">
                {pwInfo && (
                  <p className="text-xs text-green-600 dark:text-green-400">{pwInfo}</p>
                )}
                <input
                  type="text"
                  name="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="メールに届いた確認コード"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 tracking-widest outline-none focus:ring-2 focus:ring-brand-400 dark:border-neutral-700 dark:bg-neutral-900"
                />
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
                <button
                  type="button"
                  onClick={resetPwFlow}
                  className="w-full py-1 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  やり直す（新しいパスワードを入れ直す）
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
        </div>
      </div>
    </div>
  );
}
