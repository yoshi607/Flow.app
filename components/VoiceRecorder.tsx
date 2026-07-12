"use client";

import { useEffect, useRef, useState } from "react";
import { IconMic, IconClose } from "./icons";

type Phase = "idle" | "recording" | "transcribing" | "formatting" | "error";

export default function VoiceRecorder({
  onResult,
  onClose,
}: {
  onResult: (r: { title: string; text: string }) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeType = useRef<string>("audio/webm");

  // ブラウザが対応する録音形式を選ぶ（iOS Safari は mp4 になる）
  function pickMimeType(): string {
    const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported) {
      for (const t of candidates) {
        if (MediaRecorder.isTypeSupported(t)) return t;
      }
    }
    return "";
  }

  function extFor(type: string): string {
    if (type.includes("mp4")) return "mp4";
    if (type.includes("ogg")) return "ogg";
    return "webm";
  }

  useEffect(() => {
    // マウント時に自動で録音開始
    start();
    return () => {
      stopTracks();
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTracks() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function start() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      chunks.current = [];
      const chosen = pickMimeType();
      const mr = chosen ? new MediaRecorder(s, { mimeType: chosen }) : new MediaRecorder(s);
      mimeType.current = mr.mimeType || chosen || "audio/webm";
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      mr.onstop = handleStop;
      mr.start();
      mediaRecorder.current = mr;
      setPhase("recording");
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("マイクにアクセスできませんでした。ブラウザの許可設定を確認してください。");
      setPhase("error");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    mediaRecorder.current?.stop();
    stopTracks();
  }

  async function handleStop() {
    const type = mimeType.current || "audio/webm";
    const blob = new Blob(chunks.current, { type });
    if (blob.size === 0) {
      setError("録音データがありません。");
      setPhase("error");
      return;
    }
    try {
      // 1) 文字起こし（Groq Whisper）
      setPhase("transcribing");
      const fd = new FormData();
      fd.append("file", blob, `recording.${extFor(type)}`);
      const tRes = await fetch("/api/transcribe", { method: "POST", body: fd });
      if (!tRes.ok) {
        const j = await tRes.json().catch(() => ({}));
        throw new Error(j.error || "文字起こしに失敗しました");
      }
      const { text: rawText } = await tRes.json();
      if (!rawText || !rawText.trim()) {
        throw new Error("音声を認識できませんでした。もう一度お試しください。");
      }

      // 2) 整形・タイトル生成（Claude）。失敗しても素の文字起こしを使う
      setPhase("formatting");
      let title = "";
      let text = rawText.trim();
      try {
        const fRes = await fetch("/api/format", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: rawText }),
        });
        if (fRes.ok) {
          const j = await fRes.json();
          title = j.title || "";
          text = j.text || text;
        }
      } catch {
        // 整形失敗時はそのまま
      }

      onResult({ title, text });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "処理に失敗しました");
      setPhase("error");
    }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-6 pb-8 shadow-xl safe-bottom dark:bg-neutral-900 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold">音声メモ</h3>
          <button
            onClick={() => {
              stop();
              onClose();
            }}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconClose />
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 py-4">
          {phase === "recording" && (
            <>
              <div className="relative">
                <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-60" />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-red-500 text-white">
                  <IconMic className="h-8 w-8" />
                </div>
              </div>
              <p className="font-mono text-2xl tabular-nums">{mmss}</p>
              <button
                onClick={stop}
                className="rounded-full bg-neutral-900 px-8 py-3 font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
              >
                停止して文字起こし
              </button>
            </>
          )}

          {(phase === "transcribing" || phase === "formatting") && (
            <>
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-brand-500" />
              <p className="text-sm text-neutral-500">
                {phase === "transcribing" ? "文字起こし中…" : "文章を整えています…"}
              </p>
            </>
          )}

          {phase === "error" && (
            <>
              <p className="text-center text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={start}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  もう一度録音
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg bg-neutral-200 px-4 py-2 text-sm dark:bg-neutral-700"
                >
                  閉じる
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
