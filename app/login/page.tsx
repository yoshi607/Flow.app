"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { passwordIssue } from "@/lib/passwordPolicy";

type Mode = "signin" | "signup" | "magic" | "reset";

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
        const issue = passwordIssue(password);
        if (issue) {
          setError(issue);
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage(
          "確認メールを送信しました。メール内のリンクを開いて登録を完了してください。",
        );
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) throw error;
        setMessage(
          "パスワード再設定用のリンクをメールで送信しました。メールのリンクを開いて新しいパスワードを設定してください。",
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
      setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  // Supabase の認証エラーを原因が分かる形にする。
  // メール送信に失敗すると message が空（"{}" に見える）ことがあるため、
  // code / status も添え、送信系は具体的な当たりを付けられる文言にする。
  function describeAuthError(err: unknown): string {
    const e = err as { message?: string; status?: number; code?: string } | null;
    console.error("auth error:", err);
    const msg = (e?.message ?? "").trim();
    const meaningless = !msg || msg === "{}" || msg === "[object Object]";

    if (meaningless || /error sending/i.test(msg)) {
      const detail = [e?.code && `code=${e.code}`, e?.status && `status=${e.status}`]
        .filter(Boolean)
        .join(" / ");
      return (
        "メールの送信に失敗しました。SMTP設定（送信元アドレス・APIキー）や、" +
        "送信先が許可されたアドレスかを確認してください。" +
        (detail ? `（${detail}）` : "")
      );
    }

    const parts = [msg];
    if (e?.code) parts.push(`code=${e.code}`);
    if (e?.status) parts.push(`status=${e.status}`);
    return parts.join(" / ");
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

        <div className="flex rounded-lg bg-neutral-200 p-1 mb-5 text-sm">
          <button
            onClick={() => setMode("signin")}
            className={`flex-1 py-1.5 rounded-md transition ${
              mode === "signin" ? "bg-white shadow" : ""
            }`}
          >
            ログイン
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`flex-1 py-1.5 rounded-md transition ${
              mode === "signup" ? "bg-white shadow" : ""
            }`}
          >
            新規登録
          </button>
          <button
            onClick={() => setMode("magic")}
            className={`flex-1 py-1.5 rounded-md transition ${
              mode === "magic" ? "bg-white shadow" : ""
            }`}
          >
            リンク
          </button>
        </div>

        {mode === "reset" && (
          <p className="mb-3 text-sm text-neutral-500">
            登録したメールアドレスに、パスワード再設定用のリンクを送ります。
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            placeholder="メールアドレス"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-400"
          />
          {mode !== "magic" && mode !== "reset" && (
            <>
              <input
                type="password"
                name="password"
                required
                minLength={mode === "signup" ? 10 : 6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={
                  mode === "signup" ? "パスワード（10文字以上）" : "パスワード"
                }
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-400"
              />
              {mode === "signup" && (
                <p className="text-xs text-neutral-400">
                  10文字以上。英小文字・英大文字・数字・記号のうち3種類以上を含めてください。
                </p>
              )}
            </>
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
                  : mode === "reset"
                    ? "再設定リンクを送る"
                    : "ログインリンクを送る"}
          </button>
        </form>

        {mode === "signin" && (
          <button
            onClick={() => {
              setMode("reset");
              setError(null);
              setMessage(null);
            }}
            className="mt-3 w-full text-center text-sm text-brand-600 hover:underline"
          >
            パスワードをお忘れですか？
          </button>
        )}
        {mode === "reset" && (
          <button
            onClick={() => {
              setMode("signin");
              setError(null);
              setMessage(null);
            }}
            className="mt-3 w-full text-center text-sm text-neutral-500 hover:underline"
          >
            ← ログインへ戻る
          </button>
        )}

        <div className="flex items-center gap-3 my-4 text-xs text-neutral-400">
          <div className="flex-1 h-px bg-neutral-300" />
          または
          <div className="flex-1 h-px bg-neutral-300" />
        </div>

        <button
          onClick={handleGoogle}
          className="w-full rounded-lg border border-neutral-300 py-2.5 font-medium hover:bg-neutral-100 transition"
        >
          Google でログイン
        </button>

        {message && (
          <p className="mt-4 text-sm text-green-600">{message}</p>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </div>
    </main>
  );
}
