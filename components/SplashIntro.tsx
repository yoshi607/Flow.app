"use client";

// 起動時の導入オーバーレイ。OS のスプラッシュ（同じ背景色 #dceef8）から
// 途切れず、白い矢印を左下から右上へ 1 回だけ線で描く（LogoArrowDraw）。
// 描き終えたら完全な形で少し静止し、そのあと溶暗して退場する。
//
// 描画そのものは LogoArrowDraw に任せ、ここは全画面オーバーレイの配置と
// 「描き終わったら退場させる」流れだけを持つ。当たり判定は持たない
// （pointer-events:none）ので、万一消え残っても操作を邪魔しない。

import { useEffect, useRef, useState } from "react";
import LogoArrowDraw from "./LogoArrowDraw";

// 導入の各時間は「線描き（globals.css）→ 静止 → 溶暗」で一続きの演出なので、
// 速さを変えるときは 3 つとも同じ倍率で詰めること（ここだけ変えると、線を
// 描き終えてから消えるまでの間が不自然に空く／詰まる）。現在は 1.5 倍速。
/** 描き終えてから静止させておく時間 */
const HOLD_MS = 280;
/** 溶暗にかける時間（CSS の .flow-intro の transition と合わせる） */
const FADE_MS = 330;

export default function SplashIntro() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  if (gone) return null;

  const handleDrawn = () => {
    // 完成形で少し静止 → 溶暗 → DOM から外す
    timers.current.push(window.setTimeout(() => setLeaving(true), HOLD_MS));
    timers.current.push(
      window.setTimeout(() => setGone(true), HOLD_MS + FADE_MS),
    );
  };

  return (
    <div className="flow-intro" data-leaving={leaving} aria-hidden="true">
      <LogoArrowDraw className="flow-intro-svg" onDrawn={handleDrawn} />
    </div>
  );
}
