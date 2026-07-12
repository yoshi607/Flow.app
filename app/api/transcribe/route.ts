import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// 音声ファイルを Groq Whisper で文字起こしする
export async function POST(request: Request) {
  // ログイン必須
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
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
    return NextResponse.json(
      { error: `文字起こしに失敗しました (${res.status})`, detail },
      { status: 502 },
    );
  }

  const data = await res.json();
  return NextResponse.json({ text: data.text ?? "" });
}
