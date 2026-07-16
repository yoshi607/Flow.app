"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDevice } from "@/lib/useDevice";

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  /** ボタンの配色クラス（背景色など） */
  className: string;
  /** 実行後も行を開いたままにする。削除のように、行そのものが
   *  アニメーションで消える場合に使う（閉じ戻りと動きがぶつかるため） */
  keepOpen?: boolean;
  onClick: () => void;
}

const ACTION_WIDTH = 72; // 1アクションあたりの幅(px)

// --- トラックパッド(2本指スクロール)の効き具合。数値を上げるほど敏感になる ---
// スクロール量に対して実際に開く量の比率（1.0 で等倍＝かなり敏感）
const WHEEL_SENSITIVITY = 0.4;
// 横方向が縦方向のこの倍率を超えたときだけ反応する（縦スクロール中の誤爆防止）
const WHEEL_AXIS_RATIO = 1.5;
// 横に累計これだけ動くまでは開き始めない（触れただけで開かないための「あそび」）
const WHEEL_START_PX = 30;

// 左スワイプで右側にアクション（共有・移動・削除など）を表示する行（⑥）。
// タッチ端末でのみジェスチャーを有効化し、非タッチ端末では
// そのまま children を表示する（右クリック等は各画面の別UIで対応）。
export default function SwipeRow({
  actions,
  children,
  disabled = false,
  className = "",
}: {
  actions: SwipeAction[];
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const { isTouch } = useDevice();
  const [offset, setOffset] = useState(0); // 現在の表示ずらし量(px, 0以下)
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0, base: 0 });
  const axis = useRef<"none" | "x" | "y">("none");
  const rowRef = useRef<HTMLDivElement>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 「あそび」判定用に、今回のスクロールで横に動いた累計量
  const wheelAccum = useRef(0);
  // 最新の offset をリスナーから読むための控え
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const openWidth = actions.length * ACTION_WIDTH;

  // トラックパッド（iPadのキーボード接続時など）の2本指・横スクロールでも
  // アクションを開けるようにする。指のスワイプは touch イベント側で処理。
  // ※ preventDefault が必要なため、passive:false のネイティブリスナーで登録する。
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // 明確に横方向のときだけ反応（縦スクロールは邪魔しない）
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * WHEEL_AXIS_RATIO) return;
      e.preventDefault();

      // 開き始めるまでの「あそび」。少し触れただけでは動かさない。
      // 既に開いている最中はそのまま追従させる。
      wheelAccum.current += e.deltaX;
      const engaged =
        offsetRef.current !== 0 || Math.abs(wheelAccum.current) > WHEEL_START_PX;

      if (engaged) {
        let next = offsetRef.current - e.deltaX * WHEEL_SENSITIVITY;
        if (next > 0) next = 0;
        if (next < -openWidth) next = -openWidth;
        setDragging(true); // 追従中はアニメーションを切る
        setOffset(next);
      }

      // スクロールが止まったら開/閉にスナップする
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelAccum.current = 0;
        setDragging(false);
        setOffset(offsetRef.current < -openWidth / 2 ? -openWidth : 0);
      }, 140);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
    // isTouch/disabled を依存に入れるのは必須。初回描画は端末判定前で
    // isTouch=false のため ref の付かない div が描画され、この effect は
    // rowRef.current=null で何もせず終わる。判定後に描画が切り替わった
    // タイミングで再実行しないと、wheel リスナーが永久に付かない。
  }, [openWidth, isTouch, disabled]);

  if (!isTouch || disabled || actions.length === 0) {
    return <div className={className}>{children}</div>;
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: offset };
    axis.current = "none";
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    // 最初の動きで縦横どちらのジェスチャーか判定
    if (axis.current === "none") {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axis.current !== "x") return;
    let next = start.current.base + dx;
    // 開ける範囲は 0（閉）〜 -openWidth（全開）。少しだけ弾性を持たせる
    if (next > 0) next = next * 0.2;
    if (next < -openWidth) next = -openWidth + (next + openWidth) * 0.2;
    setOffset(next);
  }

  function onTouchEnd() {
    setDragging(false);
    if (axis.current !== "x") return;
    // 半分以上開いていれば全開、そうでなければ閉じる
    setOffset(offset < -openWidth / 2 ? -openWidth : 0);
  }

  const close = () => setOffset(0);

  return (
    <div
      ref={rowRef}
      className={`flow-swipe-row relative overflow-hidden ${className}`}
    >
      {/* 背後のアクション（丸みのある四角ボタン） */}
      <div className="absolute inset-y-0 right-0 flex">
        {actions.map((a) => (
          <div key={a.key} style={{ width: ACTION_WIDTH }} className="flex p-1">
            <button
              onClick={() => {
                if (!a.keepOpen) close();
                a.onClick();
              }}
              className={`flow-press flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium text-white ${a.className}`}
            >
              <span className="h-5 w-5">{a.icon}</span>
              {a.label}
            </button>
          </div>
        ))}
      </div>

      {/* 前面のコンテンツ */}
      <div
        className={`flow-swipe-content relative bg-white dark:bg-neutral-950 ${
          dragging ? "dragging" : ""
        }`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        // 開いている状態で本体をタップしたら閉じる（誤操作防止）
        onClickCapture={(e) => {
          if (offset !== 0) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
