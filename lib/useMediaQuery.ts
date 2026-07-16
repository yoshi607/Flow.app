"use client";

import { useEffect, useState } from "react";

// メディアクエリの判定をリアクティブに返す（SSR/初回描画では false）。
// 「md 以上か」のような画面幅の出し分けに使う。
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}
