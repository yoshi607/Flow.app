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
const LEAD_COMMIT_VELOCITY = 0.9;

// 横方向の意図を判定する不感帯(px)。これを超えるまでは反応しない。
const AXIS_DEADZONE = 6;
// フリック判定の速度しきい値(px/ms)。これ以上の速さで離すと距離が足りなくても開閉。
const FLICK_VELOCITY = 0.35;
// 速度を計測する時間窓(ms)。「指を離す直前」の実移動量から算出する。
// EWMA だと短く速いフリックでサンプル数が足りず速度を大幅に過小評価してしまい、
// フリックと判定されない → 距離も閾値未満 → リストへ戻る（＝スライド方向と逆に
// 動いて見える）ため、直近ウィンドウの実移動量方式にしている。
const VELOCITY_WINDOW_MS = 100;
// 指を離した後の収束バネ（ほぼ臨界減衰＝オーバーシュートしにくい）。
const SPRING_K = 220;
const SPRING_C = 30;
// ドラッグ中の「なめし」係数。毎フレーム、表示位置(currentX)を指の生座標
// (targetX)へこの割合だけ近づける。1 に近いほど吸い付き、低いほど滑らか（ただし
// 遅れて見える）。60fps 1フレームあたりの追従率として扱い、実 fps に依らず一定に
// なるよう dt で正規化する。
const SMOOTHING_FACTOR = 0.35;

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

  const offsetRef = useRef(0); // 表示位置 currentX（真の値）。DOM はこれを反映する。
  const targetRef = useRef(0); // 指/トラックパッドの生座標 targetX（毎フレーム追う先）
  const draggingRef = useRef(false); // ドラッグ中（なめしループを回すべきか）
  const committingRef = useRef(false); // 振り切りゾーンに入っているか
  const rafRef = useRef<number | null>(null); // なめしループ or バネの rAF id
  const lastFrameRef = useRef(0); // なめしループの前フレーム時刻
  const dispVelRef = useRef(0); // 表示位置の速度(px/ms)。離した後のバネ初速に使う
  const start = useRef({ x: 0, y: 0, base: 0 });
  const axis = useRef<"none" | "x" | "y">("none");
  const samplesRef = useRef<{ x: number; t: number }[]>([]); // 速度算出用の位置履歴
  const lastVelRef = useRef(0); // 直近の指/トラックパッド速度(px/ms)。フリック判定に使う
  const rowWidthRef = useRef(0); // ジェスチャー開始時にキャッシュした行幅
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelAccum = useRef(0);
  const wheelBaseRef = useRef(0); // wheel ジェスチャー開始時の位置（反対側へ越えさせない判定用）
  const leadingActionRef = useRef(leadingAction);
  leadingActionRef.current = leadingAction;

  const actionWidth = compact ? ACTION_WIDTH_COMPACT : ACTION_WIDTH_NORMAL;
  const openWidth = actions.length * actionWidth;
  const hasLead = !!leadingAction;
  const leadWidth = LEAD_WIDTH;

  // 現在位置 x を DOM に直接反映する（content の transform、左右アクションの拡大/不透明度、
  // 振り切りゾーンの合図）。再レンダーを介さない。
  const nActions = actions.length;
  function applyOffset(x: number) {
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${x}px)`;
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
    if (leadWrapRef.current) {
      leadWrapRef.current.style.width = `${Math.max(leadWidth, x)}px`;
    }
    if (leadBtnRef.current) {
      const lr = leadWidth > 0 ? Math.min(1, Math.max(0, x) / leadWidth) : 0;
      const commit = committingRef.current;
      leadBtnRef.current.style.transform = `scale(${
        (0.2 + 0.8 * lr) * (commit ? 1.12 : 1)
      })`;
      leadBtnRef.current.style.opacity = String(lr);
      leadBtnRef.current.style.filter = commit
        ? "brightness(1.18) saturate(1.35)"
        : "none";
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

  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ドラッグ中のなめしループ。touchmove/wheel は生座標を targetRef に入れるだけで、
  // 実際の表示更新はこのループが 1フレーム1回だけ行う（＝イベント多発をフレームに
  // 集約）。毎フレーム、表示位置 currentX を targetX へ SMOOTHING_FACTOR の割合だけ
  // 近づけてから DOM に反映する（意図的な「なめし」）。振り切り合図と表示速度も
  // ここで更新する。すでに回っているなら二重起動しない。
  const startDragLoop = useCallback(() => {
    if (draggingRef.current) return;
    cancelRaf();
    draggingRef.current = true;
    lastFrameRef.current = performance.now();
    const step = (now: number) => {
      let dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      if (dt <= 0) dt = 16.6667;
      if (dt > 40) dt = 40;
      // 実 fps に依らず一定になるよう指数補間を dt 正規化する。
      const alpha = 1 - Math.pow(1 - SMOOTHING_FACTOR, dt / 16.6667);
      const prev = offsetRef.current;
      let x = prev + (targetRef.current - prev) * alpha;
      if (Math.abs(targetRef.current - x) < 0.1) x = targetRef.current;
      // 表示位置の速度（バネ初速用・軽く平滑化）
      const inst = (x - prev) / dt;
      dispVelRef.current = dispVelRef.current * 0.5 + inst * 0.5;
      offsetRef.current = x;
      applyOffsetRef.current(x);
      // 振り切りゾーンの出入りを「表示位置」で監視（合図と見た目を一致させる）
      if (leadingActionRef.current && x > 0) {
        const inZone = x >= rowWidthRef.current * LEAD_COMMIT_RATIO;
        if (inZone !== committingRef.current) {
          committingRef.current = inZone;
          if (inZone) fireHaptic();
        }
      } else if (committingRef.current) {
        committingRef.current = false;
      }
      if (draggingRef.current) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [cancelRaf]);

  const springToRef = useRef<(target: number, v0?: number) => void>(() => {});
  const closeSelf = useCallback(() => {
    committingRef.current = false;
    springToRef.current(0, 0);
  }, []);

  // 指を離した後の収束（バネ）。初速 v0(px/ms) を引き継ぐ。毎フレーム DOM を直接
  // 書き換え、静止したときだけ state を同期する。途中で触れれば offsetRef から
  // 現在位置を拾って追従再開できる。
  const springTo = useCallback(
    (target: number, v0 = 0) => {
      cancelRaf();
      draggingRef.current = false; // なめしループを止めてバネへ引き継ぐ
      let x = offsetRef.current;
      // target から離れる向きの初速は引き継がない。なめし係数が低いと、指を追い切る
      // 前に離した表示速度が「開く側」へ残り、少しのスライドでも慣性で行き過ぎて
      // 反対側のボタンが一瞬見える。target へ向かう勢いだけ残す。
      if ((target - x) * v0 < 0) v0 = 0;
      let v = v0 * 1000; // px/ms -> px/s
      // target を境に反対符号へは出さない（万一の行き過ぎでも反対側を露出させない）。
      const fromSign = Math.sign(x - target);
      let last = performance.now();
      const step = (now: number) => {
        let dt = (now - last) / 1000;
        last = now;
        if (dt > 0.032) dt = 0.032;
        const a = -SPRING_K * (x - target) - SPRING_C * v;
        v += a * dt;
        x += v * dt;
        if (fromSign > 0 && x < target) {
          x = target;
          v = 0;
        } else if (fromSign < 0 && x > target) {
          x = target;
          v = 0;
        }
        if (Math.abs(x - target) < 0.5 && Math.abs(v) < 8) {
          rafRef.current = null;
          offsetRef.current = target;
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
  // base=ジェスチャー開始位置, pos=指の最終位置（＝生座標 targetRef。表示位置ではない）,
  // v=フリック判定用の速度, springV=バネ初速。判定は「表示位置」ではなく「指の実際の
  // 位置」で行う：なめし係数が低いと表示が指に追いつく前に離すため、表示位置で距離を
  // 測ると実際の指の移動量を大幅に過小評価し、閉じ操作が閾値に届かず開き側へ戻る
  // （少しのスライドで逆側に動いて見える）。バネの開始位置は従来どおり表示位置なので
  // 見た目の連続性は保たれる。開いていた状態からは反対側を出さず必ずリストへ戻す。
  const settle = (base: number, pos: number, v: number, springV: number) => {
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
      // 距離が閾値未満でも速い右フリックなら確定。距離だけを唯一の条件にしない。
      if (
        lead &&
        (wasZone || pos >= rowW * LEAD_COMMIT_RATIO || v >= LEAD_COMMIT_VELOCITY)
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
        // 生座標を targetRef に積むだけ。表示更新はなめしループが行う。
        if (!draggingRef.current) {
          targetRef.current = offsetRef.current;
          wheelBaseRef.current = offsetRef.current; // このジェスチャーの開始位置
          rowWidthRef.current = rowRef.current?.offsetWidth ?? 0;
          resetSamples(offsetRef.current);
          startDragLoop();
        }
        const rowW = rowWidthRef.current;
        const base = wheelBaseRef.current;
        let next = targetRef.current - e.deltaX * WHEEL_SENSITIVITY;
        // 開いていた状態からのスクロールは反対側へ越えさせない（0 でクランプ）。
        if (base < 0 && next > 0) next = 0;
        if (base > 0 && next < 0) next = 0;
        const maxRight = leadingActionRef.current ? rowW : 0;
        if (next > maxRight) next = maxRight;
        if (next < -openWidth) next = -openWidth;
        pushSample(next); // touch と同じ方式で速度を計測（フリック判定用）
        targetRef.current = next;
      }

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelAccum.current = 0;
        draggingRef.current = false; // なめしループを止める
        // touch と同じスナップ判定に集約。開始位置を base に渡すことで、開いていた
        // 状態からのスクロールは必ずリストへ戻す（反対側は出さない）。位置判定は
        // 指の実際の到達点(targetRef)で（表示位置は遅れるため）。
        settleRef.current(
          wheelBaseRef.current,
          targetRef.current,
          lastVelRef.current,
          dispVelRef.current,
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
    startDragLoop,
    pushSample,
    resetSamples,
  ]);

  if (!isTouch || disabled || (actions.length === 0 && !leadingAction)) {
    return <div className={className}>{children}</div>;
  }

  function onTouchStart(e: React.TouchEvent) {
    // 割り込み：バネ収束中でも触れた瞬間に現在位置から追従を再開。
    cancelRaf();
    draggingRef.current = false;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: offsetRef.current };
    targetRef.current = offsetRef.current;
    dispVelRef.current = 0;
    axis.current = "none";
    resetSamples(offsetRef.current);
    committingRef.current = false;
    // 行幅はジェスチャー中は不変なので開始時に一度だけ読む（毎フレームの読み取り回避）。
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
        // 横ドラッグが確定した時点を速度計測の起点にする（指を置いてから動かし
        // 始めるまでの待ち時間で速度が薄まらないように）。
        resetSamples(start.current.base);
        startDragLoop(); // 生座標を追う「なめし」ループを開始
      }
    }
    if (axis.current !== "x") return;

    // 生座標（rubber-band 済み）を targetRef に入れるだけ。実際の表示更新は
    // なめしループが 1フレーム1回だけ行う。
    let next = start.current.base + dx;
    const rowW = rowWidthRef.current;
    // 開いていた状態からのスワイプは反対側へ越えさせない（0 でクランプ）。
    // ＝1回のスライドでは「リストへ戻る」までで、反対側のボタンは出さない。
    if (start.current.base < 0 && next > 0) next = 0;
    if (start.current.base > 0 && next < 0) next = 0;
    if (next > 0) {
      if (!hasLead) next = next * 0.2;
      else if (next > rowW) next = rowW + (next - rowW) * 0.2;
    }
    if (next < -openWidth) next = -openWidth + (next + openWidth) * 0.2;

    // 指の速度計測（フリック判定用・直近ウィンドウの実移動量）
    pushSample(next);

    targetRef.current = next;
  }

  function onTouchEnd() {
    if (axis.current !== "x") {
      axis.current = "none";
      return;
    }
    axis.current = "none";
    draggingRef.current = false; // なめしループを止めてバネへ
    // スナップ判定は指の実際の位置(targetRef)で行う（表示位置は係数が低いと遅れる）。
    // フリック判定は指の速度、バネ初速は表示位置の速度（自然な引き継ぎ）を使う。
    settle(
      start.current.base,
      targetRef.current,
      lastVelRef.current,
      dispVelRef.current,
    );
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
      {/* 背後の（左スワイプ）アクション */}
      <div className="absolute inset-y-0 right-0 flex">
        {actions.map((a, i) => {
          const p = Math.max(0, Math.min(1, nActions * rr0 - (nActions - 1 - i)));
          return (
            <div
              key={a.key}
              style={{ width: actionWidth }}
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
                className={`flow-press flex flex-1 flex-col items-center justify-center font-medium text-white ${
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
              className={`flow-press flex flex-1 flex-col items-center justify-center gap-1 rounded-[1.6rem] text-xs font-medium text-white ${leadingAction.className}`}
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
