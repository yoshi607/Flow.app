"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** 取り消しにくい操作（削除など）は赤字にする */
  danger?: boolean;
  onClick: () => void;
}

// カーソル位置に出すメニュー。画面外にはみ出さないよう、実寸を測ってから
// 位置を確定する（右端・下端で押したときに見切れないように）。
const EDGE_MARGIN = 8;

export default function NoteContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 実寸を測るまでは指定位置に置き、測り終えたら補正する。
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    // はみ出す側では、カーソルを起点に反対方向へ開く。
    const left =
      x + w + EDGE_MARGIN > window.innerWidth ? Math.max(EDGE_MARGIN, x - w) : x;
    const top =
      y + h + EDGE_MARGIN > window.innerHeight ? Math.max(EDGE_MARGIN, y - h) : y;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 一覧をスクロールすると、カーソル位置に固定したメニューだけが取り残されて
    // 対象の行とずれてしまうので閉じる。
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const run = useCallback(
    (item: ContextMenuItem) => {
      // 先に閉じてから実行する（移動シートなど、別の UI を開く項目があるため）
      onClose();
      item.onClick();
    },
    [onClose],
  );

  return (
    <>
      {/* 画面外クリック・右クリックで閉じる */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }}
        className="flow-menu-in fixed z-50 w-52 overflow-hidden rounded-2xl border border-brand-200/60 bg-brand-50 py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-800"
      >
        {items.map((item) => (
          <button
            key={item.key}
            role="menuitem"
            onClick={() => run(item)}
            className={`flex w-full items-center gap-3 whitespace-nowrap px-4 py-2.5 text-left text-sm ${
              item.danger
                ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                : "hover:bg-brand-100/70 dark:hover:bg-neutral-800/70"
            }`}
          >
            {/* アイコンの既定サイズは w-5 h-5 なので、メニュー用に 4 に揃える */}
            <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
