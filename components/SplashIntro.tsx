// 起動時の導入アニメーション。
// OS のスプラッシュ（同じ背景色 #dceef8）から途切れず続けて、白い矢印が
// 左下から波を描いて現れ、Flow アイコンの形になり、その波がそのまま
// 右上へ流れ出ていく。「描く」のも「抜ける」のも波が線をなぞる同じ動き。
//
// 【JS を使わない】"use client" を付けず、サーバーが返す HTML に最初から含める。
// 起動時の JS を 1 バイトも増やさず、ハイドレーション前から動く。
//
// 【動きは SMIL（SVG 組み込み）で書く】CSS アニメーションではなく SMIL なのは、
// スタイルシートの再適用に左右されず、JS も要らないため。
//
// 【抜けは「線をなぞって流れ出る」】矢印ごと右上へ平行移動させる案も試したが、
// 波打つ質感が失われ、動きとして読めなくなったため戻した。抜けは dashoffset
// だけで行い、線は自分の形をなぞって先端から流れ出ていく。
//
// 【「くり返し」に見せないための緩急】以前この抜けが「2回」「1回半」に見えた
// のは、描画と抜けがほぼ同じ速さで、どちらも白が左下→右上へ動くため、抜けが
// 2 回目の描画に見えていたから（発火は 1 回であることは計測で確認済み。
// 技術的な二重再生ではなく見え方の問題だった）。そこで
//   - ため を短くして、描画から抜けまでを一続きの動作に感じさせる
//   - 抜けを描画より明確に速くする（約 600ms に対して約 380ms）
// とし、「波が通り抜けた」一連の動きとして読めるようにしている。
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

// 矢じり（右上）。弾んで現れる動きを「その場で」拡大させたいので、
// 図形の中心を原点に置いた座標で持ち、外側の <g> で本来の位置へ移す。
// （SMIL の scale は原点基準で、CSS の transform-origin が使えないため）
/** 矢じりの本来の中心（bbox の中心） */
const HEAD_CX = 71.5;
const HEAD_CY = 31.25;
/** 中心を原点に移した矢じり。元は M 61 30 L 79.5 20.5 L 82 42 Z */
const HEAD = "M -10.5 -1.25 L 8 -10.75 L 10.5 10.75 Z";

const BG = "#dceef8";
const BEGIN = "0.06s";
/** 描画→ため→抜け までの長さ */
const DUR = "1.05s";
// 区切り（DUR に対する割合）
//   0    →0.57 描画（尾から先端へ引かれる。約600ms）
//   0.57 →0.64 ため（約70ms。ここで Flow アイコンの形になる）
//   0.64 →1    抜け（波が先端から流れ出る。約380ms＝描画より速い）
const T_DRAWN = 0.57;
const T_HOLD = 0.64;

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
            keyTimes="0;0.81;1"
            dur="1.37s"
            fill="freeze"
          />
        </rect>
      </svg>

      {/* viewBox の外は描画されないので、矢じりは飛ばすだけで消える */}
      <svg className="flow-intro-svg" viewBox="0 0 100 100">
        {/* 線：pathLength=1 に対し dash=1/gap=1。dashoffset を
              1 → 0 : 尾から先端へ引かれる（現れる）
              0 → 0 : ため
              0 → -1: 尾の側から引き上げられ先端から流れ出る（消える）
            と続けて動かすと、逆再生ではなく一本の波が通り抜けたように見える。
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
            keySplines="0.65 0 0.35 1;0 0 1 1;0.55 0 0.35 1"
            dur={DUR}
            begin={BEGIN}
            fill="freeze"
          />
        </path>

        {/* 矢じり：線が届く頃に弾んで現れ、波が流れ出るのに合わせて右上へ抜ける */}
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0;0 0;14 -14"
            keyTimes={`0;${T_HOLD};1`}
            calcMode="spline"
            keySplines="0 0 1 1;0.55 0 0.35 1"
            dur={DUR}
            begin={BEGIN}
            fill="freeze"
          />
          <g transform={`translate(${HEAD_CX} ${HEAD_CY})`}>
            {/* その場で弾ませる。SMIL の keySplines は制御点が 0..1 に限られ、
                CSS のバネ曲線(y>1)が書けないので、1.06 まで行き過ぎて 1 に
                戻るキーフレームで同じ「弾み」を出している */}
            <g>
              <animateTransform
                attributeName="transform"
                type="scale"
                values="0.5;0.5;1.06;1;1"
                keyTimes="0;0.47;0.57;0.63;1"
                calcMode="spline"
                keySplines="0 0 1 1;0.25 0 0.35 1;0.45 0 0.55 1;0 0 1 1"
                dur={DUR}
                begin={BEGIN}
                fill="freeze"
              />
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
                  values="0;0;1;1;0"
                  keyTimes={`0;0.47;0.6;${T_HOLD};1`}
                  dur={DUR}
                  begin={BEGIN}
                  fill="freeze"
                />
              </path>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
