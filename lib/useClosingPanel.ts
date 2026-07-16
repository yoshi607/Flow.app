"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 「開くときは flow-format-in、閉じるときは flow-format-out を見せてから
// アンマウントする」ポップアップの開閉状態。Aa書式パネル・3点メニュー・
// クリップ挿入メニューで同じ動きを共有するためのフック。
// closing の間（既定240ms＝flow-format-out と同じ長さ）はマウントを維持する。
export function useClosingPanel(closeDuration = 240) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  // 二重close防止の判定は state ではなく ref で行う
  // （連打時、state の反映を待たずに判定する必要があるため）
  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 閉じるアニメーションの途中でアンマウントされたらタイマーを片付ける
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timer.current = setTimeout(() => {
      closingRef.current = false;
      setClosing(false);
      setOpen(false);
    }, closeDuration);
  }, [closeDuration]);

  const toggle = useCallback(() => {
    if (open && !closingRef.current) close();
    else if (!open) setOpen(true);
  }, [open, close]);

  return { open, closing, toggle, close };
}
