"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDevice } from "@/lib/useDevice";

// paint 前に DOM を合わせ直したい（再レンダーで位置が飛ぶのを防ぐ）。SSR では
// useLayoutEffect が警告を出すので、サーバーでは useEffect にフォールバック。
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  /** ボタンの配色クラス（背景色など） */
  className: string;
  /** 実行後も行を開いたままにする。削除のように、行そのものが
   *  アニメーションで消える場合に使う（閉じ戻りと動きがぶつかるため） */
  keepOpen?: boolean;
  onClick: () => void;
}

const ACTION_WIDTH_NORMAL = 96; // 1アクションあたりの幅(px)
const ACTION_WIDTH_COMPACT = 64; // 背の低い行（フォルダ一覧）向けの詰めた幅
// アクションが出現し始めるまでの「遊び」（開き割合 rr のうち、この割合ぶんは
// まだ出さない）。指を引き始めてすぐには出さず、少し引いてからせり上がらせる。
// 0〜1。大きいほど出現が遅れる。全ボタン一律に遅らせる（相対的な段差は保つ）。
const ACTION_REVEAL_LEAD = 0.16;
const LEAD_WIDTH = 192; // 右スワイプで出るリーディングアクション（ピン留め）の幅。横長。
// 右へ「振り切った（行幅分いっぱいまでスワイプ）」とみなす割合。
const LEAD_COMMIT_RATIO = 0.9;
// ピン留めを「確定」させる右フリックの速度しきい値(px/ms)。距離が振り切りに
// 満たなくても、これ以上の速さで右にはじけば確定する（素早く短いフリックに対応）。
// FLICK_VELOCITY(=ボタンを開くだけ) より高くし、意図的な速いフリックのみ確定させる。
const LEAD_COMMIT_VELOCITY = 1.2;
// ただし速度だけでは確定させず、最低限これだけは引いていることを要求する（行幅比）。
// 速いスワイプで浅いうちに確定してしまうのを防ぐための下限。
const LEAD_COMMIT_MIN_RATIO = 0.55;

// 横方向の意図を判定する不感帯(px)。これを超えるまでは反応しない。
// 小さいほど動き出しが早く感じる。縦スクロールを奪わない範囲でなるべく小さく。
const AXIS_DEADZONE = 4;
// フリック判定の速度しきい値(px/ms)。これ以上の速さで離すと距離が足りなくても開閉。
const FLICK_VELOCITY = 0.3;
// 速度を計測する時間窓(ms)。「指を離す直前」の実移動量から算出する。
// EWMA だと短く速いフリックでサンプル数が足りず速度を大幅に過小評価してしまい、
// フリックと判定されない → 距離も閾値未満 → リストへ戻る（＝スライド方向と逆に
// 動いて見える）ため、直近ウィンドウの実移動量方式にしている。
const VELOCITY_WINDOW_MS = 100;
// 指を離した後の収束バネ。減衰比 ζ = c / (2√k) ≈ 0.81（狙い 0.75〜0.85）にして、
// わずかに行き過ぎてから吸い付く「バネ感」を残す（等速的な ease 系にはしない）。
const SPRING_K = 260;
const SPRING_C = 26;
// 行き過ぎ（オーバーシュート）の上限(px)。跳ね返りは見せたいが、大きいと反対側の
// ボタンやアクション群の外側の隙間が見えてしまうので「わずかな跳ね返り」に留める。
const OVERSHOOT_MAX = 12;

// --- トラックパッド(2本指スクロール) ---
const WHEEL_SENSITIVITY = 0.4;
const WHEEL_AXIS_RATIO = 1.5;
const WHEEL_START_PX = 30;
// 操作終了とみなすまでの「保険」の待ち時間。トラックパッドには touchend に
// あたるイベントが無いための代用だが、これを固定時間として待つと、指を離した後に
// content が目標へ追いついて静止 → この時間まで待つ → スナップ、という「追いついて
// 止まる → 待つ → 飛ぶ」が必ず入り、境界付近で一瞬固まって見えた（実測で約57ms）。
// そこで通常の終了判定は WHEEL_SETTLE_QUIET_MS 側（追従ループ内で、追いついた瞬間に
// スナップ開始）で行い、こちらはループが回っていない等の保険としてだけ残す。
const WHEEL_IDLE_MS = 90;
// 追従ループ内での「操作が終わった」判定。最後に wheel が届いてからこの時間が過ぎたら、
// content が目標に追いついているかを待たずに、その瞬間の速度のままバネへ引き継ぐ。
// 「追いつかせて一度止める → 待つ → 再加速」の速度の谷（実測で毎回 age≈48ms のところで
// content がほぼ停止していた）を無くすのが狙い。まだ滑っている途中で渡すことで、
// ドラッグの動きがそのままスナップへ流れる（速度が途切れない＝引っ掛かりが消える）。
// 短いほど滑らかだが、短すぎると操作途中の一瞬の間を終了と誤判定する。実測の入力間隔は
// ペア＋14〜17ms なので、30ms（2フレーム相当）あれば途中の間では発火しない。
const WHEEL_SETTLE_QUIET_MS = 30;
// 速度を「操作終了時の値」として信用できる時間(ms)。wheel には離した瞬間が無く、
// 入力が途切れた後も最後に測った速度が残り続ける。そのまま使うと、指を止めてから
// かなり経っているのにフリック扱いになり、開閉の判定がひっくり返ったうえ、バネに
// 大きな初速が入って弾かれる（実測で 361ms 後に v=2.1px/ms が使われていた）。
// 経過時間に比例して速度を弱め、この時間を過ぎたら 0 とみなす。
// 終了判定を 30ms まで速めたので、通常はほとんど減衰しない（30ms で 0.93）。ここは
// 主に保険タイマー(90ms)経由や入力に穴が空いた場合の陳腐化対策として残す。
const WHEEL_VELOCITY_GRACE_MS = 400;
// トラックパッドのみに掛ける追従率（1フレームあたり）。
// タッチの touchmove は画面のリフレッシュに同期して届くので 1:1 で滑らかだが、
// wheel はイベントの来ないフレームが生まれ得るため、毎フレーム目標値へ少しずつ
// 寄せることで、イベントの無いフレームも中間位置が描かれて滑らかになる。
// 実測ではこの端末の wheel は十分な頻度で届くので、平滑化は主に「指との遅れ」を決める。
// 高いほど指に張り付き、離した時点で content が finger 位置にほぼ乗っているため、
// バネへ渡す位置・速度が finger の意図どおりになる。0.8 で遅れはごく僅か。
const WHEEL_SMOOTHING = 0.8;

