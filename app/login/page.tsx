"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "magic";

export default function LoginPage() {
  const router = useRouter();
  // 毎回の再描画で作り直さない（作り直すと認証リスナーが増えてしまう）
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<Mode>("signin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 【重要】メール/パスワードは state で持たない（非制御入力にする）。
  // state に持つと、iOS の自動入力（iCloudキーチェーン）が React の
  // onChange を伴わずに DOM の値だけを埋めることがあり、その後の再描画で
  // React が空の state を DOM に書き戻して入力が消える。
  // （「打った後に消えて打ち直しになる時がある」の原因）
  // 送信時にフォームから直接読めば、この取りこぼしが起きない。
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage(
          "確認メールを送信しました。メール内のリンクを開いて登録を完了してください。",
        );
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        setMessage("ログイン用リンクをメールで送信しました。メールを確認してください。");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* アプリのアイコン（ホーム画面・PWA と同じもの） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="Flow"
            width={80}
            height={80}
            className="mx-auto mb-3 h-20 w-20 rounded-2xl shadow-sm"
          />
          <h1 className="text-3xl font-semibold tracking-tight">Flow</h1>
          <p className="text-sm text-neutral-500 mt-1">
            思いついた瞬間が、いちばんのメモ帳。
          </p>
        </div>

        <div className="flex rounded-lg bg-neutral-200 dark:bg-neutral-800 p-1 mb-5 text-sm">
          <button
            onClick={() => setMode("signin")}
            className={`flex-1 py-1.5 rounded-md transition ${
              mode === "signin" ? "bg-white dark:bg-neutral-950 shadow" : ""
            }`}
          >
            ログイン
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`flex-1 py-1.5 rounded-md transition ${
              mode === "signup" ? "bg-white dark:bg-neutral-950 shadow" : ""
            }`}
          >
            新規登録
          </button>
          <button
            onClick={() => setMode("magic")}
            className={`flex-1 py-1.5 rounded-md transition ${
              mode === "magic" ? "bg-white dark:bg-neutral-950 shadow" : ""
            }`}
          >
            リンク
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            placeholder="メールアドレス"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-400"
          />
          {mode !== "magic" && (
            <input
              type="password"
              name="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="パスワード（6文字以上）"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-400"
            />
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 transition disabled:opacity-50"
          >
            {loading
              ? "処理中…"
              : mode === "signin"
                ? "ログイン"
                : mode === "signup"
                  ? "登録する"
                  : "ログインリンクを送る"}
          </button>
        </form>

        <div className="flex items-center gap-3 my-4 text-xs text-neutral-400">
          <div className="flex-1 h-px bg-neutral-300 dark:bg-neutral-700" />
          または
          <div className="flex-1 h-px bg-neutral-300 dark:bg-neutral-700" />
        </div>

        <button
          onClick={handleGoogle}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 py-2.5 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        >
          Google でログイン
        </button>

        {message && (
          <p className="mt-4 text-sm text-green-600 dark:text-green-400">{message}</p>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </main>
  );
}
