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
  /** 左へ振り切ったときに、ボタンを押さずに実行してよいか（フルスワイプ）。
   *  一番右のアクションにだけ意味がある。取り消せない操作（完全削除など）には
   *  付けないこと。付いている場合だけ、振り切りに向けて幅が伸びる演出になる。 */
  fullSwipe?: boolean;
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
const LEAD_COMMIT_VELOCITY = 0.9;

// 左のフルスワイプ（一番右のアクションを押さずに実行）が成立する行幅比。
const FULL_SWIPE_RATIO = 0.7;
// 伸長の開始（＝アクション群の幅）から振り切りまでの最低距離(px)。行が狭いときに
// 「一瞬で伸びきる」のを防ぎ、伸びる過程を必ず見せるための下限。
const FULL_SWIPE_MIN_EXTRA = 80;

// 横方向の意図を判定する不感帯(px)。これを超えるまでは反応しない。
const AXIS_DEADZONE = 6;
// フリック判定の速度しきい値(px/ms)。これ以上の速さで離すと距離が足りなくても開閉。
const FLICK_VELOCITY = 0.35;
// 速度を計測する時間窓(ms)。「指を離す直前」の実移動量から算出する。
// EWMA だと短く速いフリックでサンプル数が足りず速度を大幅に過小評価してしまい、
// フリックと判定されない → 距離も閾値未満 → リストへ戻る（＝スライド方向と逆に
// 動いて見える）ため、直近ウィンドウの実移動量方式にしている。
const VELOCITY_WINDOW_MS = 100;

// 指を離した後の収束バネ。減衰比 ζ≈0.78（臨界=2√k より小さめ）にして、
// iOS 標準のように「少し行き過ぎてから吸い付く」手応えを出す。
const SPRING_K = 300;
const SPRING_C = 27;

// --- トラックパッド(2本指スクロール) ---
const WHEEL_SENSITIVITY = 0.4;
const WHEEL_AXIS_RATIO = 1.5;
const WHEEL_START_PX = 30;
// スクロールが止まったとみなすまでの待ち時間。短いと連続スライドの途中の一瞬の
// 間（momentum の谷）で「ジェスチャー終了」と誤判定してスナップ→カクつく。
const WHEEL_IDLE_MS = 240;