// --- トラックパッドで「指が離れた瞬間」を見つける（touchend の代わり） ---
//
// タッチには指を離した瞬間（touchend）があり、そこで即スナップできる。wheel には
// それが無いうえ、Windows の精密タッチパッドは指を離した後も OS/ブラウザが
// 慣性ぶんのスクロールを自動で作って送り続ける。そのため「入力が途切れたら終わり」
// という判定では、慣性が止まるまで（数百 ms〜1 秒）ずっと引かれ続けてしまう。
//
// ただし慣性には見分けがつく特徴がある：向きが変わらず、1 イベントごとに
// 必ず少しずつ小さくなっていく。人の指は、同じ速さで動かし続けたり、速くしたり、
// ばらついたりするので、これが何十msも途切れずに続くことはまず無い。
// 「小さくなり続けている時間」がしきい値を超えた時点を「指が離れた」とみなし、
// タッチの touchend とまったく同じ処理（その時の速度を引き継いでスナップ）へ
// 入る。以降の慣性は捨てる。判定が外れて実は指が動いていた場合は、減り方が
// 崩れた次のイベントですぐ操作へ戻る（下の wheelFlingRef の扱いを参照）。
//
// しきい値を短くするほど「指を離してから止まるまで」が短くなるが、短すぎると
// 指で減速しているだけの場面を離したと誤判定する。60ms は、実測の入力間隔
// （ペア＋14〜17ms）で 4〜7 イベントぶんにあたる。
const FLING_DECAY_MS = 60;
const FLING_MIN_EVENTS = 3; // 時間だけでなくイベント数も要求する（穴の保険）
// 1 イベントあたりの減り方。上限は 1.0 未満にすること。1.0 を許すと「一定の
// 速さで動かし続けている指」（毎回まったく同じ量）まで慣性と見なしてしまい、
// スワイプの途中で勝手にスナップしてしまう。必ず「減っている」ことを求める。
const FLING_RATIO_MAX = 0.99;
const FLING_RATIO_MIN = 0.55; // 一気に小さくなるのは指を止めた動き（慣性ではない）
const FLING_MIN_DELTA = 2; // 小さすぎる値は比が暴れるので判定に使わない
// 慣性と分かった時点で、指はもう離れている。タッチと違って「離した瞬間の勢いの
// まま滑る」感じは、指がパッドから離れた後に起きるので気持ちよさに繋がらず、
// 止まるまでが長いという不満だけが残る。そこでバネへ渡す初速はごくわずかに
// 留め、離した位置からすっと収まるようにする（開く/戻すの判定には、弱めていない
// 本来の速度を使うので、フリックの効き方は変わらない）。
const FLING_VELOCITY_SCALE = 0.15;
// 慣性を捨てている最中に「人が触った」と判断する増え方。端数の丸めで同じ値が
// 並んだり、少しだけ増えたりすることがあるので、少し余裕を持たせる。
const FLING_KEEP_RATIO_MAX = 1.15;

/** 直前のイベントと比べた減り方（同じ向きで小さくなっていれば比を返す） */
function deltaRatio(cur: number, prev: number): number | null {
  if (prev === 0 || Math.sign(cur) !== Math.sign(prev)) return null;
  const a = Math.abs(prev);
  const b = Math.abs(cur);
  if (a < FLING_MIN_DELTA || b < FLING_MIN_DELTA) return null;
  return b / a;
}

// 開いている行は常に1つだけ。別の行で横スワイプが始まったら前の行を閉じる。
const openRegistry: { close: (() => void) | null } = { close: null };


// フル表示幅を超えて引いたぶんの抵抗（ラバーバンド）。
//   実際の移動量 = フル表示幅 + 超過量 / (1 + 超過量 / 画面幅)
// 引くほど重くなり、画面幅ぶん引いても超過は半分までしか進まない。
function rubberBand(over: number, screenW: number) {
  return over / (1 + over / Math.max(1, screenW));
}

// アクションのせり上がりに使う「実効の開き割合」。頭に ACTION_REVEAL_LEAD ぶんの
// 遊びを設け、そこを過ぎてから 0→1 へ進める（全ボタン一律に出現を遅らせる。相対的な
// 段差は保つ）。rr=1 では必ず 1 に達するので、開ききった時は従来どおり完全に出そろう。
function revealRatio(rr: number) {
  if (rr <= ACTION_REVEAL_LEAD) return 0;
  return (rr - ACTION_REVEAL_LEAD) / (1 - ACTION_REVEAL_LEAD);
}

// 振り切りの合図（対応端末のみ・iOS は無視される）。
function fireHaptic() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(10);
    } catch {
      /* no-op */
    }
  }
}

