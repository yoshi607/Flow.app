"use client";

import { useEffect, useRef, useState } from "react";
import { IconClose } from "./icons";

// ペンの色（本文の文字色と揃える）と黒
const PEN_COLORS = ["#1C1C1E", "#007AFF", "#00C7BE", "#FF9500", "#FF2D55", "#AF52DE"];
const PEN_WIDTHS = [2, 4, 8];

// 手書きメモ（①）。Apple Pencil を想定した描画キャンバス。
// Apple 純正メモのように、ペンで書いた軌跡をそのまま描画する。
// 保存すると PNG 画像を生成して onSave に渡す（呼び出し側で添付として保存）。
//
// - 指では描かず、ペン（pointerType==="pen"）を優先（手のひら誤爆を防ぐ）。
//   ただしペンが一度も使われていない間はマウス/指でも描ける。
// - Apple Pencil の筆圧（e.pressure）で線の太さを微妙に変える。
export default function HandwritingCanvas({
  onSave,
  onClose,
}: {
  onSave: (blob: Blob) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const penSeen = useRef(false);
  const dirty = useRef(false);

  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [erasing, setErasing] = useState(false);
  // 既定は「ペンのみ描画」。手のひらや指（touch）では描かず誤作動を防ぐ。
  // Apple Pencil を持っていない場合はトグルで指描きに切り替え可能。
  const [penOnly, setPenOnly] = useState(true);

  // キャンバスをコンテナサイズ×DPRで用意（にじみ防止）。既存の描画は保持しない。
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
  }, []);

  function pointFromEvent(e: React.PointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function shouldDraw(e: React.PointerEvent) {
    if (e.pointerType === "pen") {
      penSeen.current = true;
      return true;
    }
    if (e.pointerType === "mouse") return true; // PCでの確認用
    // touch（指・手のひら）:
    //  - ペンのみモード（既定）では一切描かない＝手のひら誤爆を完全に防ぐ
    //  - ペンが一度でも使われたら、以後 touch は無視
    if (penOnly) return false;
    if (penSeen.current) return false;
    return true;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!shouldDraw(e)) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = pointFromEvent(e);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawing.current || !shouldDraw(e)) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    const p = pointFromEvent(e);
    if (!ctx || !last.current) {
      last.current = p;
      return;
    }
    // 筆圧があれば太さに反映（0.5〜1.5倍）
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    ctx.lineWidth = width * (0.5 + pressure);
    if (erasing) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = width * 4;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    dirty.current = true;
  }

  function onPointerUp() {
    drawing.current = false;
    last.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    dirty.current = false;
  }

  function save() {
    if (!dirty.current) {
      onClose();
      return;
    }
    // 透過だと本文で見えにくいので白背景に合成して書き出す
    const src = canvasRef.current!;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const octx = out.getContext("2d")!;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(src, 0, 0);
    out.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  }

  return (
    <div className="flow-draw-overlay fixed inset-0 z-50 flex select-none flex-col bg-white dark:bg-neutral-950">
      {/* ツールバー */}
      <div className="safe-top flex flex-wrap items-center gap-3 border-b border-brand-200/60 px-3 py-2 dark:border-neutral-800">
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
          title="閉じる"
        >
          <IconClose />
        </button>
        <span className="text-sm font-semibold">手書き</span>

        <div className="flex items-center gap-1.5">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                setErasing(false);
              }}
              className={`h-6 w-6 shrink-0 rounded-full ring-offset-2 transition dark:ring-offset-neutral-950 ${
                !erasing && color === c ? "ring-2 ring-neutral-400" : ""
              }`}
              style={{ backgroundColor: c }}
              title="ペンの色"
            />
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-brand-100 p-0.5 dark:bg-neutral-800">
          {PEN_WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => {
                setWidth(w);
                setErasing(false);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                !erasing && width === w ? "bg-white shadow-sm dark:bg-neutral-950" : "text-neutral-500"
              }`}
              title={`太さ ${w}`}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: w + 2, height: w + 2 }}
              />
            </button>
          ))}
        </div>

        <button
          onClick={() => setErasing((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-sm transition ${
            erasing
              ? "bg-brand-200 text-brand-700 dark:bg-neutral-700 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
          }`}
        >
          消しゴム
        </button>
        <button
          onClick={clearCanvas}
          className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
        >
          全消去
        </button>
        {/* ペンのみ / 指でも描く の切替（既定はペンのみ＝手のひら誤作動防止） */}
        <button
          onClick={() => setPenOnly((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-sm transition ${
            penOnly
              ? "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
              : "bg-brand-200 text-brand-700 dark:bg-neutral-700 dark:text-neutral-100"
          }`}
          title="ペンを持っていない場合は指でも描けます"
        >
          {penOnly ? "ペンのみ" : "指でも描く"}
        </button>

        <div className="flex-1" />
        <button
          onClick={save}
          className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          保存
        </button>
      </div>

      {/* 描画エリア */}
      <div ref={wrapRef} className="relative flex-1 touch-none bg-white">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
