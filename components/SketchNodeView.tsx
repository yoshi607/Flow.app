"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { attachPenInput, type PenHandlers, type PenPoint } from "@/lib/sketch/penInput";
import {
  deserialize,
  drawStroke,
  pushPoint,
  replay,
  serialize,
  strokeNear,
  type Stroke,
} from "@/lib/sketch/strokes";
import { IconTrash } from "./icons";

const PEN_COLORS = ["#1C1C1E", "#007AFF", "#00C7BE", "#FF9500", "#FF2D55", "#AF52DE"];
const PEN_WIDTHS = [2, 4, 8];

// 下端からこの範囲に書いたらブロックを縦に伸ばす（基準幅におけるpx）
const BOTTOM_PAD = 60;
const GROW_PX = 200;
const MAX_H = 3000;
// 消しゴムの半径（基準幅におけるpx）
const ERASER_R = 12;
// iOS Safari は概ね 16.7M px でキャンバスが無効になる
const MAX_CANVAS_AREA = 16_000_000;

// 本文に埋め込む手書きブロック（Apple メモのインラインスケッチ相当）。
// 線データはノードの属性に入り、本文の保存（350msデバウンス）にそのまま乗る。
export default function SketchNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
}: NodeViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [erasing, setErasing] = useState(false);
  // 表示上の幅(CSS px)。幅が変わったら描き直す
  const [cssW, setCssW] = useState(0);

  const refW: number = node.attrs.w || 0;
  const h: number = node.attrs.h || 220;
  const scale = refW > 0 && cssW > 0 ? cssW / refW : 1;

  // 確定済みの線と、今描いている途中の線
  const strokesRef = useRef<Stroke[]>(deserialize(node.attrs.strokes));
  const currentRef = useRef<Stroke | null>(null);
  // 自分が書き込んだ属性値。これと違う値が来たら「外から変えられた」
  // （取り消し・他端末からの同期）とみなして描き直す
  const lastSerialized = useRef<string>(node.attrs.strokes ?? "[]");
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // --- 描き直し ---------------------------------------------------------
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cssW) return;

    const dpr = window.devicePixelRatio || 1;
    const cssH = Math.max(1, h * scale);
    let w = Math.round(cssW * dpr);
    let hh = Math.round(cssH * dpr);
    // iOS の上限を超えないように、超えるなら解像度を落とす
    const area = w * hh;
    if (area > MAX_CANVAS_AREA) {
      const k = Math.sqrt(MAX_CANVAS_AREA / area);
      w = Math.round(w * k);
      hh = Math.round(hh * k);
    }
    canvas.width = w;
    canvas.height = hh;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 実ピクセル/CSSピクセルの比（上でクランプした場合はdprと一致しない）
    ctx.setTransform(w / cssW, 0, 0, w / cssW, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    replay(ctx, strokesRef.current, scale);
    if (currentRef.current) drawStroke(ctx, currentRef.current, scale);
  }, [cssW, h, scale]);

  // 幅の変化に追従（ウィンドウのリサイズ・全画面切替・回転）
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setCssW(el.clientWidth);
    const ro = new ResizeObserver(() => setCssW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 基準幅がまだ無ければ、最初に測れた幅を基準にする
  useEffect(() => {
    if (!refW && cssW > 0) updateAttributes({ w: cssW });
  }, [refW, cssW, updateAttributes]);

  // 幅・高さが変わったら描き直す
  useEffect(() => {
    redraw();
  }, [redraw]);

  // 外から線が変わったとき（取り消し・他端末からの同期）だけ取り込む
  useEffect(() => {
    const s: string = node.attrs.strokes ?? "[]";
    if (s === lastSerialized.current) return;
    lastSerialized.current = s;
    strokesRef.current = deserialize(s);
    currentRef.current = null;
    redraw();
  }, [node.attrs.strokes, redraw]);

  // --- 保存 -------------------------------------------------------------
  const commit = useCallback(() => {
    const s = serialize(strokesRef.current);
    // 何も変わっていないなら本文を触らない（消しゴムの空振り等）
    if (s === lastSerialized.current) return;
    lastSerialized.current = s;
    updateAttributes({ strokes: s });
  }, [updateAttributes]);

  // --- 入力 -------------------------------------------------------------
  // CSS px → 基準幅における px
  const toRef = (p: PenPoint) => ({
    x: p.x / scaleRef.current,
    y: p.y / scaleRef.current,
    pressure: p.pressure,
  });

  const eraseAt = useCallback((x: number, y: number) => {
    const before = strokesRef.current.length;
    strokesRef.current = strokesRef.current.filter(
      (s) => !strokeNear(s, x, y, ERASER_R),
    );
    return strokesRef.current.length !== before;
  }, []);

  // 下まで書いたらブロックを伸ばす
  const growIfNeeded = useCallback(
    (y: number) => {
      if (y < h - BOTTOM_PAD) return;
      const next = Math.min(MAX_H, h + GROW_PX);
      if (next !== h) updateAttributes({ h: next });
    },
    [h, updateAttributes],
  );

  const handlers = useRef<PenHandlers>({
    penOnly: true,
    onStrokeStart: () => {},
    onStrokeMove: () => {},
    onStrokeEnd: () => {},
  });

  handlers.current = {
    // 指はスクロールに使う。マウス/ペンは描く
    penOnly: true,
    onStrokeStart: (raw) => {
      const p = toRef(raw);
      if (erasing) {
        if (eraseAt(p.x, p.y)) redraw();
        return;
      }
      const s: Stroke = { c: color, w: width, p: [] };
      pushPoint(s, p.x, p.y, p.pressure);
      currentRef.current = s;
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawStroke(ctx, s, scaleRef.current);
      growIfNeeded(p.y);
    },
    onStrokeMove: (raws) => {
      if (erasing) {
        let changed = false;
        for (const raw of raws) {
          const p = toRef(raw);
          if (eraseAt(p.x, p.y)) changed = true;
        }
        if (changed) redraw();
        return;
      }
      const s = currentRef.current;
      if (!s) return;
      const ctx = canvasRef.current?.getContext("2d");
      let last: number | null = null;
      for (const raw of raws) {
        const p = toRef(raw);
        const n = s.p.length;
        if (!pushPoint(s, p.x, p.y, p.pressure)) continue;
        if (ctx && n >= 3) {
          // 足した1区間だけを描き足す（毎回の全描き直しは避ける）
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = s.c;
          ctx.lineWidth = s.w * (0.5 + p.pressure) * scaleRef.current;
          ctx.beginPath();
          ctx.moveTo(s.p[n - 3] * scaleRef.current, s.p[n - 2] * scaleRef.current);
          ctx.lineTo(p.x * scaleRef.current, p.y * scaleRef.current);
          ctx.stroke();
        }
        last = p.y;
      }
      if (last !== null) growIfNeeded(last);
    },
    onStrokeEnd: () => {
      if (erasing) {
        commit();
        return;
      }
      const s = currentRef.current;
      currentRef.current = null;
      if (!s || s.p.length === 0) return;
      strokesRef.current = [...strokesRef.current, s];
      commit();
    },
  };

  // 入力の購読はマウント時に1回だけ（実処理は上の handlers.current を読む）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!editor.isEditable) return;
    // 本文のスクロール領域（.ProseMirror）を指スクロールの対象にする
    const scroller = canvas.closest(".ProseMirror") as HTMLElement | null;
    return attachPenInput(canvas, handlers, { scroller, viewport: scroller });
  }, [editor]);

  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      as="div"
      data-type="sketch"
      className="flow-sketch flow-draw-overlay"
      contentEditable={false}
    >
      {editable && (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setColor(c);
                  setErasing(false);
                }}
                className={`h-5 w-5 shrink-0 rounded-full ring-offset-2 transition dark:ring-offset-neutral-950 ${
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
                type="button"
                onClick={() => {
                  setWidth(w);
                  setErasing(false);
                }}
                className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
                  !erasing && width === w
                    ? "bg-white shadow-sm dark:bg-neutral-950"
                    : "text-neutral-500"
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
            type="button"
            onClick={() => setErasing((v) => !v)}
            className={`rounded-lg px-2 py-1 text-xs transition ${
              erasing
                ? "bg-brand-200 text-brand-700 dark:bg-neutral-700 dark:text-neutral-100"
                : "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
            }`}
            title="なぞった線を消します"
          >
            消しゴム
          </button>

          <div className="flex-1" />
          <button
            type="button"
            onClick={() => deleteNode()}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            title="この手書きを削除"
            aria-label="この手書きを削除"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      )}

      <div ref={boxRef} className="relative w-full" style={{ height: h * scale }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: "none" }}
        />
      </div>
    </NodeViewWrapper>
  );
}
