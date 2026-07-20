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

const ACTION_WIDTH_NORMAL = 72; // 1アクションあたりの幅(px)
const ACTION_WIDTH_COMPACT = 64; // 背の低い行（フォルダ一覧）向けの詰めた幅
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
// スクロールが止まったとみなすまでの待ち時間。トラックパッドには touchend に
// あたる「操作終了」イベントが無いため、これで代用するしかない。短いと、しきい値
// 付近でゆっくり合わせているときの一瞬の間を「終了」と誤判定してスナップを始めて
// しまい、その直後の入力がバネに割り込んで往復する（＝境界付近でカクつく）。
const WHEEL_IDLE_MS = 360;
// トラックパッドのみに掛ける追従率（1フレームあたり）。
// タッチの touchmove は画面のリフレッシュに同期して届くので 1:1 で滑らかだが、
// wheel は 60Hz 前後かつ不揃いなまとまりで届くため、120Hz(ProMotion) では
// 「イベントが来ないフレーム」が生まれてカクついて見える。毎フレーム目標値へ
// 少しずつ寄せることで、イベントの無いフレームも中間位置が描かれて滑らかになる。
// 低すぎると寄りきるまでに時間が掛かり動き出しが鈍く感じるので、段送りが消える
// 範囲でなるべく高くする（2〜3フレームで目標に追いつく程度）。
const WHEEL_SMOOTHING = 0.55;

// 開いている行は常に1つだけ。別の行で横スワイプが始まったら前の行を閉じる。
const openRegistry: { close: (() => void) | null } = { close: null };

// ===== 一時的な計測コード（原因の裏付けが取れたらこのブロックごと削除する） =====
// トラックパッドのカクつき調査用。wheel イベント／補間フレーム／スナップ判定を
// 1ジェスチャーぶん溜めて、静止したときに console.table でまとめて出す。
// ループ内で console を呼ぶとそれ自体がジャンク要因になるので push だけに留める。
const WHEEL_DEBUG = true;
type DebugRow = Record<string, string | number | boolean | null>;
const debugLog: DebugRow[] = [];
let debugLastWheelT = 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
function dbg(kind: string, fields: DebugRow) {
  if (!WHEEL_DEBUG) return;
  debugLog.push({ t: r2(performance.now()), kind, ...fields });
  // spring が最後まで収束しないまま操作が続くと flush されないので、上限で古い方を捨てる。
  if (debugLog.length > 1200) debugLog.splice(0, debugLog.length - 1200);
}
function dbgFlush(reason: string) {
  if (!WHEEL_DEBUG || debugLog.length === 0) return;
  const rows = debugLog.splice(0, debugLog.length);
  const t0 = Number(rows[0].t);
  for (const r of rows) r.t = r2(Number(r.t) - t0);
  console.groupCollapsed(
    `[SwipeRow] ${reason} — ${rows.length} rows / ${r2(
      Number(rows[rows.length - 1].t),
    )}ms`,
  );
  console.table(rows);
  console.groupEnd();
}
// ===== 計測コードここまで =====

