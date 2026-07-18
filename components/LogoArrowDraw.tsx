"use client";

// Flow アイコンの白い矢印を「下から上へ線を描くように」1 回だけ出現させる。
//
// 元アイコン（Flow_light_icon.png）はラスタなので、矢印の軌跡を SVG の
// <path>（1 本の stroke）として起こし直したものを使う。線の中心線 LINE と
// 矢じり HEAD は、実物のアイコンを測って求めた座標（viewBox 0 0 100 100）。
//
// 手法：stroke-dasharray / stroke-dashoffset のライン描画。
//   - マウント後に getTotalLength() で実際のパス長を測り、CSS 変数 --arrow-len
//     に渡す。CSS 側の dasharray / dashoffset はこの変数を使う。
//   - @keyframes flow-arrow-draw が dashoffset を「パス長 → 0」に動かすことで、
//     パスの始点（左下のカーブ始まり）から終点（右上の矢じり手前）へ向かって
//     線が引かれていく。LINE は尾→先端の向きで書いてあるので、そのまま
//     dashoffset を 0 に近づけるだけで「下から上へ」描かれる。
//   - 再生は 1 回だけ。描き終えたら phase="done" にして最終状態をインラインで
//     固定するので、ループせず、スタイル再適用が起きても描かれたまま静止する。
//
// prefers-reduced-motion: reduce の場合は、線描きをせず最初から完全に描かれた
// 状態で静止表示する（判定は JS と CSS の両方に入れてある。CSS 側は JS が動く
// 前の初回描画から効かせるため）。

/** 矢印の中心線（尾＝左下 → 矢じり手前＝右上）。この向きが描画順そのもの。 */
const LINE =
  "M 20.5 77 C 24 71.5, 27 66, 30 60.5 C 33 55, 34.5 50.5, 37 46 " +
  "C 40 41.5, 43.5 37.5, 46.5 40.5 C 49.3 43.3, 50.3 55.5, 52.8 61 " +
  "C 54.8 64.5, 57.5 63, 60 57 C 62.5 51, 65.5 46, 69 40.5 " +
  "C 70.5 38, 71.8 36.3, 73 35";

/** 矢じり（右上の三角形）。先端は (79.5, 20.5)。中心は bbox 中央 (71.5, 31.25)。 */
const HEAD = "M 61 30 L 79.5 20.5 L 82 42 Z";

import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "drawing" | "done";

export default function LogoArrowDraw({
  className,
  onDrawn,
}: {
  className?: string;
  /** 完全に描かれて静止した瞬間に 1 回だけ呼ばれる */
  onDrawn?: () => void;
}) {
  const lineRef = useRef<SVGPathElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;

    // 実測したパス長を CSS 変数へ。dasharray / dashoffset がこれを使う。
    // getTotalLength は SVG のユーザー座標（viewBox 基準）なので、画面サイズや
    // 向きが変わっても値は不変。計測は 1 回でよい。
    line.style.setProperty("--arrow-len", String(line.getTotalLength()));

    // 動きを減らす設定なら、描かずに完成形で静止して終わり
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setPhase("done");
      onDrawn?.();
      return;
    }

    // iPad の PWA をホーム画面から「横向きで」起動すると、最初の数百 ms は
    // ビューポートが縦向き寸法のまま描画され、その後 landscape へ補正されて
    // レイアウトが飛ぶことがある。その最中に線を引き始めると、矢印が中央から
    // ずれた位置で描かれてから中央へ瞬間移動して見える（実機で報告あり）。
    //
    // 線は「見え始める瞬間」＝描画開始なので、ビューポート寸法が数フレーム
    // 変化しなくなる（＝レイアウトが安定する）まで開始を遅らせる。安定する
    // までは背景（スプラッシュと同色）だけが見えるため、ずれた矢印は出ない。
    // 通常の起動では最初から安定しているので、数フレーム（〜50ms）で始まる。
    let raf = 0;
    let started = false;
    let stableFrames = 0;
    let lastSize = `${window.innerWidth}x${window.innerHeight}`;
    const t0 = Date.now();

    const tick = () => {
      const size = `${window.innerWidth}x${window.innerHeight}`;
      if (size === lastSize) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastSize = size;
      }
      // 3フレーム連続で寸法が変わらなければ安定とみなす。
      // 揺れ続けても最大 700ms で必ず開始する保険付き。
      if (stableFrames >= 3 || Date.now() - t0 > 700) {
        started = true;
        setPhase("drawing"); // この瞬間に @keyframes が走り出す
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      if (!started) cancelAnimationFrame(raf);
    };
    // onDrawn は初回マウント時に確定させる（依存に入れず 1 回きりにする）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 線・矢じりのどちらのアニメーションも SVG まで伝播する。
  // 最後に終わる矢じり（flow-arrow-head-in）の完了を「描き終わり」とみなす。
  const handleAnimationEnd = (e: React.AnimationEvent<SVGSVGElement>) => {
    if (e.animationName === "flow-arrow-head-in") {
      setPhase("done");
      onDrawn?.();
    }
  };

  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      data-phase={phase}
      aria-hidden="true"
      onAnimationEnd={handleAnimationEnd}
    >
      {/* 白い矢印の本体（1 本の stroke）。dash 系は CSS で制御する。 */}
      <path
        ref={lineRef}
        className="flow-arrow-line"
        d={LINE}
        fill="none"
        stroke="#fff"
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 矢じり。描画の終端で中心からポップインする（CSS 側でスケール/フェード）。 */}
      <path
        className="flow-arrow-head"
        d={HEAD}
        fill="#fff"
        stroke="#fff"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </svg>
  );
}
