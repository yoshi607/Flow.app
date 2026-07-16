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
import { IconEraser, IconRedo, IconTrash, IconUndo } from "./icons";

// 色・太さの選択ポップアップ（本文のツールバーと同じ作りに揃えている）
function Popover({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* flow-menu-in は右上を起点にするので、左寄せのこちらは起点を合わせ直す */}
      <div
        data-sketch-ui
        style={{ transformOrigin: "top left" }}
        className="flow-menu-in absolute left-0 top-full z-50 mt-1 flex items-center gap-2 rounded-xl border border-brand-200/60 bg-white p-2 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        {children}
      </div>
    </>
  );
}

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
  extension,
  getPos,
}: NodeViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 本文が編集可能か。editor.isEditable は描画中に false になるので使えない
  const editable: boolean = extension.options.editable !== false;
  // 描画モード中か（本文には保存されない一時的な状態）
  const drawing: boolean = node.attrs.drawing === true;

  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [erasing, setErasing] = useState(false);
  // 開いている選択ポップアップ
  const [openMenu, setOpenMenu] = useState<"color" | "width" | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
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

  // ブロック内の戻す/送る履歴（線の状態のスナップショット列）。
  // 描画中はエディタ全体が編集不可で本文のCmd+Zが使えないため、
  // ブロック内で完結する履歴を持つ。描画・消しゴムを同じ仕組みで戻せる。
  const historyRef = useRef<string[]>([node.attrs.strokes ?? "[]"]);
  const histIndexRef = useRef(0);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const syncHist = useCallback(() => {
    setHist({
      canUndo: histIndexRef.current > 0,
      canRedo: histIndexRef.current < historyRef.current.length - 1,
    });
  }, []);
  // 履歴の上限（メモリの暴走を防ぐ）
  const HISTORY_MAX = 50;

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
  // 線を1本引いた／消したときに呼ぶ。本文へ保存し、履歴にも積む。
  const commit = useCallback(() => {
    const s = serialize(strokesRef.current);
    // 何も変わっていないなら本文を触らない（消しゴムの空振り等）
    if (s === lastSerialized.current) return;
    lastSerialized.current = s;
    updateAttributes({ strokes: s });

    // 戻す途中で新しく描いたら、それ以降の送る履歴は捨てる
    const cut = historyRef.current.slice(0, histIndexRef.current + 1);
    cut.push(s);
    if (cut.length > HISTORY_MAX) cut.shift();
    historyRef.current = cut;
    histIndexRef.current = cut.length - 1;
    syncHist();
  }, [updateAttributes, syncHist]);

  // 履歴の任意の地点を表示に反映する（戻す/送る共通）
  const applySnapshot = useCallback(
    (s: string) => {
      lastSerialized.current = s;
      strokesRef.current = deserialize(s);
      currentRef.current = null;
      updateAttributes({ strokes: s });
      redraw();
      syncHist();
    },
    [updateAttributes, redraw, syncHist],
  );

  const undo = useCallback(() => {
    setOpenMenu(null);
    if (histIndexRef.current <= 0) return;
    histIndexRef.current -= 1;
    applySnapshot(historyRef.current[histIndexRef.current]);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    setOpenMenu(null);
    if (histIndexRef.current >= historyRef.current.length - 1) return;
    histIndexRef.current += 1;
    applySnapshot(historyRef.current[histIndexRef.current]);
  }, [applySnapshot]);

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

  // --- 描画モード -------------------------------------------------------
  // 【重要】iPadOS の「スクリブル」は、Apple Pencil の手書きをテキスト入力として
  // 認識し、一番近い編集可能な場所へ挿入する。キャンバス側に
  // contenteditable="false" を付けても、スクリブルは近くの編集可能な場所を
  // 探して吸い付くため防げない（実機で確認：認識結果がブロックの下の段落に
  // 入ってしまう）。エディタ自体を編集不可にするのが唯一の確実な方法。
  useEffect(() => {
    if (!editable || !drawing) return;
    editor.setEditable(false, false); // 第2引数 false: 余計な保存を走らせない

    // 編集不可にするだけでは足りない。iOS は「文字入力セッション」＝フォーカスと
    // キャレットが残っているとそこへスクリブルの認識結果を書き込んでしまうため、
    // 明示的に外す。
    const dom = editor.view.dom as HTMLElement;
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active === dom || dom.contains(active))) {
      active.blur();
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && dom.contains(sel.anchorNode)) {
      sel.removeAllRanges();
    }

    return () => {
      // 描画中にメモを切り替えるとエディタごと破棄される
      if (!editor.isDestroyed) editor.setEditable(true, false);
    };
  }, [drawing, editable, editor]);

  // 描画モードに入る。他の手書きブロックは描画モードから抜けさせる
  const enterDraw = useCallback(() => {
    const myPos = typeof getPos === "function" ? getPos() : null;
    editor.commands.command(({ tr, state }) => {
      state.doc.descendants((n, p) => {
        if (n.type.name !== "sketch") return true;
        const on = myPos !== null && p === myPos;
        if (n.attrs.drawing !== on) {
          tr.setNodeMarkup(p, undefined, { ...n.attrs, drawing: on });
        }
        return false;
      });
      return true;
    });
  }, [editor, getPos]);

  const exitDraw = useCallback(() => {
    setOpenMenu(null);
    updateAttributes({ drawing: false });
  }, [updateAttributes]);

  // 描いた内容ごと消えるので確認する
  const confirmDelete = useCallback(() => {
    if (!window.confirm("この手書きを削除しますか？（元に戻せません）")) return;
    deleteNode();
  }, [deleteNode]);

  // 入力の購読は描画モードの間だけ（実処理は上の handlers.current を読む）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !editable || !drawing) return;
    // 本文のスクロール領域（.ProseMirror）を指スクロールの対象にする
    const scroller = canvas.closest(".ProseMirror") as HTMLElement | null;
    return attachPenInput(canvas, handlers, { scroller, viewport: scroller });
  }, [editable, drawing]);

  return (
    <NodeViewWrapper
      as="div"
      data-type="sketch"
      data-drawing={drawing ? "true" : undefined}
      className="flow-sketch flow-draw-overlay"
      contentEditable={false}
    >
      {editable && !drawing && (
        <div className="flex items-center gap-2 px-2 py-1.5">
          {/* 「描く」「完了」は押し間違えないよう他より一回り大きくする */}
          <button
            type="button"
            onClick={enterDraw}
            className="flow-press rounded-lg bg-brand-100 px-4 py-1.5 text-sm font-medium text-brand-700 dark:bg-neutral-800 dark:text-neutral-100"
            title="ペンで書き込みます（この間は文字入力を止めます）"
          >
            描く
          </button>
          <span className="text-xs text-neutral-400">
            {strokesRef.current.length > 0 ? "" : "「描く」を押すと手書きできます"}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={confirmDelete}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            title="この手書きを削除"
            aria-label="この手書きを削除"
          >
            <IconTrash className="h-5 w-5" />
          </button>
        </div>
      )}

      {editable && drawing && (
        <div
          data-sketch-ui
          className="flex flex-wrap items-center gap-2 px-2 py-1.5"
          // 【重要】ツールバーのボタンにフォーカスを移させない。
          // ボタンにフォーカスが残ると iPadOS のスクリブルの標的になり、
          // 続けてキャンバスに書いた手書きが文字認識されてしまう。
          // フォーカスを奪わなければ、その後の手書きも正しく描画になる。
          // また、これによりペンでもボタンを押せる（スクリブルに横取り
          // されなくなる）。onMouseDown は container で一括して止められる
          // （フォーカスは default action なので bubbling 中の preventDefault で防げる）。
          onMouseDown={(e) => e.preventDefault()}
          // ペンがマウス互換イベントを出さない場合の保険：タップ後に念のため外す
          onClick={() => {
            const a = document.activeElement as HTMLElement | null;
            if (a && a.tagName === "BUTTON") a.blur();
          }}
        >
          {/* 色（1つのボタンにまとめ、タップで色選択） */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((v) => (v === "color" ? null : "color"))}
              title="ペンの色"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                openMenu === "color"
                  ? "bg-brand-200 dark:bg-neutral-700"
                  : "hover:bg-brand-100 dark:hover:bg-neutral-800"
              }`}
            >
              <span
                className="h-5 w-5 rounded-full border-2 border-black/30 dark:border-white/40"
                style={{ backgroundColor: color }}
              />
            </button>
            {openMenu === "color" && (
              <Popover onClose={closeMenu}>
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setColor(c);
                      setErasing(false);
                      closeMenu();
                    }}
                    title="ペンの色"
                    className={`h-6 w-6 shrink-0 rounded-full ring-offset-2 transition dark:ring-offset-neutral-900 ${
                      color === c ? "ring-2 ring-neutral-400" : ""
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </Popover>
            )}
          </div>

          {/* 太さ（1つのボタンにまとめ、タップで太さ選択） */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((v) => (v === "width" ? null : "width"))}
              title="線の太さ"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                openMenu === "width"
                  ? "bg-brand-200 dark:bg-neutral-700"
                  : "hover:bg-brand-100 dark:hover:bg-neutral-800"
              }`}
            >
              <span
                className="rounded-full bg-current text-neutral-600 dark:text-neutral-300"
                style={{ width: width + 3, height: width + 3 }}
              />
            </button>
            {openMenu === "width" && (
              <Popover onClose={closeMenu}>
                {PEN_WIDTHS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => {
                      setWidth(w);
                      setErasing(false);
                      closeMenu();
                    }}
                    title={`太さ ${w}`}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                      width === w
                        ? "bg-brand-200 dark:bg-neutral-700"
                        : "hover:bg-brand-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    <span
                      className="rounded-full bg-current text-neutral-600 dark:text-neutral-300"
                      style={{ width: w + 3, height: w + 3 }}
                    />
                  </button>
                ))}
              </Popover>
            )}
          </div>

          {/* 消しゴム（なぞった線を消す） */}
          <button
            type="button"
            onClick={() => {
              setErasing((v) => !v);
              closeMenu();
            }}
            title="なぞった線を消します"
            aria-label="消しゴム"
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
              erasing
                ? "bg-brand-200 text-brand-700 dark:bg-neutral-700 dark:text-neutral-100"
                : "text-neutral-500 hover:bg-brand-100 dark:hover:bg-neutral-800"
            }`}
          >
            <IconEraser className="h-5 w-5" />
          </button>

          {/* 1つ戻す / 1つ送る */}
          <button
            type="button"
            onClick={undo}
            disabled={!hist.canUndo}
            title="1つ戻す"
            aria-label="1つ戻す"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-brand-100 disabled:opacity-30 dark:hover:bg-neutral-800"
          >
            <IconUndo className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!hist.canRedo}
            title="1つ送る"
            aria-label="1つ送る"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-brand-100 disabled:opacity-30 dark:hover:bg-neutral-800"
          >
            <IconRedo className="h-5 w-5" />
          </button>

          <div className="flex-1" />
          <button
            type="button"
            onClick={confirmDelete}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            title="この手書きを削除"
            aria-label="この手書きを削除"
          >
            <IconTrash className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={exitDraw}
            className="flow-press rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
            title="文字入力に戻ります"
          >
            完了
          </button>
        </div>
      )}

      <div ref={boxRef} className="relative w-full" style={{ height: h * scale }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          // 描画中だけタッチを止める。それ以外は本文と同じようにスクロールさせる
          style={{ touchAction: drawing ? "none" : "auto" }}
        />
      </div>
    </NodeViewWrapper>
  );
}
