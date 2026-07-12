import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// 文字起こしテキストを Claude で整形し、タイトルを自動生成する
export async function POST(request: Request) {
  // ログイン必須
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY が設定されていません" },
      { status: 500 },
    );
  }

  const { text } = await request.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "テキストがありません" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const system =
    "あなたは音声メモの文字起こしを、読みやすいメモに整える編集者です。\n" +
    "入力された文字起こしテキストに対して、次を行ってください：\n" +
    "1) 誤変換や言い間違いを文脈から自然に修正する。\n" +
    "2) フィラー（えー、あのー等）や不要な繰り返しを削除する。\n" +
    "3) 適切に句読点・改行を入れて読みやすくする。\n" +
    "4) 内容は要約せず、話した情報は保持する。\n" +
    "5) 内容を表す簡潔な日本語タイトル（20文字程度まで）を付ける。\n" +
    "元の言語（日本語）を保ってください。\n\n" +
    '出力は必ず次の形式の JSON のみとし、前後に説明文やコードフェンスを付けないでください：\n' +
    '{"title": "タイトル", "text": "整えた本文"}';

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [
        {
          role: "user",
          content: `次の文字起こしを整えてください：\n\n${text}`,
        },
      ],
    });

    const raw = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    // コードフェンスや前後の余分な文字を除いて JSON 部分を取り出す
    const parsed = safeParse(raw);
    if (parsed) {
      return NextResponse.json({
        title: parsed.title ?? "",
        text: parsed.text ?? text,
      });
    }
    // 万一 JSON でなければ、生成テキストを本文として返す
    return NextResponse.json({ title: "", text: raw || text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "整形に失敗しました";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function safeParse(s: string): { title?: string; text?: string } | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (obj && typeof obj === "object") return obj as { title?: string; text?: string };
    return null;
  } catch {
    return null;
  }
}
