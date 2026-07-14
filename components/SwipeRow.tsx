"use client";

import { useRef, useState, type ReactNode } from "react";
import { useDevice } from "@/lib/useDevice";

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  /** ボタンの配色クラス（背景色など） */
  className: string;
  onClick: () => void;
}

const ACTION_WIDTH = 72; // 1アクションあたりの幅(px)

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

  const openWidth = actions.length * ACTION_WIDTH;

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
    <div className={`flow-swipe-row relative overflow-hidden ${className}`}>
      {/* 背後のアクション（丸みのある四角ボタン） */}
      <div className="absolute inset-y-0 right-0 flex">
        {actions.map((a) => (
          <div key={a.key} style={{ width: ACTION_WIDTH }} className="flex p-1">
            <button
              onClick={() => {
                close();
                a.onClick();
              }}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium text-white ${a.className}`}
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
