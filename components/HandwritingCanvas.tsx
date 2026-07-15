"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconClose } from "./icons";

// ペンの色（本文の文字色と揃える）と黒
const PEN_COLORS = ["#1C1C1E", "#007AFF", "#00C7BE", "#FF9500", "#FF2D55", "#AF52DE"];
const PEN_WIDTHS = [2, 4, 8];

// ページ下端からこの範囲に書いたら、次の白紙ページを足す
const BOTTOM_PAD = 90;
// キャンバスの最大ピクセル数。iOS Safari は概ね 16.7M px（4096×4096 相当）で
// キャンバスが無効になるため、これを下回る範囲でしかページを増やせない。
// 1ページあたりの実ピクセル数から、足せるページ数の上限を都度計算する。
const MAX_CANVAS_AREA = 16_000_000;
const MAX_PAGES = 12;

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
  origin,
}: {
  onSave: (blob: Blob) => void;
  onClose: () => void;
  /** 押された手書きボタンの位置。ここから広がるように見せる */
  origin?: DOMRect | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const penSeen = useRef(false);
  const dirty = useRef(false);
  // 現在描画中のポインタID（他の指の混入を無視するため）
  const activeId = useRef<number | null>(null);
  // 今の筆が始まった時刻（遅れて届いた古い筆の pointerup を捨てるため）
  const strokeStart = useRef(0);

  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [erasing, setErasing] = useState(false);
  // 既定は「ペンのみ描画」。手のひらや指（touch）では描かず誤作動を防ぐ。
  // Apple Pencil を持っていない場合はトグルで指描きに切り替え可能。
  const [penOnly, setPenOnly] = useState(true);

  // 用紙のページ数と1ページの高さ(CSS px)。下まで書くとページが増える。
  const [pages, setPages] = useState(1);
  const [pageH, setPageH] = useState(0);

  // 描画設定は ref にも持つ。描画はネイティブのイベントリスナーで行うため、
  // 再購読せずに常に最新の設定を読めるようにするのが目的。
  const settings = useRef({ color, width, erasing, penOnly });
  settings.current = { color, width, erasing, penOnly };

  // ページ関連もリスナーから読めるように ref で持つ
  const pagesRef = useRef(1);
  pagesRef.current = pages;
  const pageHRef = useRef(0);
  pageHRef.current = pageH;
  const maxPagesRef = useRef(1);
  // この筆の途中でページが増えたか（筆を離してから送るために使う）
  const grew = useRef(false);

  // 押された手書きボタンから広がるように見せる（＋ボタンと同じ考え方）。
  // 画面全体をボタンの大きさまで潰すと歪むため、変形の原点だけをボタンに
  // 合わせ、拡大率は控えめにして不透明度で繋ぐ。
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !origin || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const o = `${origin.left + origin.width / 2 - r.left}px ${
      origin.top + origin.height / 2 - r.top
    }px`;
    el.animate(
      [
        { transformOrigin: o, transform: "scale(0.2)", opacity: 0 },
        { transformOrigin: o, opacity: 1, offset: 0.45 },
        { transformOrigin: o, transform: "scale(1)", opacity: 1 },
      ],
      {
        duration: 360,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        fill: "none",
      },
    );
  }, [origin]);

  // 1ページの高さ＝描画エリアの見えている高さ。
  // ※ 変形（上の展開アニメーション）の影響を受けない clientHeight で測る。
  useLayoutEffect(() => {
    const h = wrapRef.current?.clientHeight ?? 0;
    if (h > 0) setPageH(h);
  }, []);

  // キャンバスの実ピクセル数をページ数に合わせて張り直す。
  // ※ canvas は width/height を変えると中身が消えるため、退避してから戻す。
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !pageH) return;

    const dpr = window.devicePixelRatio || 1;
    const nextW = Math.round(wrap.clientWidth * dpr);
    const nextH = Math.round(pageH * pages * dpr);

    // 足せるページ数の上限（iOS のキャンバス上限を超えないように）
    const perPage = nextW * Math.round(pageH * dpr);
    maxPagesRef.current = Math.max(
      1,
      Math.min(MAX_PAGES, Math.floor(MAX_CANVAS_AREA / Math.max(perPage, 1))),
    );

    if (canvas.width === nextW && canvas.height === nextH) return;

    let snapshot: HTMLCanvasElement | null = null;
    if (canvas.width > 0 && canvas.height > 0) {
      snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
    }

    canvas.width = nextW;
    canvas.height = nextH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 退避した内容は実ピクセルのまま等倍で戻す（変形をかける前に描く）
    if (snapshot) ctx.drawImage(snapshot, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [pages, pageH]);

  // キャンバスの初期化と描画イベントの購読（マウント時に1回だけ）。
  //
  // iPad + Apple Pencil で「文字の2画目が描けない」不具合の対策として、
  // 実機ログを取りながら以下の構成に落ち着いている。安易に戻さないこと:
  //  - React の合成イベントではなくネイティブリスナーを使う
  //  - setPointerCapture は使わない
  //  - touchstart/touchmove を preventDefault してSafariのジェスチャー
  //    認識を止める（これが無いと2画目の pointerdown が発火しない）
  //  - pointerdown は window のキャプチャで受け、座標で領域内か判定する
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    // ※ キャンバスの実ピクセル設定は別の effect（ページ数に追従）で行う
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pointOf = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const pressureOf = (e: { pressure: number }) =>
      e.pressure && e.pressure > 0 ? e.pressure : 0.5;

    const shouldDraw = (e: PointerEvent) => {
      if (e.pointerType === "pen") {
        penSeen.current = true;
        return true;
      }
      if (e.pointerType === "mouse") return true; // PCでの確認用
      // touch（指・手のひら）:
      //  - ペンのみモード（既定）では一切描かない＝手のひら誤爆を完全に防ぐ
      //  - ペンが一度でも使われたら、以後 touch は無視
      if (settings.current.penOnly) return false;
      if (penSeen.current) return false;
      return true;
    };

    // 現在のペン設定を ctx に反映し、線幅を返す
    const applyStyle = (pressure: number) => {
      const { erasing, color, width } = settings.current;
      if (erasing) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.lineWidth = width * 4;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        // 筆圧があれば太さに反映（0.5〜1.5倍）
        ctx.lineWidth = width * (0.5 + pressure);
      }
      return ctx.lineWidth;
    };

    // キャンバス領域内か（要素ではなく座標で判定する。Safari がイベントを
    // 別要素へリターゲットしても取りこぼさないようにするため）
    // ※ キャンバスはページ数ぶん縦に長く、スクロールすると上端は画面外
    //    （ツールバーの裏）へ出る。見えている範囲との重なりで判定しないと、
    //    ツールバーを押しただけで描画が始まってしまう。
    const insideCanvas = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const v = wrap.getBoundingClientRect();
      return (
        e.clientX >= Math.max(r.left, v.left) &&
        e.clientX <= Math.min(r.right, v.right) &&
        e.clientY >= Math.max(r.top, v.top) &&
        e.clientY <= Math.min(r.bottom, v.bottom)
      );
    };

    // 下まで書いたら白紙ページを足す。y はキャンバス上端からの位置(CSS px)。
    // 同じ筆の move が連続しても二重に増やさないよう ref を即座に更新する。
    const maybeGrow = (y: number) => {
      if (!pageHRef.current) return;
      const need = Math.ceil((y + BOTTOM_PAD) / pageHRef.current);
      const next = Math.min(
        maxPagesRef.current,
        Math.max(pagesRef.current, need),
      );
      if (next <= pagesRef.current) return;
      pagesRef.current = next;
      grew.current = true;
      setPages(next);
    };

    // 増えた白紙が見えるところまで送る。筆を離してから動かす
    // （書いている最中に紙が動くと、線が紙の上でずれたように見えるため）
    const revealNewPage = () => {
      if (!grew.current) return;
      grew.current = false;
      wrap.scrollTo({
        top: wrap.scrollTop + pageHRef.current * 0.45,
        behavior: "smooth",
      });
    };

    const onDown = (e: PointerEvent) => {
      if (!shouldDraw(e)) return;
      if (!insideCanvas(e)) return;
      e.preventDefault();
      // 前の筆が pointerup を取りこぼしていても、必ず新しい筆として開始する
      drawing.current = true;
      activeId.current = e.pointerId;
      strokeStart.current = e.timeStamp;
      const p = pointOf(e);
      last.current = p;

      // 押した瞬間に点を打つ（速く短い筆は move がほぼ発生しないため）
      const w = applyStyle(pressureOf(e));
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(w / 2, 0.5), 0, Math.PI * 2);
      ctx.fill();
      dirty.current = true;
      maybeGrow(p.y);
    };

    const onMove = (e: PointerEvent) => {
      if (!shouldDraw(e)) return;

      // 【重要】down/up の記録だけに頼らず、「今ペンが実際に触れているか」を
      // buttons / pressure で判断する。iOS では画の途中で pointerup が
      // 届いてしまうことがあり、それ以降の move が全て無視されて
      // 「点しか描かれない＝2画目が反応しない」状態になっていた。
      const pressed =
        e.buttons > 0 || (e.pointerType !== "mouse" && e.pressure > 0);

      if (!pressed) {
        // ペンが浮いている（ホバー移動）→ 筆を終える
        if (drawing.current && activeId.current === e.pointerId) {
          drawing.current = false;
          activeId.current = null;
          last.current = null;
        }
        return;
      }

      // 触れているのに筆が始まっていない（up の誤検知・取りこぼし）→
      // ここから筆を再開する。これにより画が途中で切れなくなる。
      if (!drawing.current || activeId.current !== e.pointerId) {
        drawing.current = true;
        activeId.current = e.pointerId;
        strokeStart.current = e.timeStamp;
        last.current = pointOf(e);
        return;
      }

      e.preventDefault();
      if (!last.current) {
        last.current = pointOf(e);
        return;
      }
      // 速く書くと move が間引かれるため、中間点(coalesced events)も全て描く
      const points =
        typeof e.getCoalescedEvents === "function"
          ? e.getCoalescedEvents()
          : [];
      for (const pe of points.length > 0 ? points : [e]) {
        const p = pointOf(pe);
        applyStyle(pressureOf(pe));
        ctx.beginPath();
        ctx.moveTo(last.current!.x, last.current!.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last.current = p;
      }
      dirty.current = true;
      if (last.current) maybeGrow(last.current.y);
    };

    const onUp = (e: PointerEvent) => {
      if (!drawing.current) return;
      // 今描いている筆の pointerup 以外は無視（手のひら等の指を弾く）。
      // ※ activeId が null のときに素通りしないよう、厳密に比較する。
      if (activeId.current !== e.pointerId) return;
      // 【重要】iOS は pointerId を使い回すことがあり、1画目の pointerup が
      // 2画目の pointerdown より遅れて届くと、この筆を誤って終了させてしまう
      // （＝2画目が描けない）。筆の開始より前に発生した up は捨てる。
      if (e.timeStamp < strokeStart.current) return;
      drawing.current = false;
      activeId.current = null;
      last.current = null;
      revealNewPage();
    };

    // pointercancel は「遅れて届いた古いup」判定を適用せず、確実に筆を終える
    const onCancel = (e: PointerEvent) => {
      if (activeId.current !== e.pointerId) return;
      drawing.current = false;
      activeId.current = null;
      last.current = null;
      revealNewPage();
    };

    // 【重要】Safari は Apple Pencil に対して touch-action:none を効かせず、
    // ジェスチャー認識（ダブルタップ等）が働いて2画目の pointerdown を
    // 握りつぶすことがある。ペン/指のタッチ既定動作をここで明示的に止める。
    const blockTouch = (e: TouchEvent) => e.preventDefault();

    // 2本指でのスクロール。
    // 【重要】上の blockTouch は全てのタッチで preventDefault し続ける
    // （＝ブラウザのスクロールは一切使わない）。ここを緩めると2画目問題が
    // 再発しかねないため、スクロールは scrollTop を自分で動かして実現する。
    // ペンが触れている間は対象外＝手のひらと併用しても紙が動かない。
    let scrolling = false;
    let scrollFromY = 0;
    let scrollFromTop = 0;
    const midY = (e: TouchEvent) =>
      (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const hasStylus = (e: TouchEvent) =>
      Array.from(e.touches).some(
        (t) => (t as Touch & { touchType?: string }).touchType === "stylus",
      );

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && !hasStylus(e)) {
        scrolling = true;
        scrollFromY = midY(e);
        scrollFromTop = wrap.scrollTop;
        // 指描きモードで1本目が描き始めていたら、その筆は終える
        drawing.current = false;
        activeId.current = null;
        last.current = null;
      }
      blockTouch(e);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (scrolling && e.touches.length === 2) {
        wrap.scrollTop = scrollFromTop - (midY(e) - scrollFromY);
      }
      blockTouch(e);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) scrolling = false;
    };

    // pointerdown も window のキャプチャで受ける（要素へのリターゲットや
    // 途中での stopPropagation に影響されないようにするため）
    window.addEventListener("pointerdown", onDown, {
      passive: false,
      capture: true,
    });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);
    // move/up は window で受ける（指が要素外へ出ても筆が途切れないように）
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);

    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

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
    // 用紙も1ページに戻す
    pagesRef.current = 1;
    grew.current = false;
    setPages(1);
    wrapRef.current?.scrollTo({ top: 0 });
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
    <div
      ref={rootRef}
      className="flow-draw-overlay fixed inset-0 z-50 flex select-none flex-col bg-white dark:bg-neutral-950"
    >
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

      {/* 描画エリア。下まで書くと白紙ページが自動で増え、縦に長くなる。
          スクロールは2本指、またはトラックパッド/ホイールで行う
          （1本指はペン・指の描画に使うため） */}
      <div
        ref={wrapRef}
        className="relative flex-1 overflow-y-auto overscroll-contain bg-white"
      >
        <div
          className="relative w-full"
          style={{ height: pageH ? pageH * pages : "100%" }}
        >
          {/* ページの区切り（目安の線。保存する画像には含まれない） */}
          {pageH > 0 &&
            Array.from({ length: pages - 1 }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-brand-200 dark:border-neutral-800"
                style={{ top: pageH * (i + 1) }}
              />
            ))}
          {/* 描画イベントは useEffect 内でネイティブに購読している */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
            style={{ touchAction: "none" }}
          />
        </div>
      </div>
    </div>
  );
}
