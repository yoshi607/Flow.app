"use client";

import { useEffect, useRef, useState } from "react";
import { IconClose } from "./icons";

// 何秒ごとに区切って文字起こしするか。
// iOS Safari の録音形式(mp4)は「停止するまでファイルとして完成しない」ため、
// 録音途中のデータをそのまま送ることができない。そこで一定間隔で録音を
// 停止→即再開し、完成した断片を順に文字起こしして繋いでいく。
// 短くすると表示は速くなるがAPI呼び出しが増え、区切りで語尾が切れやすくなる。
const SEGMENT_MS = 5000;

type Phase = "recording" | "finishing" | "error";

// 録音バー。録音中は onPartial で「ここまでの文字起こし」を随時通知し、
// 停止後に Claude で整形した結果を onFinal で返す。
export default function VoiceRecorder({
  onPartial,
  onFinal,
  onCancel,
}: {
  onPartial: (text: string) => void;
  onFinal: (r: { title: string; text: string }) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("recording");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopping = useRef(false);
  const mime = useRef("audio/webm");
  // 文字起こしを「送った順」に処理するための直列キュー
  const queue = useRef<Promise<void>>(Promise.resolve());
  const transcript = useRef("");
  // onPartial/onFinal は毎レンダーで変わりうるため ref 経由で最新を呼ぶ
  const cb = useRef({ onPartial, onFinal, onCancel });
  cb.current = { onPartial, onFinal, onCancel };

  function pickMimeType(): string {
    const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported) {
      for (const t of candidates) if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  function extFor(type: string): string {
    if (type.includes("mp4")) return "mp4";
    if (type.includes("ogg")) return "ogg";
    return "webm";
  }

  useEffect(() => {
    start();
    return () => {
      stopping.current = true;
      if (segTimer.current) clearTimeout(segTimer.current);
      if (tickTimer.current) clearInterval(tickTimer.current);
      stopTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = s;
      mime.current = pickMimeType() || "audio/webm";
      startSegment();
      setSeconds(0);
      tickTimer.current = setInterval(() => setSeconds((v) => v + 1), 1000);
    } catch {
      setError("マイクにアクセスできませんでした。ブラウザの許可設定を確認してください。");
      setPhase("error");
    }
  }

  // 1区切り分を録音する。停止したら文字起こしへ回し、次の区切りを始める
  function startSegment() {
    const s = streamRef.current;
    if (!s) return;
    const chosen = mime.current;
    const mr = MediaRecorder.isTypeSupported?.(chosen)
      ? new MediaRecorder(s, { mimeType: chosen })
      : new MediaRecorder(s);
    const chunks: Blob[] = [];

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: mr.mimeType || chosen });
      if (blob.size > 0) enqueue(blob);
      if (stopping.current) finalize();
      else startSegment();
    };

    mr.start();
    recorderRef.current = mr;
    segTimer.current = setTimeout(() => {
      if (mr.state === "recording") mr.stop();
    }, SEGMENT_MS);
  }

  async function transcribeBlob(blob: Blob): Promise<string> {
    const fd = new FormData();
    fd.append("file", blob, `segment.${extFor(mime.current)}`);
    const res = await fetch("/api/transcribe", { method: "POST", body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "文字起こしに失敗しました");
    }
    const { text } = await res.json();
    return (text || "").trim();
  }

  // 区切りを順番に文字起こしして繋ぐ（順序が入れ替わらないよう直列化）
  function enqueue(blob: Blob) {
    queue.current = queue.current
      .then(async () => {
        const text = await transcribeBlob(blob);
        if (!text) return;
        transcript.current = `${transcript.current} ${text}`.trim();
        cb.current.onPartial(transcript.current);
      })
      .catch((e: unknown) => {
        // 1区切り失敗しても録音は続ける。原因は画面に出す
        setError(e instanceof Error ? e.message : "文字起こしに失敗しました");
      });
  }

  function stop() {
    if (stopping.current) return;
    stopping.current = true;
    if (segTimer.current) clearTimeout(segTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    setPhase("finishing");
    const mr = recorderRef.current;
    if (mr && mr.state === "recording") mr.stop(); // → onstop → finalize()
    else finalize();
  }

  // 残りの文字起こしを待ってから Claude で整形して返す
  async function finalize() {
    stopTracks();
    try {
      await queue.current;
    } catch {
      // enqueue 側で握っているためここでは何もしない
    }
    const raw = transcript.current.trim();
    if (!raw) {
      cb.current.onCancel();
      return;
    }

    let title = "";
    let text = raw;
    try {
      const res = await fetch("/api/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      if (res.ok) {
        const j = await res.json();
        title = j.title || "";
        text = j.text || raw;
      }
    } catch {
      // 整形に失敗しても素の文字起こしを使う
    }
    cb.current.onFinal({ title, text });
  }

  function cancel() {
    stopping.current = true;
    if (segTimer.current) clearTimeout(segTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    const mr = recorderRef.current;
    if (mr && mr.state === "recording") {
      mr.onstop = null;
      mr.stop();
    }
    stopTracks();
    cb.current.onCancel();
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;

  if (phase === "error") {
    return (
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-red-200 bg-red-50 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <p className="flex-1 text-sm text-red-700">{error}</p>
          <button
            onClick={cancel}
            className="rounded-lg bg-neutral-200 px-3 py-1.5 text-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-brand-200/60 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        {phase === "recording" ? (
          <>
            <span className="flex h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="font-mono text-sm tabular-nums">{mmss}</span>
            <span className="flex-1 truncate text-sm text-neutral-500">
              録音中… 話した内容がメモに追記されます
            </span>
            <button
              onClick={stop}
              className="flow-press rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white"
            >
              停止
            </button>
            <button
              onClick={cancel}
              title="取り消し"
              className="flow-press rounded-lg p-2 text-neutral-400 hover:bg-brand-100"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-500" />
            <span className="flex-1 text-sm text-neutral-500">
              文章を整えています…
            </span>
          </>
        )}
      </div>
      {error && phase === "recording" && (
        <p className="mx-auto mt-1 max-w-2xl truncate text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
