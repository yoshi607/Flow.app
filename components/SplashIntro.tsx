// 起動時の導入アニメーション。
// OS のスプラッシュ（同じ背景色 #dceef8）から途切れず続けて、白い矢印が
// 左下から波を描いて現れ、Flow アイコンの形になり、少し「ため」てから
// 波ごと右上へ流れ出て画面外へ抜けていく。
//
// 【JS を使わない】"use client" を付けず、サーバーが返す HTML に最初から含める。
// 起動時の JS を 1 バイトも増やさず、ハイドレーション前から動く。
//
// 【動きは SMIL（SVG 組み込み）で書く】CSS アニメーションではなく SMIL なのは、
// スタイルシートの再適用に左右されず、JS も要らないため。
//
// 【「抜け」は 流れ出る＋滑り出る の重ね】抜けは dashoffset 0→-1 で線を尾から
// 消し、波が先端へ流れ出ていくように見せる（この動き自体は意図どおり）。
// ただしこれ「だけ」だと、白く見える部分が描画中と同じく左下→右上へ動くので、
// 描画の続きに見えて「1回半くり返した」ように読めてしまった
// （発火は1回であることは計測済み。技術的な二重再生ではなく見え方の問題）。
// そこで同じ区間で 線と矢じりをまとめたグループごと 右上へ加速させる。
// 先端が固定されず画面外へ出ていくため、描画の反復とは読めなくなる。
// 矢じりもグループで一緒に動くので、抜ける間も矢印の形を保ったまま出ていく。
//
// 【当たり判定を持たない】オーバーレイは pointer-events:none。最後に消え損ねても
// 操作を邪魔しない（消えるのに JS を待たない設計の保険）。
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
const BEGIN = "0.06s";
/** 描画→ため→抜け までの長さ */
const DUR = "1.4s";
// 区切り（DUR に対する割合）
//   0    →0.44 描画（尾から先端へ引かれる）
//   0.44 →0.73 ため（約0.4秒。ここで Flow アイコンの形で静止する）
//   0.73 →1    抜け（波が先端へ流れ出つつ、矢印ごと右上へ滑り出る）
const T_DRAWN = 0.44;
const T_HOLD = 0.73;

/** 抜けの移動量。矢印の進行方向（右上45°）へ。線は同時に流れ出て消えるので、
 *  矢じりが viewBox(100) の外に出きるぶんだけあればよい */
const EXIT = "60 -60";

export default function SplashIntro() {
  return (
    <div className="flow-intro" aria-hidden="true">
      {/* 背景。単色なので preserveAspectRatio=none で引き伸ばして全画面を覆う。
          矢印が抜けきってからアプリを見せるため、ここだけは透明にしていく */}
      <svg className="flow-intro-bg" viewBox="0 0 1 1" preserveAspectRatio="none">
        <rect width="1" height="1" fill={BG}>
          <animate
            attributeName="opacity"
            values="1;1;0"
            keyTimes="0;0.8;1"
            dur="1.8s"
            fill="freeze"
          />
        </rect>
      </svg>

      {/* viewBox の外は描画されないので、矢印は飛ばすだけで消える（フェード不要） */}
      <svg className="flow-intro-svg" viewBox="0 0 100 100">
        {/* 抜け：完成した矢印を右上へ加速させて viewBox の外へ出す。
            線の「流れ出る」動き（下の dashoffset）と重なることで、
            描画の反復ではなく“出ていく”動作として読める */}
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`0 0;0 0;${EXIT}`}
            keyTimes={`0;${T_HOLD};1`}
            calcMode="spline"
            keySplines="0 0 1 1;0.55 0 1 0.45"
            dur={DUR}
            begin={BEGIN}
            fill="freeze"
          />

          {/* 線：pathLength=1 に対し dash=1/gap=1。dashoffset を
                1 → 0 : 尾から先端へ引かれる（描画）
                0 → 0 : ため
                0 → -1: 尾の側から消え、波が先端へ流れ出る（抜け）
              透明度は一切変えず、動きだけで出入りさせる */}
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
              keyTimes={`0;${T_DRAWN};${T_HOLD};1`}
              calcMode="spline"
              keySplines="0.65 0 0.35 1;0 0 1 1;0.55 0 1 0.45"
              dur={DUR}
              begin={BEGIN}
              fill="freeze"
            />
          </path>

          {/* 矢じり：線が届く頃に現れる。移動はグループ側に任せる */}
          <path
            d={HEAD}
            fill="#fff"
            stroke="#fff"
            strokeWidth={4}
            strokeLinejoin="round"
            opacity={0}
          >
            <animate
              attributeName="opacity"
              values="0;0;1;1"
              keyTimes="0;0.36;0.46;1"
              dur={DUR}
              begin={BEGIN}
              fill="freeze"
            />
          </path>
        </g>
      </svg>
    </div>
  );
}