// 左スワイプで右側にアクション、右スワイプで左側にリーディングアクション（ピン留め）を
// 表示する行（⑥）。
//
// パフォーマンス方針：ドラッグ中・バネ収束中は React の state を更新せず、ref で
// 直接 DOM の style を書き換える（再レンダーを介さないので指に遅れない）。React の
// state（restOffset）は静止位置の同期用にだけ使い、プロップ変化などで再レンダーが
// 起きても正しい位置で描けるようにする。offsetWidth の読み取りはジェスチャー開始時に
// 1回だけキャッシュし、touchmove 内での read/write 往復を無くす。
export default function SwipeRow({
  actions,
  children,
  disabled = false,
  className = "",
  compact = false,
  contentClassName = "bg-white",
  leadingAction,
}: {
  actions: SwipeAction[];
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  contentClassName?: string;
  leadingAction?: SwipeAction;
}) {
  const { isTouch } = useDevice();
  // 静止位置（0 / leadWidth / -openWidth）。再レンダー時の初期 style に使う。
  const [restOffset, setRestOffset] = useState(0);

  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const trailWrapRef = useRef<HTMLDivElement>(null);
  const leadWrapRef = useRef<HTMLDivElement>(null);
  const leadBtnRef = useRef<HTMLButtonElement>(null);
  const actionBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const offsetRef = useRef(0); // 現在位置。ドラッグ中は指の座標そのもの。
  // 直近で「収まった」位置（0 / -openWidth / leadWidth）。開閉のルール判定はこれを
  // 基準にする。ドラッグの起点（1:1 の原点）とは役割が違うので必ず分けて持つこと。
  // アニメーション途中の座標を基準にしてしまうと、「開いていた/閉じていた」の判定が
  // 意味を失い、しきい値付近で開く/戻すがブレる。
  const restPosRef = useRef(0);
  const draggingRef = useRef(false);
  const committingRef = useRef(false); // 振り切りゾーンに入っているか
  const rafRef = useRef<number | null>(null); // バネの rAF id
  const screenWidthRef = useRef(0); // ラバーバンド計算用の画面幅
  const start = useRef({ x: 0, y: 0, base: 0 });
  const axis = useRef<"none" | "x" | "y">("none");
  const samplesRef = useRef<{ x: number; t: number }[]>([]); // 速度算出用の位置履歴
  const lastVelRef = useRef(0); // 直近の指/トラックパッド速度(px/ms)。フリック判定に使う
  const rowWidthRef = useRef(0); // ジェスチャー開始時にキャッシュした行幅
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelAccum = useRef(0);
  // ジェスチャーが始まっているか。位置ではなくこのラッチで見る（位置が 0 に
  // 張り付いた瞬間に抜けてしまうのを防ぐ）。idle で false に戻す。
  const wheelEngagedRef = useRef(false);
  // 最後に wheel が届いた時刻。速度をどれだけ信用するかの判断に使う。
  const wheelLastEventTRef = useRef(0);
  // 「指を離した後の慣性」の見分け用。直前の deltaX と、小さくなり続けている
  // 区間の始まり（時刻・イベント数）。
  const wheelLastDeltaRef = useRef(0);
  const wheelShrinkStartRef = useRef(0);
  const wheelShrinkCountRef = useRef(0);
  // 「慣性かもしれない」区間で、まだ行へ反映していない移動量。
  // 慣性と確定したら捨て（＝指を離した位置から戻り始める）、人の指だったと
  // 分かったら、そのぶんをまとめて反映して追いつかせる。
  const wheelHeldRef = useRef(0);
  // 慣性とみなして入力を捨てている最中か（＝指はもう離れている、という想定）。
  const wheelFlingRef = useRef(false);
  // 追従ループから「操作終了→スナップ」を呼ぶための控え（定義は後段）。
  const endWheelGestureRef = useRef<(fling?: boolean) => void>(() => {});
  const wheelBaseRef = useRef(0); // wheel ジェスチャー開始時の位置（反対側へ越えさせない判定用）
  // wheel は「差分」でしか届かないので、生の積算値と、それに壁/抵抗を適用した
  // 目標値を分けて持つ。減衰後の値を次の計算に入れ直すと抵抗が二重三重に掛かり、
  // スクロールしているのに進まない（＝カクつく）ため。
  const wheelRawRef = useRef(0);
  const wheelTargetRef = useRef(0);
  const leadingActionRef = useRef(leadingAction);
  leadingActionRef.current = leadingAction;
  // 直前に書いた値。同じ値の書き込み（＝無駄なレイアウト/再描画）を避けるため。
  const lastTrailW = useRef(-1);
  const lastLeadW = useRef(-1);
  const lastCommit = useRef<boolean | null>(null);

  const actionWidth = compact ? ACTION_WIDTH_COMPACT : ACTION_WIDTH_NORMAL;
  const openWidth = actions.length * actionWidth;
  const leadWidth = LEAD_WIDTH;

  // 現在位置 x を DOM に直接反映する（content の transform、左右アクションの拡大/不透明度、
  // 振り切りゾーンの合図）。再レンダーを介さない。
  const nActions = actions.length;
  function applyOffset(x: number) {
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${x}px)`;
    }
    // アクション領域はスワイプ量に合わせて広がる。ボタンが出そろった後も指と一緒に
    // 動き続けられるようにするため（ここで止めると、ボタンが出た瞬間に動きが
    // 止まって見える）。広がったぶんは一番左のボタンが吸収する。
    // width の書き換えはレイアウトを伴うので、変化したときだけ書く。
    const trailW = Math.max(openWidth, -x);
    if (trailWrapRef.current && lastTrailW.current !== trailW) {
      lastTrailW.current = trailW;
      trailWrapRef.current.style.width = `${trailW}px`;
    }
    // 左スワイプ（右側アクション）：右端が先に、手前ほど後にせり上がる
    const rr =
      openWidth > 0 ? revealRatio(Math.min(1, Math.max(0, -x) / openWidth)) : 0;
    for (let i = 0; i < nActions; i++) {
      const btn = actionBtnRefs.current[i];
      if (!btn) continue;
      const p = Math.max(0, Math.min(1, nActions * rr - (nActions - 1 - i)));
      btn.style.transform = `scale(${0.2 + 0.8 * p})`;
      btn.style.opacity = String(p);
    }
    // 右スワイプ（左側リーディング＝ピン留め）
    const leadW = Math.max(leadWidth, x);
    if (leadWrapRef.current && lastLeadW.current !== leadW) {
      lastLeadW.current = leadW;
      leadWrapRef.current.style.width = `${leadW}px`;
    }
    if (leadBtnRef.current) {
      const lr = leadWidth > 0 ? Math.min(1, Math.max(0, x) / leadWidth) : 0;
      const commit = committingRef.current;
      leadBtnRef.current.style.transform = `scale(${
        (0.2 + 0.8 * lr) * (commit ? 1.12 : 1)
      })`;
      leadBtnRef.current.style.opacity = String(lr);
      // filter は再描画を誘発しやすいので、切り替わった時だけ書く。
      if (lastCommit.current !== commit) {
        lastCommit.current = commit;
        leadBtnRef.current.style.filter = commit
          ? "brightness(1.18) saturate(1.35)"
          : "none";
      }
    }
  }
  // 最新の applyOffset を安定した参照（ループ/バネ/レイアウト効果）から呼ぶための控え。
  const applyOffsetRef = useRef(applyOffset);
  applyOffsetRef.current = applyOffset;

  // 位置サンプルを記録し、直近 VELOCITY_WINDOW_MS の実移動量から速度を更新する。
  // 「指を離す直前の速度」を正しく取るための要（短く速いフリックでもサンプルが
  // 1〜2 個あれば正しい速度が出る）。指を止めてから離した場合はウィンドウ内の
  // 移動量が 0 になるので速度も 0 になり、距離での判定に自然に切り替わる。
  const resetSamples = useCallback((x: number) => {
    samplesRef.current = [{ x, t: performance.now() }];
    lastVelRef.current = 0;
  }, []);

  const pushSample = useCallback((x: number) => {
    const now = performance.now();
    const s = samplesRef.current;
    s.push({ x, t: now });
    // ウィンドウ外のサンプルは 1 つだけ残して捨てる（dt=0 を避ける保険）。
    while (s.length > 2 && now - s[1].t > VELOCITY_WINDOW_MS) s.shift();
    const last = s[s.length - 1];
    let first = s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (last.t - s[i].t <= VELOCITY_WINDOW_MS) first = s[i];
      else break;
    }
    // ウィンドウ内が 1 点しか無い（＝直前に長い静止があった）ときは 1 つ前を使う。
    if (first === last && s.length >= 2) first = s[s.length - 2];
    const dt = last.t - first.t;
    lastVelRef.current = dt > 0 ? (last.x - first.x) / dt : 0;
  }, []);

  // 操作中フラグ。触れた時点で立てておくことで、ボタンが実際に見え始める前に
  // 合成レイヤーを用意させる（初回ラスタライズをスワイプ中に起こさせない）。
  // 再レンダーを挟まないよう classList を直接触る。
  const setActive = useCallback((on: boolean) => {
    rowRef.current?.classList.toggle("flow-swipe-active", on);
  }, []);

  // 慣性の見分けを最初の状態に戻す（別の操作として見直すとき）。
  const resetFlingDetect = useCallback(() => {
    wheelLastDeltaRef.current = 0;
    wheelShrinkStartRef.current = 0;
    wheelShrinkCountRef.current = 0;
    wheelFlingRef.current = false;
  }, []);

  // 保留していた移動量を行へ反映する（＝指の動きだった場合の追いつき）。
  // 定義は下（clampPosition などが要る）。ここは呼び出し用の控え。
  const flushHeldRef = useRef<() => void>(() => {});

  // 入力が完全に途切れたときの後始末（保険）。慣性の見分けもここで初期化する。
  const armWheelIdle = useCallback(() => {
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => {
      resetFlingDetect();
      endWheelGestureRef.current();
    }, WHEEL_IDLE_MS);
  }, [resetFlingDetect]);

  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // 「指/トラックパッドが示した生の位置」に壁と抵抗を適用して実際の位置を出す。
  // touch と wheel で必ず同じ規則になるよう共通化する（トラックパッドでも
  // iPad と同じ動き・同じ手応えにするため、ここに端末ごとの分岐は置かない）。
  // 入力は常に生の値を渡すこと（抵抗を掛けた後の値を再入力すると、抵抗が
  // 重ねがけになって動きが詰まる）。
  const clampPosition = useCallback(
    (raw: number, base: number) => {
      let next = raw;
      const rowW = rowWidthRef.current;
      const screenW = screenWidthRef.current;
      // 開いていた状態からのスワイプは反対側へ越えさせない（0 でクランプ）。
      // ＝1回のスライドでは「リストへ戻る」までで、反対側のボタンは出さない。
      if (base < 0 && next > 0) next = 0;
      if (base > 0 && next < 0) next = 0;
      if (leadingActionRef.current) {
        // ピン留めがある行：行幅までは指と同じ速さで動かし、そこで止める。
        if (next > rowW) next = rowW;
      } else if (next > 0) {
        // 出すものが無い方向。動かないことを伝えるため抵抗だけ残す。
        next = rubberBand(next, screenW);
      }
      // アクション側は、ボタンが出そろった後も指と同じ速さで動き続ける。
      // ここに壁を置くと（減速でも停止でも）ボタンが出た瞬間に引っかかって見える。
      // アクション領域が一緒に広がるので隙間はできない。抵抗は行幅を超えてから。
      const maxLeft = Math.max(openWidth, rowW);
      if (next < -maxLeft) {
        next = -(maxLeft + rubberBand(-next - maxLeft, screenW));
      }
      return next;
    },
    [openWidth],
  );

  // 生の積算値（wheel 専用）に「硬い壁」だけを適用する。
  //
  // タッチは毎回「指の絶対座標」から位置を作り直すので、壁に押し付けたまま
  // 引き返せば即座に戻る。いっぽう wheel は差分の足し算なので、壁の先へも
  // 足され続けると、引き返しても「行き過ぎたぶんを戻しきるまで動かない」
  // 空振り区間ができる。そこで、それ以上動かない場所（硬い壁）まで来たら
  // 積算値もそこで止める。ラバーバンド（＝じわじわ動く範囲）は引き返せば
  // すぐ反応するので、タッチと同じ手応えを残すためそのままにする。
  const clampRawToWalls = useCallback((raw: number, base: number) => {
    let next = raw;
    if (base < 0 && next > 0) next = 0;
    if (base > 0 && next < 0) next = 0;
    if (leadingActionRef.current && next > rowWidthRef.current) {
      next = rowWidthRef.current;
    }
    return next;
  }, []);

  // 保留していた移動量（慣性かもしれないと様子を見ていたぶん）を行へ反映する。
  const flushHeld = useCallback(() => {
    if (wheelHeldRef.current === 0) return;
    wheelRawRef.current = clampRawToWalls(
      wheelRawRef.current + wheelHeldRef.current,
      wheelBaseRef.current,
    );
    wheelHeldRef.current = 0;
    const next = clampPosition(wheelRawRef.current, wheelBaseRef.current);
    wheelTargetRef.current = next;
    pushSample(next);
  }, [clampPosition, clampRawToWalls, pushSample]);
  flushHeldRef.current = flushHeld;

  // ドラッグ中の 1:1 追従。イベント内でそのまま transform を書く（rAF を挟むと
  // 次フレームまで書き込みが遅れて指から離れて見えるため挟まない。ブラウザは
  // paint 時に最後の値だけ描くので、書き込みが多発しても実質フレーム集約になる）。
  // ボタンの不透明度・拡大も applyOffset が同じ位置から補間するので、指の位置と
  // 見た目は常に同期する（時間ベースのフェードは使わない）。
  const moveTo = useCallback((x: number) => {
    offsetRef.current = x;
    applyOffsetRef.current(x);
    // 振り切りゾーンの出入りを監視し、またいだ瞬間だけ合図を出す。
    if (leadingActionRef.current && x > 0) {
      const inZone = x >= rowWidthRef.current * LEAD_COMMIT_RATIO;
      if (inZone !== committingRef.current) {
        committingRef.current = inZone;
        if (inZone) fireHaptic();
      }
    } else if (committingRef.current) {
      committingRef.current = false;
    }
  }, []);

  // トラックパッド専用の補間ループ。wheel はイベントの来ないフレームがあるため、
  // 毎フレーム目標値へ寄せて中間位置を描く（タッチは 1:1 のままでここは通らない）。
  const startWheelLoop = useCallback(() => {
    if (rafRef.current != null) return;
    let last = performance.now();
    const step = (now: number) => {
      let dt = now - last;
      last = now;
      if (dt <= 0) dt = 16.6667;
      if (dt > 40) dt = 40;
      // 実 fps に依らず一定の追従率になるよう dt で正規化する。
      const alpha = 1 - Math.pow(1 - WHEEL_SMOOTHING, dt / 16.6667);
      const target = wheelTargetRef.current;
      let x = offsetRef.current + (target - offsetRef.current) * alpha;
      if (Math.abs(target - x) < 0.1) x = target;
      moveTo(x);
      // 操作終了の判定はここで行う（固定時間のタイマーを待たない）。最後の入力から
      // 一定の間が空いたら、目標へ追いつくのを待たず、その瞬間の位置・速度のまま
      // バネへ渡す。「追いつかせて一度止める → 待つ → 再加速」の速度の谷を無くし、
      // ドラッグの動きがそのままスナップへ流れるようにする。
      // active dragging 中は毎フレーム wheel が届いていて quiet が伸びないので発火しない。
      const quiet = now - wheelLastEventTRef.current;
      if (quiet >= WHEEL_SETTLE_QUIET_MS) {
        endWheelGestureRef.current();
        return; // ループはここで終了（settle→spring が新しい rAF を張る）
      }
      rafRef.current = draggingRef.current ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
  }, [moveTo]);

  const springToRef = useRef<(target: number, v0?: number) => void>(() => {});
  const closeSelf = useCallback(() => {
    committingRef.current = false;
    springToRef.current(0, 0);
  }, []);

  // 指を離した後の収束（バネ）。リリース直前の指の速度 v0(px/ms) をそのまま初速と
  // して渡す（静止状態から始めない）ので、慣性移動 → 着地が 1 つの連続した動きに
  // なる。毎フレーム DOM を直接書き換え、静止したときだけ state を同期する。
  // 途中で触れれば offsetRef から現在位置を拾って追従再開できる。
  const springTo = useCallback(
    (target: number, v0 = 0) => {
      cancelRaf();
      draggingRef.current = false;
      // 「開く/戻す」はこの関数が呼ばれた時点で確定している。バネはその結果を
      // 見せるだけのアニメーションなので、ルール判定の基準（静止位置）はここで
      // 確定させる。収束しきるまで前の位置を指したままにすると、バネの最中に
      // 触られたときに「もう決まっている行き先」と食い違う基準で判定してしまい、
      // 反対側クランプの壁に当たって動かなくなる。
      restPosRef.current = target;
      let x = offsetRef.current;
      let v = v0 * 1000; // px/ms -> px/s
      // どちら側から target へ向かうか。行き過ぎ（跳ね返り）はこの逆側に出る。
      const fromSign = Math.sign(x - target);
      let last = performance.now();
      const step = (now: number) => {
        let dt = (now - last) / 1000;
        last = now;
        if (dt > 0.032) dt = 0.032;
        const a = -SPRING_K * (x - target) - SPRING_C * v;
        v += a * dt;
        x += v * dt;
        // target を越えた行き過ぎは「わずかな跳ね返り」に制限する。
        // （制限しないと、速いフリックで反対側のボタンや隙間が見えてしまう）
        if (fromSign !== 0 && Math.sign(x - target) === -fromSign) {
          const limit = target - fromSign * OVERSHOOT_MAX;
          if (Math.abs(x - target) > OVERSHOOT_MAX) {
            x = limit;
            v = 0;
          }
        }
        // 収束の打ち切り。最後の 1px 前後は、見た目には止まって見えるのに
        // バネの計算だけが続く「尾」で、ここを厳しくすると（0.5px/8px･s など）
        // 止まってから静止扱いになるまでに 70ms ほど余分にかかる。目で分から
        // ない範囲まで緩めて、その尾を切る（残りは下で目標値へ合わせる）。
        if (Math.abs(x - target) < 1.2 && Math.abs(v) < 60) {
          rafRef.current = null;
          offsetRef.current = target;
          restPosRef.current = target; // 確定は springTo 開始時。ここは念のため
          applyOffsetRef.current(target);
          setActive(false); // 静止したらレイヤーを解放する
          setRestOffset(target); // 再レンダー時の初期 style を合わせる
          if (target === 0 && openRegistry.close === closeSelf) {
            openRegistry.close = null;
          }
          return;
        }
        offsetRef.current = x;
        applyOffsetRef.current(x);
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancelRaf, closeSelf, setActive],
  );
  springToRef.current = springTo;

  const beginOpen = useCallback(() => {
    if (openRegistry.close && openRegistry.close !== closeSelf) {
      openRegistry.close();
    }
    openRegistry.close = closeSelf;
  }, [closeSelf]);

  // 指/トラックパッドを離した/止めたときのスナップ判定（touch・wheel 共通）。
  // base=ジェスチャー開始位置, pos=最終位置（1:1 追従なので指の座標そのもの）,
  // v=リリース直前の速度。距離と速度のハイブリッドで開閉を決め、その速度を
  // そのままバネの初速として渡す。
  // 開いていた状態からは反対側を出さず必ずリストへ戻す。
  // springV は「バネに渡す初速」。通常は v と同じだが、トラックパッドで慣性を
  // 検知して終わらせる場合だけ、惰性で進んだぶんを差し引いて弱めた値が来る
  // （開く/戻すの判定は、指の意図どおりになるよう v のままで行う）。
  const settle = (base: number, pos: number, v: number, springV = v) => {
    const rowW = rowWidthRef.current;
    const wasZone = committingRef.current;
    committingRef.current = false;

    if (base !== 0) {
      // 開いていた状態から：反対側へは越えられない（0 にクランプ済み）。閉じ方向へ
      // 少しでも動いた/フリックしたら必ずリストへ戻す。動きが小さければ元の開位置へ。
      const openLeft = base < 0;
      const towardClose = openLeft ? pos - base : base - pos; // 閉じ方向へ動いた量(px)
      const flickClose = openLeft ? v > FLICK_VELOCITY : v < -FLICK_VELOCITY;
      const openPos = openLeft ? -openWidth : leadWidth;
      springTo(towardClose > 20 || flickClose ? 0 : openPos, springV);
      return;
    }

    // 閉じた状態から：左右どちらへも開ける
    if (pos > 0) {
      const lead = leadingActionRef.current;
      // ピン留め確定：距離が振り切り閾値を超えた（or 振り切りゾーン滞在）か、
      // 距離が閾値未満でも速い右フリックなら確定。距離だけを唯一の条件にはしないが、
      // 速度側にも最低距離を課して、速いスワイプで浅いうちに確定しないようにする。
      if (
        lead &&
        (wasZone ||
          pos >= rowW * LEAD_COMMIT_RATIO ||
          (v >= LEAD_COMMIT_VELOCITY && pos >= rowW * LEAD_COMMIT_MIN_RATIO))
      ) {
        springTo(0, springV); // 振り切り/フリック → 実行してスナップで戻す
        lead.onClick();
        return;
      }
      let target: number;
      if (v > FLICK_VELOCITY) target = leadWidth;
      else if (v < -FLICK_VELOCITY) target = 0;
      else target = pos >= leadWidth / 2 ? leadWidth : 0;
      springTo(target, springV);
      return;
    }
    let target: number;
    if (v < -FLICK_VELOCITY) target = -openWidth;
    else if (v > FLICK_VELOCITY) target = 0;
    else target = pos <= -openWidth / 2 ? -openWidth : 0;
    springTo(target, springV);
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // wheel ジェスチャーの終了処理（追従ループの追いつき検知・保険のidleタイマー、
  // どちらから呼ばれても同じ。二重に走らないよう、既に終了していれば何もしない）。
  // 速度は「最後に入力が届いた時点」の値なので、そこからの経過時間ぶん弱めてから
  // スナップ判定に渡す（止めた操作がフリック扱いになるのを防ぐ）。
  // fling=true は「慣性を見つけて終わらせた」場合。指はすでに離れていて、
  // 検知までの時間ぶん惰性で進んでしまっているので、バネへ渡す初速だけ弱める
  // （惰性で進む＋満タンの勢いでバネ、と二重に効いて止まるまでが長くなるため）。
  const endWheelGesture = useCallback((fling = false) => {
    if (!draggingRef.current && !wheelEngagedRef.current) return;
    if (wheelTimer.current) {
      clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
    }
    wheelAccum.current = 0;
    wheelEngagedRef.current = false;
    draggingRef.current = false;
    // 様子見で溜めていたぶんの後始末。慣性なら「指を離した後の惰性」なので
    // 捨てる。そうでなければ指の動きなので、最後に反映してから判定する。
    if (fling) wheelHeldRef.current = 0;
    else flushHeldRef.current();
    const age = performance.now() - wheelLastEventTRef.current;
    const decay = Math.max(0, 1 - age / WHEEL_VELOCITY_GRACE_MS);
    const v = lastVelRef.current * decay;
    // 開始位置(base)を渡すことで、開いていた状態からのスクロールは必ずリストへ戻す。
    // 位置判定は補間の途中ではなく指示された到達点(target)で行う。バネの開始位置は
    // 表示中の offsetRef なので見た目は連続したまま。
    settleRef.current(
      wheelBaseRef.current,
      wheelTargetRef.current,
      v,
      fling ? v * FLING_VELOCITY_SCALE : v,
    );
  }, []);
  endWheelGestureRef.current = endWheelGesture;

  // 再レンダー後、DOM を現在の offsetRef に合わせ直す（ドラッグ/バネの最中に親が
  // 再レンダーしても位置が飛ばないための保険）。paint 前に実行。静止（0）なら
  // JSX の初期 style で正しいので書き込まない（一覧再レンダー時に全行へ書かない）。
  useIsoLayoutEffect(() => {
    if (offsetRef.current !== 0) applyOffsetRef.current(offsetRef.current);
  });

  useEffect(
    () => () => {
      cancelRaf();
      if (openRegistry.close === closeSelf) openRegistry.close = null;
    },
    [cancelRaf, closeSelf],
  );

  // 開いている間だけ、行の外側のタップで同じバネで閉じる（排他制御）。
  // 行の内側のタップは onClickCapture 側が閉じる担当。
  useEffect(() => {
    if (restOffset === 0) return;
    const onDocDown = (e: PointerEvent) => {
      const el = rowRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) closeSelf();
    };
    document.addEventListener("pointerdown", onDocDown, true);
    return () => document.removeEventListener("pointerdown", onDocDown, true);
  }, [restOffset, closeSelf]);

  // トラックパッドの横スクロール
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * WHEEL_AXIS_RATIO) return;
      e.preventDefault();

      const now = performance.now();
      const prevT = wheelLastEventTRef.current;
      // 前の入力から間が空いていたら、慣性の見分けは最初からやり直す
      // （別の操作なので、前の並びを引きずらせない）。
      if (now - prevT > WHEEL_IDLE_MS) resetFlingDetect();
      wheelLastEventTRef.current = now;

      // 直前のイベントと比べて「小さくなり続けている」かを見る。
      const ratio = deltaRatio(e.deltaX, wheelLastDeltaRef.current);
      const shrinking =
        ratio !== null && ratio <= FLING_RATIO_MAX && ratio >= FLING_RATIO_MIN;
      if (shrinking) {
        if (wheelShrinkStartRef.current === 0) {
          // 減り始めた「1つ前（＝いちばん速かった）」の時刻から数える。
          wheelShrinkStartRef.current = prevT || now;
          wheelShrinkCountRef.current = 1;
        } else {
          wheelShrinkCountRef.current += 1;
        }
      } else if (!wheelFlingRef.current) {
        wheelShrinkStartRef.current = 0;
        wheelShrinkCountRef.current = 0;
      }

      // 「指はもう離れている」とみなして慣性を捨てている最中。
      // 抜ける条件は「向きが変わった」か「急に大きくなった」＝人が触ったとき
      // だけにする。慣性の終わりぎわは移動量がとても小さくなるので、そこを
      // 「慣性ではない」と扱うと、消えかけの惰性で行がまた動き出してしまう。
      if (wheelFlingRef.current) {
        const prevDelta = wheelLastDeltaRef.current;
        const grew =
          prevDelta !== 0 &&
          (Math.sign(e.deltaX) !== Math.sign(prevDelta) ||
            Math.abs(e.deltaX) > Math.abs(prevDelta) * FLING_KEEP_RATIO_MAX + 1);
        wheelLastDeltaRef.current = e.deltaX;
        if (!grew) {
          armWheelIdle();
          return;
        }
        resetFlingDetect(); // 人が触った → 見分けをやり直して操作へ戻す
        wheelLastDeltaRef.current = e.deltaX;
      } else {
        wheelLastDeltaRef.current = e.deltaX;
      }

      // 小さくなり続けている時間が十分に続いたら、指はもう離れている。
      const isFling =
        wheelShrinkStartRef.current > 0 &&
        wheelShrinkCountRef.current >= FLING_MIN_EVENTS &&
        now - wheelShrinkStartRef.current >= FLING_DECAY_MS;

      wheelAccum.current += e.deltaX;
      // 一度始まったジェスチャーは、途切れる（idle）まで始まったままにする。
      // 位置で判定すると、clampPosition が位置をちょうど 0 に張り付かせた瞬間に
      // 抜けてしまい、入力が届いているのに目標が更新されない空白フレームが出る。
      const engaged =
        wheelEngagedRef.current || Math.abs(wheelAccum.current) > WHEEL_START_PX;

      if (engaged) {
        beginOpen();
        wheelEngagedRef.current = true;
        if (!draggingRef.current) {
          // ここはバネの途中で割り込むこともある。位置の起点（wheelRaw）は見た目の
          // 連続性のため現在位置にするが、開閉ルールの基準（wheelBase）は必ず
          // 「静止位置」にする。途中の座標を基準にすると、しきい値付近で
          // 開く/戻すの判定がブレて往復する。
          cancelRaf();
          draggingRef.current = true;
          wheelBaseRef.current = restPosRef.current; // ルール判定の基準＝静止位置
          wheelRawRef.current = offsetRef.current; // 生の積算はここから
          wheelTargetRef.current = offsetRef.current;
          wheelHeldRef.current = 0; // 前のジェスチャーの溜めを持ち越さない
          rowWidthRef.current = rowRef.current?.offsetWidth ?? 0;
          screenWidthRef.current = window.innerWidth || rowWidthRef.current;
          resetSamples(offsetRef.current);
          setActive(true);
          startWheelLoop();
        }
        // 移動量が小さくなり続けている（＝指を離した直後かもしれない）間は、
        // まだ行を動かさずに溜めておく。慣性だと確定したらこの溜めは捨てるので、
        // 行は「指を離した位置」から戻り始められる。溜めずに動かしてしまうと、
        // 慣性と分かるまでの間に行が余計に伸び、そのぶんバネの戻りも長くなる
        // （＝離してから止まるまでが目に見えて延びる）。
        // 指の動きだった場合は、崩れた時点でまとめて反映して追いつかせる。
        const rawDelta = -e.deltaX * WHEEL_SENSITIVITY;
        if (wheelShrinkCountRef.current >= 2) {
          wheelHeldRef.current += rawDelta;
        } else {
          // 生の積算値に足し込み、壁と抵抗は「生の値」に対して一度だけ適用する。
          // （減衰後の位置に足し込むと抵抗が重ねがけになり、スクロールしても
          //   進まない＝カクついて見える）
          wheelRawRef.current = clampRawToWalls(
            wheelRawRef.current + rawDelta + wheelHeldRef.current,
            wheelBaseRef.current,
          );
          wheelHeldRef.current = 0;
          const next = clampPosition(wheelRawRef.current, wheelBaseRef.current);
          wheelTargetRef.current = next;
          pushSample(next); // touch と同じ方式で速度を計測（フリック判定用）
        }

        // ここから慣性＝指が離れた、と見えたら touchend と同じ処理へ。
        // このイベントぶんまでは反映してから終わる（離す直前の動きを捨てない）。
        if (isFling) {
          wheelFlingRef.current = true;
          endWheelGestureRef.current(true);
          armWheelIdle();
          return;
        }
      } else if (isFling) {
        // まだ行が動き出していない段階での慣性。指はもう離れているので、
        // 惰性だけで行が開き始めないように捨てる。
        wheelFlingRef.current = true;
        wheelAccum.current = 0;
      }

      // 保険のタイマー。通常は慣性の検知か追従ループの追いつき検知が先に
      // スナップを始めるが、どちらも起きなかった場合に備えて残す。
      armWheelIdle();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [
    openWidth,
    leadWidth,
    isTouch,
    disabled,
    beginOpen,
    cancelRaf,
    clampPosition,
    startWheelLoop,
    pushSample,
    resetSamples,
    clampRawToWalls,
    armWheelIdle,
    resetFlingDetect,
  ]);

  if (!isTouch || disabled || (actions.length === 0 && !leadingAction)) {
    return <div className={className}>{children}</div>;
  }

  function onTouchStart(e: React.TouchEvent) {
    // 割り込み：バネ収束中でも触れた瞬間に現在位置から追従を再開。
    cancelRaf();
    draggingRef.current = false;
    const t = e.touches[0];
    // base はドラッグの原点（1:1 の基準）。バネの途中で触っても飛ばないよう
    // 現在位置にする。開閉ルールの基準は restPosRef（静止位置）を使う。
    start.current = { x: t.clientX, y: t.clientY, base: offsetRef.current };
    axis.current = "none";
    resetSamples(offsetRef.current);
    committingRef.current = false;
    // 行幅・画面幅はジェスチャー中は不変なので開始時に一度だけ読む
    // （毎フレームの読み取り＝レイアウト往復を避ける）。
    rowWidthRef.current = rowRef.current?.offsetWidth ?? 0;
    screenWidthRef.current = window.innerWidth || rowWidthRef.current;
    // 動き出す前にボタンをレイヤー化させておく（初回描画をスワイプ中に起こさない）。
    setActive(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(dx) < AXIS_DEADZONE && Math.abs(dy) < AXIS_DEADZONE) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "x") {
        beginOpen();
        draggingRef.current = true;
        // 横ドラッグが確定した時点を速度計測の起点にする（指を置いてから動かし
        // 始めるまでの待ち時間で速度が薄まらないように）。
        resetSamples(start.current.base);
      }
    }
    if (axis.current !== "x") return;

    // 横スワイプはこの行の操作。祖先（AppShell のサイドバー開閉／戻る）にも
    // 伝わると、開いているドロワー内でフォルダを左スワイプした時に、ドロワー自身も
    // 閉じる方向へ動いてしまう（一瞬閉じかけて戻る）。ここで伝播を止めて、横スワイプは
    // 行のアクション表示だけに使う。縦スクロール（axis!=="x"）は上で return 済みなので
    // 止めない＝一覧のスクロールは従来どおり効く。
    e.stopPropagation();

    // 指の座標に 1:1 で一致させる（イージング・トランジションは一切かけない）。
    // 不感帯ぶんは差し引かない：差し引くとその距離だけ「指は動いているのに行は
    // 動かない」区間ができ、動き出しが遅く感じるため。確定した瞬間から指の位置に
    // そのまま一致させる（不感帯は小さいので、ここで生じるズレは知覚されない）。
    // 壁と抵抗は「生の位置」に対して一度だけ適用する（wheel と共通の規則）。
    const raw = start.current.base + dx;
    const next = clampPosition(raw, restPosRef.current);

    // 指の速度計測（フリック判定用・直近ウィンドウの実移動量）
    pushSample(next);
    moveTo(next); // 1:1 追従（イベント内で即反映）
  }

  function onTouchEnd() {
    if (axis.current !== "x") {
      axis.current = "none";
      // 横スワイプにならなかった＝ただのタップ／縦スクロール。
      // onTouchStart で付けた操作中フラグをここで必ず外す。外し忘れると
      // 「触った行だけフラグが残り続ける」状態になり、このフラグに紐づく
      // スタイル（フォルダ行のスワイプ中の地色）が付きっぱなしになる。
      // ただしバネで戻っている最中（静止位置に居ない）は、収束時に
      // setActive(false) されるのでここでは触らない。
      if (offsetRef.current === 0) setActive(false);
      return;
    }
    axis.current = "none";
    draggingRef.current = false;
    // 離した瞬間の速度を、開閉判定にもバネの初速にも使う（＝動きが途切れない）。
    // 開閉ルールの基準は静止位置（ドラッグ原点ではない）。
    settle(restPosRef.current, offsetRef.current, lastVelRef.current);
  }

  // 初期 style（再レンダー時にこの静止位置で描く。以後の動きは applyOffset が上書き）。
  const initTx = restOffset;
  const rr0 =
    openWidth > 0 ? revealRatio(Math.min(1, Math.max(0, -restOffset) / openWidth)) : 0;
  const lr0 = leadWidth > 0 ? Math.min(1, Math.max(0, restOffset) / leadWidth) : 0;

  return (
    <div
      ref={rowRef}
      className={`flow-swipe-row relative overflow-hidden ${className}`}
    >
      {/* 背後の（左スワイプ）アクション。領域はスワイプ量に合わせて広がり、
          広がったぶんは一番左のボタンが吸収する（ボタンが出そろった後も指と一緒に
          動き続けられるようにするため。通常の範囲では見え方は変わらない）。 */}
      <div
        ref={trailWrapRef}
        className="absolute inset-y-0 right-0 flex"
        style={{ width: Math.max(openWidth, -restOffset) }}
      >
        {actions.map((a, i) => {
          const p = Math.max(0, Math.min(1, nActions * rr0 - (nActions - 1 - i)));
          return (
            <div
              key={a.key}
              style={{
                width: actionWidth,
                flexShrink: 0,
                // 振り切って余った幅は3ボタンで均等に受け取る（全ボタン同じ割合で伸びる）
                flexGrow: 1,
              }}
              className={`flex ${compact ? "p-0.5" : "p-1"}`}
            >
              <button
                ref={(el) => {
                  actionBtnRefs.current[i] = el;
                }}
                onClick={() => {
                  if (!a.keepOpen) closeSelf();
                  a.onClick();
                }}
                style={{ transform: `scale(${0.2 + 0.8 * p})`, opacity: p }}
                className={`flow-press flow-swipe-action flex flex-1 flex-col items-center justify-center font-medium text-white ${
                  compact
                    ? "gap-0.5 rounded-xl text-[10px] leading-none"
                    : "gap-1 rounded-[1.6rem] text-xs"
                } ${a.className}`}
              >
                <span
                  className={`flex items-center justify-center ${
                    compact ? "h-4 w-4" : "h-5 w-5"
                  }`}
                >
                  {a.icon}
                </span>
                {a.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* 右スワイプで左側に出るリーディングアクション（ピン留め） */}
      {leadingAction && (
        <div
          ref={leadWrapRef}
          className="absolute inset-y-0 left-0 flex"
          style={{ width: Math.max(leadWidth, restOffset) }}
        >
          <div className="flex flex-1 p-1">
            <button
              ref={leadBtnRef}
              onClick={() => {
                closeSelf();
                leadingAction.onClick();
              }}
              style={{
                transform: `scale(${0.2 + 0.8 * lr0})`,
                opacity: lr0,
              }}
              className={`flow-press flow-swipe-action flex flex-1 flex-col items-center justify-center gap-1 rounded-[1.6rem] text-xs font-medium text-white ${leadingAction.className}`}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                {leadingAction.icon}
              </span>
              {leadingAction.label}
            </button>
          </div>
        </div>
      )}

      {/* 前面のコンテンツ。位置は ref 直書き（transition なし＝指に遅れない）。 */}
      <div
        ref={contentRef}
        className={`flow-swipe-content relative ${contentClassName}`}
        style={{ transform: `translateX(${initTx}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(e) => {
          if (Math.abs(offsetRef.current) > 1) {
            e.preventDefault();
            e.stopPropagation();
            closeSelf();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
