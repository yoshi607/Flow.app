import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const runtime = "nodejs";
export const maxDuration = 60;

// 音声ファイルを Groq Whisper で文字起こしする
export async function POST(request: Request) {
  // ログイン必須。ミドルウェアが検証済みユーザーを x-user-id ヘッダーで渡すので
  // それを信頼する（Route Handler 内での getUser() はトークン更新時に
  // Cookie の食い違いで 401 になることがあるため、ページと同じ方式に統一）。
  const userId = headers().get("x-user-id");
  if (!userId) {
    return NextResponse.json(
      { error: "アプリの認証エラー：ログインし直してください" },
      { status: 401 },
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY が設定されていません（.env.local を確認してください）" },
      { status: 500 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "音声ファイルがありません" }, { status: 400 });
  }

  // Groq の Whisper エンドポイントへ転送（拡張子は元ファイル名を引き継ぐ）
  const filename =
    file instanceof File && file.name ? file.name : "recording.webm";
  const groqForm = new FormData();
  groqForm.append("file", file, filename);
  groqForm.append("model", "whisper-large-v3");
  groqForm.append("language", "ja");
  groqForm.append("response_format", "json");

  const res = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Groq がキーを拒否した場合。アプリ側の認証エラー(401)と紛らわしいので
    // 「どちらの 401 か」がひと目で分かる文言にする。
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        {
          error:
            "Groqに拒否されました：GROQ_API_KEY が無効か期限切れです。" +
            "Vercelの環境変数を確認し、再デプロイしてください。",
          detail,
        },
        { status: 502 },
      );
    }
    if (res.status === 429) {
      return NextResponse.json(
        { error: "Groqの利用上限に達しました。しばらく待って再試行してください。", detail },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: `文字起こしに失敗しました (Groq: ${res.status})`, detail },
      { status: 502 },
    );
  }

  const data = await res.json();
  return NextResponse.json({ text: data.text ?? "" });
}
