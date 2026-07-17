// 起動時の導入アニメーション。
// OS のスプラッシュ（同じ背景色 #dceef8）から途切れず続けて、白い矢印が
// 左下から波を描いて現れ、Flow アイコンの形になったあと、その波がそのまま
// 右上へ流れ出ていく（消えるのも「描く」のと同じ向きの動き）。
//
// 【JS を使わない】"use client" を付けず、サーバーが返す HTML に最初から含める。
// 起動時の JS を 1 バイトも増やさず、ハイドレーション前から動く。
//
// 【CSS アニメーションではなく SMIL を使う理由】
// WebKit(iOS) には、CSS アニメーション開始後にスタイルシートが再適用されると
// アニメーションを頭から再スタートさせる癖がある。実際 CSS 版では iOS でだけ
// 導入が2回再生された（Chrome は1回。ハイドレーション不一致は無し）。
// SMIL は SVG 自身が持つアニメーションでスタイルシートの影響を受けないため、
// この癖の対象外になる。JS 不要のままなのも同じ。
//
// 【当たり判定を持たない】オーバーレイは pointer-events:none。最後に
// 消え損ねても操作を邪魔しない（消えるのに JS を待たない設計の保険）。
//
// 矢印の形は Flow_icon の実物を測って起こした中心線（実測との平均ズレ 1.06%）。

/** 矢印の中心線（viewBox 0 0 100 100）。左下の尾から矢じりの手前まで */
const LINE =
  "M 20.5 77 C 24 71.5, 27 66, 30 60.5 C 33 55, 34.5 50.5, 37 46 " +
  "C 40 41.5, 43.5 37.5, 46.5 40.5 C 49.3 43.3, 50.3 55.5, 52.8 61 " +
  "C 54.8 64.5, 57.5 63, 60 57 C 62.5 51, 65.5 46, 69 40.5 " +
  "C 70.5 38, 71.8 36.3, 73 35";

/** 矢じり（右上） */
const HEAD = "M 61 30 L 79.5 20.5 L 82 42 Z";

const BG = "#dceef8";
/** 線を描き始めるまでの間 */
const BEGIN = "0.06s";
/** 線が「引かれて→流れ出る」までの長さ */
const DUR = "1.25s";

export default function SplashIntro() {
  return (
    <div className="flow-intro" aria-hidden="true">
      {/* 背景。単色なので preserveAspectRatio=none で引き伸ばして全画面を覆う。
          矢印が抜けたあとに SMIL で透明にする（CSS を使わないのは上記の理由） */}
      <svg
        className="flow-intro-bg"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
      >
        <rect width="1" height="1" fill={BG}>
          <animate
            attributeName="opacity"
            values="1;1;0"
            keyTimes="0;0.78;1"
            dur="1.6s"
            fill="freeze"
          />
        </rect>
      </svg>

      <svg className="flow-intro-svg" viewBox="0 0 100 100">
        {/* 線：pathLength=1 に対し dash=1/gap=1。dashoffset を
              1 → 0 : 尾から先端へ引かれる（現れる）
              0 → -1: 尾の側から引き上げられ先端から流れ出る（消える）
            と続けて動かすと、逆再生ではなく一本の波が通り抜けたように見える */}
        <path
          d={LINE}
          pathLength={1}
          fill="none"
          stroke="#fff"
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1}
          strokeDashoffset={1}
        >
          <animate
            attributeName="stroke-dashoffset"
            values="1;0;0;-1"
            keyTimes="0;0.48;0.58;1"
            calcMode="spline"
            keySplines="0.65 0 0.35 1;0 0 1 1;0.55 0 0.35 1"
            dur={DUR}
            begin={BEGIN}
            fill="freeze"
          />
        </path>

        {/* 矢じり：線が届いてから現れ、波の流出に合わせて右上へ抜ける */}
        <path d={HEAD} fill="#fff" stroke="#fff" strokeWidth={4} strokeLinejoin="round" opacity={0}>
          <animate
            attributeName="opacity"
            values="0;0;1;1;0"
            keyTimes="0;0.40;0.54;0.72;1"
            dur={DUR}
            begin={BEGIN}
            fill="freeze"
          />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0;0 0;14 -14"
            keyTimes="0;0.72;1"
            calcMode="spline"
            keySplines="0 0 1 1;0.55 0 0.35 1"
            dur={DUR}
            begin={BEGIN}
            fill="freeze"
          />
        </path>
      </svg>
    </div>
  );
}