// フル表示幅を超えて引いたぶんの抵抗（ラバーバンド）。
//   実際の移動量 = フル表示幅 + 超過量 / (1 + 超過量 / 画面幅)
// 引くほど重くなり、画面幅ぶん引いても超過は半分までしか進まない。
function rubberBand(over: number, screenW: number) {
  return over / (1 + over / Math.max(1, screenW));
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
    const rr = openWidth > 0 ? Math.min(1, Math.max(0, -x) / openWidth) : 0;
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

  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // 「指/トラックパッドが示した生の位置」に壁と抵抗を適用して実際の位置を出す。
  // touch と wheel で必ず同じ規則になるよう共通化する。入力は常に生の値を渡すこと
  // （抵抗を掛けた後の値を再入力すると、抵抗が重ねがけになって動きが詰まる）。
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
      // 計測: フレーム間 dt に穴が無いか、補間の残差が詰まっているか
      dbg("frame", {
        dt: r2(dt),
        from: r2(offsetRef.current),
        target: r2(target),
        residual: r2(target - offsetRef.current),
        x: r2(x),
      });
      moveTo(x);
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
      let x = offsetRef.current;
      let v = v0 * 1000; // px/ms -> px/s
      // 計測: どこから・どの初速で・どこへ向かうか
      dbg("spring", {
        from: r2(x),
        target: r2(target),
        v0: r2(v0),
        restPos: r2(restPosRef.current),
      });
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
        if (Math.abs(x - target) < 0.5 && Math.abs(v) < 8) {
          rafRef.current = null;
          offsetRef.current = target;
          restPosRef.current = target; // ここで初めて「静止位置」が確定する
          applyOffsetRef.current(target);
          setActive(false); // 静止したらレイヤーを解放する
          setRestOffset(target); // 再レンダー時の初期 style を合わせる
          if (target === 0 && openRegistry.close === closeSelf) {
            openRegistry.close = null;
          }
          dbg("rest", { target: r2(target) });
          dbgFlush(`settled at ${r2(target)}`);
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
  const settle = (base: number, pos: number, v: number) => {
    const rowW = rowWidthRef.current;
    const wasZone = committingRef.current;
    committingRef.current = false;
    // 計測: 判定に使う値一式。原因1 = base と restPos/offset の食い違い、
    // 原因2 = wheelAge が大きいのに |v| が FLICK_VELOCITY を超えていないか。
    dbg("settle", {
      base: r2(base),
      pos: r2(pos),
      v: r2(v),
      flick: Math.abs(v) > FLICK_VELOCITY,
      restPos: r2(restPosRef.current),
      offset: r2(offsetRef.current),
      wasZone,
      wheelAge: debugLastWheelT ? r2(performance.now() - debugLastWheelT) : null,
    });

    if (base !== 0) {
      // 開いていた状態から：反対側へは越えられない（0 にクランプ済み）。閉じ方向へ
      // 少しでも動いた/フリックしたら必ずリストへ戻す。動きが小さければ元の開位置へ。
      const openLeft = base < 0;
      const towardClose = openLeft ? pos - base : base - pos; // 閉じ方向へ動いた量(px)
      const flickClose = openLeft ? v > FLICK_VELOCITY : v < -FLICK_VELOCITY;
      const openPos = openLeft ? -openWidth : leadWidth;
      springTo(towardClose > 20 || flickClose ? 0 : openPos, v);
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
        springTo(0, v); // 振り切り/フリック → 実行してスナップで戻す
        lead.onClick();
        return;
      }
      let target: number;
      if (v > FLICK_VELOCITY) target = leadWidth;
      else if (v < -FLICK_VELOCITY) target = 0;
      else target = pos >= leadWidth / 2 ? leadWidth : 0;
      springTo(target, v);
      return;
    }
    let target: number;
    if (v < -FLICK_VELOCITY) target = -openWidth;
    else if (v > FLICK_VELOCITY) target = 0;
    else target = pos <= -openWidth / 2 ? -openWidth : 0;
    springTo(target, v);
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

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

      wheelAccum.current += e.deltaX;
      const engaged =
        offsetRef.current !== 0 || Math.abs(wheelAccum.current) > WHEEL_START_PX;

      // 計測: 原因3 = ジェスチャー中盤に engaged=false が挟まらないか。
      // deltaX のバースト具合（evDt が数ms と数百ms を行き来する）もここで見る。
      if (WHEEL_DEBUG) {
        const now = performance.now();
        dbg("wheel", {
          dx: r2(e.deltaX),
          evDt: debugLastWheelT ? r2(now - debugLastWheelT) : null,
          engaged,
          accum: r2(wheelAccum.current),
          raw: r2(wheelRawRef.current),
          target: r2(wheelTargetRef.current),
          offset: r2(offsetRef.current),
          restPos: r2(restPosRef.current),
          wheelBase: r2(wheelBaseRef.current),
          dragging: draggingRef.current,
          vel: r2(lastVelRef.current),
        });
        debugLastWheelT = now;
      }

      if (engaged) {
        beginOpen();
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
          rowWidthRef.current = rowRef.current?.offsetWidth ?? 0;
          screenWidthRef.current = window.innerWidth || rowWidthRef.current;
          resetSamples(offsetRef.current);
          setActive(true);
          startWheelLoop();
        }
        // 生の積算値に足し込み、壁と抵抗は「生の値」に対して一度だけ適用する。
        // （減衰後の位置に足し込むと抵抗が重ねがけになり、スクロールしても
        //   進まない＝カクついて見える）
        wheelRawRef.current -= e.deltaX * WHEEL_SENSITIVITY;
        const next = clampPosition(wheelRawRef.current, wheelBaseRef.current);
        wheelTargetRef.current = next;
        pushSample(next); // touch と同じ方式で速度を計測（フリック判定用）
      }

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        dbg("idle", {
          sinceLastWheel: r2(performance.now() - debugLastWheelT),
          target: r2(wheelTargetRef.current),
          offset: r2(offsetRef.current),
          vel: r2(lastVelRef.current),
        });
        wheelAccum.current = 0;
        draggingRef.current = false;
        // touch と同じスナップ判定に集約。開始位置を base に渡すことで、開いていた
        // 状態からのスクロールは必ずリストへ戻す（反対側は出さない）。
        // 位置判定は補間の途中ではなく、実際に指示された到達点(target)で行う。
        // バネの開始位置は表示中の offsetRef なので見た目は連続したまま。
        settleRef.current(
          wheelBaseRef.current,
          wheelTargetRef.current,
          lastVelRef.current,
        );
      }, WHEEL_IDLE_MS);
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
  ]);

  if (!isTouch || disabled || (actions.length === 0 && !leadingAction)) {
    return <div className={className}>{children}</div>;
  }

  function onTouchStart(e: React.TouchEvent) {
    // 計測: 指の操作では wheelAge が意味を持たないので、前の wheel の残りを消す。
    debugLastWheelT = 0;
    dbg("touchstart", { offset: r2(offsetRef.current), restPos: r2(restPosRef.current) });
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
  const rr0 = openWidth > 0 ? Math.min(1, Math.max(0, -restOffset) / openWidth) : 0;
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
                // 余った幅は一番左のボタンだけが受け取る
                flexGrow: i === 0 ? 1 : 0,
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