// 開いている行は常に1つだけ。別の行で横スワイプが始まったら前の行を閉じる。
const openRegistry: { close: (() => void) | null } = { close: null };

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

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// 左スワイプで右側にアクション、右スワイプで左側にリーディングアクション（ピン留め）を
// 表示する行。
//
// レイヤー構造（純正メモと同じ）：
//   外枠 = 角丸 + overflow:hidden の固定コンテナ（動かない）
//     ├ アクション層 = 行いっぱいに敷いた背景。ボタンは隙間なく詰める（角丸なし）
//     └ カード層     = 不透明なシート。これだけが translateX で動き、下の層を露出させる
// 角丸を持つのは外枠だけ。カードに角丸を付けると、ズレたときに丸角の隙間から
// 背後の四角いボタンが覗いてしまう。
//
// 追従方針：ドラッグ中は React の state を更新せず、イベント内で ref 経由に
// transform を直接書く（再レンダーも rAF の1フレーム待ちも挟まないので指に遅れない。
// ブラウザは paint 時に最後の値だけ描くので実質フレーム集約になる）。指を離したら
// その瞬間の速度を初速としてバネへ引き継ぎ、1つの連続した物理アニメーションにする。
export default function SwipeRow({
  actions,
  children,
  disabled = false,
  className = "",
  compact = false,
  contentClassName = "bg-white dark:bg-neutral-950",
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
  const leadWrapRef = useRef<HTMLDivElement>(null);
  const leadBtnRef = useRef<HTMLButtonElement>(null);
  const actionBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const offsetRef = useRef(0); // 現在位置 x。DOM はこれを反映する。
  const draggingRef = useRef(false);
  const leadZoneRef = useRef(false); // 右の振り切りゾーンに入っているか
  const trailZoneRef = useRef(false); // 左のフルスワイプゾーンに入っているか
  const rafRef = useRef<number | null>(null); // バネの rAF id
  const start = useRef({ x: 0, y: 0, base: 0, slop: 0 });
  const axis = useRef<"none" | "x" | "y">("none");
  const samplesRef = useRef<{ x: number; t: number }[]>([]); // 速度算出用の位置履歴
  const lastVelRef = useRef(0); // 直近の指/トラックパッド速度(px/ms)
  const rowWidthRef = useRef(0); // ジェスチャー開始時にキャッシュした行幅
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelAccum = useRef(0);
  const wheelBaseRef = useRef(0); // wheel ジェスチャー開始位置（反対側へ越えさせない判定用）
  const leadingActionRef = useRef(leadingAction);
  leadingActionRef.current = leadingAction;

  const actionWidth = compact ? ACTION_WIDTH_COMPACT : ACTION_WIDTH_NORMAL;
  const nActions = actions.length;
  const openWidth = nActions * actionWidth;
  const hasLead = !!leadingAction;
  const leadWidth = LEAD_WIDTH;
  // フルスワイプは「一番右のアクションが明示的に許可している」ときだけ。
  const fullSwipeAction = nActions > 0 ? actions[nActions - 1] : undefined;
  const canFullSwipe = !!fullSwipeAction?.fullSwipe;
  const fullSwipeRef = useRef(canFullSwipe);
  fullSwipeRef.current = canFullSwipe;

  // 左スワイプ量に対する「一番右のボタンの幅」。伸び始め＝アクション群の幅、
  // 伸びきり＝行幅いっぱい。行幅が未計測(0)のときは自然幅のまま。
  const fullSwipeEnd = useCallback(
    (rowW: number) => Math.max(rowW * FULL_SWIPE_RATIO, openWidth + FULL_SWIPE_MIN_EXTRA),
    [openWidth],
  );
  const lastActionWidth = useCallback(
    (amount: number, rowW: number) => {
      if (!fullSwipeRef.current || rowW <= 0) return actionWidth;
      const end = fullSwipeEnd(rowW);
      const t = clamp01((amount - openWidth) / Math.max(1, end - openWidth));
      return actionWidth + (rowW - actionWidth) * t;
    },
    [actionWidth, openWidth, fullSwipeEnd],
  );

  // 現在位置 x を DOM に直接反映する。再レンダーを介さない。
  function applyOffset(x: number) {
    const rowW = rowWidthRef.current;
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${x}px)`;
    }
    // 左スワイプ：一番右のアクションだけが横に伸びて背景を埋める
    // （他のボタンは位置も幅も保持したまま、その上を覆っていく）。
    if (canFullSwipe) {
      const btn = actionBtnRefs.current[nActions - 1];
      if (btn) {
        btn.style.width = `${lastActionWidth(Math.max(0, -x), rowW)}px`;
      }
    }
    // 右スワイプ：ピン留め領域が左端固定のまま、幅 0 から伸びて出現する
    if (leadWrapRef.current) {
      leadWrapRef.current.style.width = `${Math.max(0, x)}px`;
    }
    if (leadBtnRef.current) {
      // 領域より内側のボタンは自然幅を保ち、領域の拡大で「現れて」いく。
      leadBtnRef.current.style.width = `${Math.max(leadWidth, x)}px`;
      leadBtnRef.current.style.filter = leadZoneRef.current
        ? "brightness(1.18) saturate(1.35)"
        : "none";
    }
  }
  const applyOffsetRef = useRef(applyOffset);
  applyOffsetRef.current = applyOffset;

  // 振り切りゾーンの出入りを監視し、またいだ瞬間だけ合図を出す。
  function updateZones(x: number) {
    const rowW = rowWidthRef.current;
    const inLead = !!leadingActionRef.current && x > 0 && x >= rowW * LEAD_COMMIT_RATIO;
    if (inLead !== leadZoneRef.current) {
      leadZoneRef.current = inLead;
      if (inLead) fireHaptic();
    }
    const inTrail =
      fullSwipeRef.current && rowW > 0 && -x >= fullSwipeEnd(rowW);
    if (inTrail !== trailZoneRef.current) {
      trailZoneRef.current = inTrail;
      if (inTrail) fireHaptic();
    }
  }

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

  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ドラッグ中の 1:1 追従。イベント内でそのまま DOM に反映する（rAF を挟むと
  // 次フレームまで書き込みが遅れて指から離れて見えるため挟まない）。
  const moveTo = useCallback((x: number) => {
    offsetRef.current = x;
    applyOffsetRef.current(x);
  }, []);

  const springToRef = useRef<(target: number, v0?: number) => void>(() => {});
  const closeSelf = useCallback(() => {
    leadZoneRef.current = false;
    trailZoneRef.current = false;
    springToRef.current(0, 0);
  }, []);

  // 指を離した後の収束（バネ）。離した瞬間の速度 v0(px/ms) を初速として引き継ぐので、
  // 慣性移動 → スナップが 1 つの連続した動きになる。減衰比を臨界より下げてあるため
  // 少しオーバーシュートしてから吸い付く。
  const springTo = useCallback(
    (target: number, v0 = 0) => {
      cancelRaf();
      draggingRef.current = false;
      let x = offsetRef.current;
      let v = v0 * 1000; // px/ms -> px/s
      // 「リストへ戻す」ときだけ 0 を越えさせない。ここで跳ね返らせると反対側の
      // ボタンが一瞬見えてしまうため（開き位置へのスナップは自由に行き過ぎてよい）。
      const clampAtZero = target === 0;
      const fromSign = Math.sign(x);
      let last = performance.now();
      const step = (now: number) => {
        let dt = (now - last) / 1000;
        last = now;
        if (dt > 0.032) dt = 0.032;
        const a = -SPRING_K * (x - target) - SPRING_C * v;
        v += a * dt;
        x += v * dt;
        if (clampAtZero && fromSign !== 0 && Math.sign(x) === -fromSign) {
          x = 0;
          v = 0;
        }
        if (Math.abs(x - target) < 0.5 && Math.abs(v) < 8) {
          rafRef.current = null;
          offsetRef.current = target;
          updateZones(target);
          applyOffsetRef.current(target);
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
    // updateZones は毎レンダー作り直されるが ref 経由の値しか読まないので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cancelRaf, closeSelf],
  );
  springToRef.current = springTo;

  const beginOpen = useCallback(() => {
    if (openRegistry.close && openRegistry.close !== closeSelf) {
      openRegistry.close();
    }
    openRegistry.close = closeSelf;
  }, [closeSelf]);

  // 指/トラックパッドを離した/止めたときのスナップ判定（touch・wheel 共通）。
  // base=ジェスチャー開始位置, pos=最終位置, v=離す直前の速度。
  // 開いていた状態からのスワイプは反対側を出さず、必ずリストへ戻す。
  const settle = (base: number, pos: number, v: number) => {
    const rowW = rowWidthRef.current;
    const leadZone = leadZoneRef.current;
    const trailZone = trailZoneRef.current;
    leadZoneRef.current = false;
    trailZoneRef.current = false;

    if (base !== 0) {
      // 開いていた状態から：閉じ方向へ動いた/フリックしたら必ずリストへ戻す。
      const openLeft = base < 0;
      const towardClose = openLeft ? pos - base : base - pos;
      const flickClose = openLeft ? v > FLICK_VELOCITY : v < -FLICK_VELOCITY;
      const openPos = openLeft ? -openWidth : leadWidth;
      springTo(towardClose > 20 || flickClose ? 0 : openPos, v);
      return;
    }

    // 閉じた状態から：左右どちらへも開ける
    if (pos > 0) {
      const lead = leadingActionRef.current;
      if (!lead) {
        springTo(0, v); // リーディングアクションが無い行は右へは開かない
        return;
      }
      // ピン留め確定：距離が振り切り閾値を超えたか、距離が足りなくても速い右フリック。
      if (leadZone || pos >= rowW * LEAD_COMMIT_RATIO || v >= LEAD_COMMIT_VELOCITY) {
        springTo(0, v);
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

    // 左：フルスワイプ確定（許可されたアクションのみ）
    const amount = -pos;
    if (canFullSwipe && fullSwipeAction && (trailZone || amount >= fullSwipeEnd(rowW))) {
      // keepOpen（削除など、行そのものが消えていく）ならその場に残す。
      if (!fullSwipeAction.keepOpen) springTo(0, v);
      fullSwipeAction.onClick();
      return;
    }
    let target: number;
    if (v < -FLICK_VELOCITY) target = -openWidth;
    else if (v > FLICK_VELOCITY) target = 0;
    else target = amount >= openWidth / 2 ? -openWidth : 0;
    springTo(target, v);
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // 再レンダー後、DOM を現在の offsetRef に合わせ直す（ドラッグ/バネの最中に親が
  // 再レンダーしても位置が飛ばないための保険）。paint 前に実行。
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

      if (engaged) {
        beginOpen();
        if (!draggingRef.current) {
          cancelRaf();
          draggingRef.current = true;
          wheelBaseRef.current = offsetRef.current;
          rowWidthRef.current = rowRef.current?.offsetWidth ?? 0;
          resetSamples(offsetRef.current);
        }
        const rowW = rowWidthRef.current;
        const base = wheelBaseRef.current;
        let next = offsetRef.current - e.deltaX * WHEEL_SENSITIVITY;
        // 開いていた状態からのスクロールは反対側へ越えさせない（0 でクランプ）。
        if (base < 0 && next > 0) next = 0;
        if (base > 0 && next < 0) next = 0;
        const maxRight = leadingActionRef.current ? rowW : 0;
        if (next > maxRight) next = maxRight;
        const maxLeft = canFullSwipe ? rowW : openWidth;
        if (next < -maxLeft) next = -maxLeft;
        pushSample(next);
        moveTo(next);
        updateZones(next);
      }

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelAccum.current = 0;
        draggingRef.current = false;
        settleRef.current(
          wheelBaseRef.current,
          offsetRef.current,
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
    canFullSwipe,
    beginOpen,
    cancelRaf,
    moveTo,
    pushSample,
    resetSamples,
  ]);

  if (!isTouch || disabled || (nActions === 0 && !leadingAction)) {
    return <div className={className}>{children}</div>;
  }

  function onTouchStart(e: React.TouchEvent) {
    // 割り込み：バネ収束中でも触れた瞬間に現在位置から追従を再開。
    cancelRaf();
    draggingRef.current = false;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: offsetRef.current, slop: 0 };
    axis.current = "none";
    resetSamples(offsetRef.current);
    leadZoneRef.current = false;
    trailZoneRef.current = false;
    // 行幅はジェスチャー中は不変なので開始時に一度だけ読む。
    rowWidthRef.current = rowRef.current?.offsetWidth ?? 0;
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
        // 不感帯ぶんを差し引いて、追従開始の瞬間に不感帯の距離だけカードが
        // 飛ぶのを防ぐ（ここが「動き出しの引っ掛かり」に見えていた）。
        start.current.slop = dx;
        resetSamples(start.current.base);
      }
    }
    if (axis.current !== "x") return;

    let next = start.current.base + (dx - start.current.slop);
    const rowW = rowWidthRef.current;
    // 開いていた状態からのスワイプは反対側へ越えさせない（0 でクランプ）。
    if (start.current.base < 0 && next > 0) next = 0;
    if (start.current.base > 0 && next < 0) next = 0;
    if (next > 0) {
      if (!hasLead) next = next * 0.2;
      else if (next > rowW) next = rowW + (next - rowW) * 0.2;
    }
    // フルスワイプできる行は行幅まで自由に引ける（そこまで引かないと振り切れない）。
    const maxLeft = canFullSwipe ? rowW : openWidth;
    if (next < -maxLeft) next = -maxLeft + (next + maxLeft) * 0.2;

    pushSample(next);
    moveTo(next); // 1:1 追従（イベント内で即反映）
    updateZones(next);
  }

  function onTouchEnd() {
    if (axis.current !== "x") {
      axis.current = "none";
      return;
    }
    axis.current = "none";
    draggingRef.current = false;
    // 離した瞬間の速度をフリック判定にもバネ初速にも使う（＝動きが途切れない）。
    settle(start.current.base, offsetRef.current, lastVelRef.current);
  }

  // 初期 style（再レンダー時にこの静止位置で描く。以後の動きは applyOffset が上書き）。
  const initTx = restOffset;
  const initLeadWrap = Math.max(0, restOffset);
  const initLastW = lastActionWidth(Math.max(0, -restOffset), rowWidthRef.current);

  return (
    // 外枠：角丸 + overflow-hidden の固定コンテナ。ここだけが角丸を持つ。
    <div
      ref={rowRef}
      className={`flow-swipe-row relative overflow-hidden ${className}`}
    >
      {/* アクション層：行いっぱいに敷く。ボタンは右端から隙間なく並べる（角丸なし）
          ので、1枚のシートから削られたように見える。 */}
      {nActions > 0 && (
        <div className="absolute inset-0">
          {actions.map((a, i) => {
            const isLast = i === nActions - 1;
            return (
              <button
                key={a.key}
                ref={(el) => {
                  actionBtnRefs.current[i] = el;
                }}
                onClick={() => {
                  if (!a.keepOpen) closeSelf();
                  a.onClick();
                }}
                style={{
                  right: (nActions - 1 - i) * actionWidth,
                  width: isLast ? initLastW : actionWidth,
                }}
                className={`flow-press absolute inset-y-0 flex flex-col items-center justify-center overflow-hidden font-medium text-white ${
                  compact
                    ? "gap-0.5 text-[10px] leading-none"
                    : "gap-1 text-xs"
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
            );
          })}
        </div>
      )}

      {/* リーディングアクション（ピン留め）：左端固定のまま、幅が 0 から伸びて出現する */}
      {leadingAction && (
        <div
          ref={leadWrapRef}
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: initLeadWrap }}
        >
          <button
            ref={leadBtnRef}
            onClick={() => {
              closeSelf();
              leadingAction.onClick();
            }}
            style={{ width: Math.max(leadWidth, restOffset) }}
            className={`flow-press absolute inset-y-0 left-0 flex flex-col items-center justify-center gap-1 text-xs font-medium text-white ${leadingAction.className}`}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              {leadingAction.icon}
            </span>
            {leadingAction.label}
          </button>
        </div>
      )}

      {/* カード層：不透明なシート。これだけが動く。角丸は持たせない（外枠がクリップする）。 */}
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
