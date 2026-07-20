"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { passwordIssue } from "@/lib/passwordPolicy";

// パスワード再設定ページ。
// ログイン画面から送られる再設定メールのリンクは /auth/callback を経由して
// ここ（?next=/reset-password）へ来る。その時点で「回復用セッション」が
// 確立しているので、現在のパスワード無しで新しいパスワードを設定できる。
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // リンク経由でセッションが確立しているか確認する
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setHasSession(!!data.user);
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("new-password") ?? "");
    const confirm = String(data.get("confirm-password") ?? "");

    setError(null);

    const issue = passwordIssue(password);
    if (issue) {
      setError(issue);
      return;
    }
    if (password !== confirm) {
      setError("確認用パスワードが一致しません。");
      return;
    }

    setLoading(true);
    try {
      // 回復用セッションのため current_password は不要
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      // 少し見せてからアプリへ
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1200);
    } catch (err: unknown) {
      console.error("reset password error:", err);
      setError(
        err instanceof Error ? err.message : "パスワードの再設定に失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="Flow"
            width={80}
            height={80}
            className="mx-auto mb-3 h-20 w-20 rounded-2xl shadow-sm"
          />
          <h1 className="text-2xl font-semibold tracking-tight">
            パスワードの再設定
          </h1>
        </div>

        {checking ? (
          <p className="text-center text-sm text-neutral-500">確認中…</p>
        ) : !hasSession ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-neutral-500">
              リンクが無効か、期限切れの可能性があります。
              もう一度、ログイン画面からパスワード再設定をやり直してください。
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full rounded-lg bg-brand-500 py-2.5 font-medium text-white transition hover:bg-brand-600"
            >
              ログイン画面へ
            </button>
          </div>
        ) : done ? (
          <p className="text-center text-sm text-green-600">
            パスワードを変更しました。アプリに移動します…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* 自動入力のためのダミー username 欄 */}
            <input
              type="text"
              name="username"
              autoComplete="username"
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
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-400"
            />
            <input
              type="password"
              name="confirm-password"
              required
              minLength={10}
              autoComplete="new-password"
              placeholder="新しいパスワード（確認）"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-400"
            />
            <p className="text-xs text-neutral-400">
              10文字以上。英小文字・英大文字・数字・記号のうち3種類以上を含めてください。
            </p>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 transition disabled:opacity-50"
            >
              {loading ? "変更中…" : "パスワードを変更する"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
