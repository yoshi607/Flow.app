// 起動時の導入アニメーション。
// OS のスプラッシュ（同じ背景色 #dceef8）から途切れず続けて、白い矢印が
// 左下から波を描いて現れ、Flow アイコンの形になったあと右上へ抜けていく。
//
// 【JS を使わない】"use client" を付けず、サーバーが返す HTML に最初から
// 含める。動きは CSS だけで完結し、最後は visibility:hidden で自分から消える。
//  - 起動時の JS を 1 バイトも増やさない（せっかく縮めた初期JSを損なわない）
//  - ハイドレーション前から動くので、アプリの読み込み中の間を自然に埋められる
//
// 矢印の形は Flow_icon の実物を測って起こした中心線（実測との平均ズレ 1.06%）。
// 数値の根拠は scripts/gen-splash.mjs と同じ元画像 Flow_icon/Flow_light_icon.png。

/** 矢印の中心線（viewBox 0 0 100 100）。左下の尾から矢じりの手前まで */
const LINE =
  "M 20.5 77 C 24 71.5, 27 66, 30 60.5 C 33 55, 34.5 50.5, 37 46 " +
  "C 40 41.5, 43.5 37.5, 46.5 40.5 C 49.3 43.3, 50.3 55.5, 52.8 61 " +
  "C 54.8 64.5, 57.5 63, 60 57 C 62.5 51, 65.5 46, 69 40.5 " +
  "C 70.5 38, 71.8 36.3, 73 35";

/** 矢じり（右上） */
const HEAD = "M 61 30 L 79.5 20.5 L 82 42 Z";

export default function SplashIntro() {
  return (
    <div className="flow-intro" aria-hidden="true">
      <svg className="flow-intro-svg" viewBox="0 0 100 100">
        <g className="flow-intro-arrow">
          {/* pathLength=1 にすると、線の実長を測らずに 1→0 で描き出せる */}
          <path
            className="flow-intro-line"
            d={LINE}
            pathLength={1}
            fill="none"
            stroke="#fff"
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="flow-intro-head"
            d={HEAD}
            fill="#fff"
            stroke="#fff"
            strokeWidth={4}
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}
