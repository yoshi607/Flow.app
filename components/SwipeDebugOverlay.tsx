"use client";

// ===================================================================
// 【一時的な調査用コード】スワイプ計測結果の画面表示
//
// iPad では Safari の DevTools（console）が使えないため、計測結果を画面に出す。
// 裏付けが取れたら lib/swipeDebug.ts ごと削除すること（手順はそちらに記載）。
// ===================================================================

import { useState, useSyncExternalStore } from "react";
import {
  WHEEL_DEBUG,
  subscribeSwipeDebug,
  getSwipeDebugSnapshot,
  getSwipeDebugServerSnapshot,
  clearSwipeDebug,
  buildSwipeDebugText,
  type GestureReport,
} from "@/lib/swipeDebug";

/** 検出あり=赤、なし=緑。ひと目で分かるようにする。 */
function Badge({ label, n }: { label: string; n: number }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
        n > 0 ? "bg-red-500 text-white" : "bg-neutral-200 text-neutral-500"
      }`}
    >
      {label}
      {n > 0 ? ` ${n}` : " —"}
    </span>
  );
}

function ReportCard({ rep }: { rep: GestureReport }) {
  const hit =
    rep.staleBase + rep.pinnedAtZero + rep.staleVelocity + rep.engagedDropout;
  return (
    <div
      className={`rounded-lg border p-2 text-[11px] leading-tight ${
        hit > 0 ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white"
      }`}
    >
      <div className="mb-1 font-bold text-neutral-700">
        #{rep.id} {rep.reason}
        <span className="ml-1 font-normal text-neutral-400">
          {rep.durationMs}ms / wheel{rep.wheelCount} frame{rep.frameCount}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge label="原因1 古い基準" n={rep.staleBase} />
        <Badge label="原因1 0張付き" n={rep.pinnedAtZero} />
        <Badge label="原因2 速度陳腐化" n={rep.staleVelocity} />
        <Badge label="原因3 脱落" n={rep.engagedDropout} />
      </div>
      {rep.worstStaleVel && (
        <div className="mt-1 text-red-700">
          停止から {rep.worstStaleVel.age}ms 後に v={rep.worstStaleVel.v}
          （0.3超でフリック判定）
        </div>
      )}
      <div className="mt-1 text-neutral-500">
        フレーム間隔 最大 {rep.maxFrameGap}ms / wheel間隔 最大 {rep.maxEventGap}ms
      </div>
    </div>
  );
}

export default function SwipeDebugOverlay() {
  const reports = useSyncExternalStore(
    subscribeSwipeDebug,
    getSwipeDebugSnapshot,
    getSwipeDebugServerSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  // クリップボードが使えない場合に、手で選択してコピーしてもらうための退避先。
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  if (!WHEEL_DEBUG) return null;

  async function copy() {
    const text = buildSwipeDebugText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied("コピーしました");
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // iPad で権限が下りない場合は、選択できる状態で画面に出す。
      setFallbackText(text);
    }
  }

  const latest = reports[0];

  return (
    <div className="fixed bottom-2 left-2 z-[9999] max-w-[min(92vw,420px)] font-mono">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white/95 px-3 py-1.5 text-[11px] font-bold shadow-lg backdrop-blur"
        >
          計測 {reports.length}
          {latest && (
            <>
              <Badge label="1" n={latest.staleBase + latest.pinnedAtZero} />
              <Badge label="2" n={latest.staleVelocity} />
              <Badge label="3" n={latest.engagedDropout} />
            </>
          )}
        </button>
      ) : (
        <div className="flex max-h-[70vh] flex-col rounded-xl border border-neutral-300 bg-white/97 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-1.5 border-b border-neutral-200 p-2">
            <span className="mr-auto text-[11px] font-bold">
              スワイプ計測（新しい順）
            </span>
            <button
              onClick={copy}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-bold text-white"
            >
              {copied || "コピー"}
            </button>
            <button
              onClick={() => {
                clearSwipeDebug();
                setFallbackText(null);
              }}
              className="rounded bg-neutral-200 px-2 py-1 text-[11px] font-bold"
            >
              クリア
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded bg-neutral-200 px-2 py-1 text-[11px] font-bold"
            >
              閉じる
            </button>
          </div>

          {fallbackText !== null ? (
            <div className="flex min-h-0 flex-1 flex-col p-2">
              <p className="mb-1 text-[11px] text-neutral-600">
                自動コピーができませんでした。下のテキストを全選択してコピーしてください。
              </p>
              <textarea
                readOnly
                value={fallbackText}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-0 flex-1 rounded border border-neutral-300 p-1 text-[10px]"
                rows={12}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
              {reports.length === 0 ? (
                <p className="p-2 text-[11px] text-neutral-500">
                  メモの行を横にスワイプすると、1操作ごとに結果が出ます。
                </p>
              ) : (
                reports.map((rep) => <ReportCard key={rep.id} rep={rep} />)
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
