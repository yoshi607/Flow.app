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

// 横方向の意図を判定する不感帯(px)。これを超えるまでは反応しない。
const AXIS_DEADZONE = 6;
// フリック判定の速度しきい値(px/ms)。これ以上の速さで離すと距離が足りなくても開閉。
const FLICK_VELOCITY = 0.5;
// 指を離した後の収束バネ（ほぼ臨界減衰＝オーバーシュートしにくい）。
const SPRING_K = 220;
const SPRING_C = 30;

// --- トラックパッド(2本指スクロール) ---
const WHEEL_SENSITIVITY = 0.4;
const WHEEL_AXIS_RATIO = 1.5;
const WHEEL_START_PX = 30;

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

  const offsetRef = useRef(0); // 現在位置（真の値）。DOM はこれを直接反映する。
  const committingRef = useRef(false); // 振り切りゾーンに入っているか
  const rafRef = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0, base: 0 });
  const axis = useRef<"none" | "x" | "y">("none");
  const vel = useRef({ x: 0, t: 0, v: 0 }); // offset 方向の速度(px/ms)
  const rowWidthRef = useRef(0); // ジェスチャー開始時にキャッシュした行幅
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelAccum = useRef(0);
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
  // 最新の applyOffset を安定した参照（バネ/レイアウト効果）から呼ぶための控え。
  const applyOffsetRef = useRef(applyOffset);
  applyOffsetRef.current = applyOffset;

  // ドラッグ中の即時反映：offsetRef を更新し DOM を直接書き換える（state 更新なし）。
  const moveTo = (x: number) => {
    offsetRef.current = x;
    applyOffsetRef.current(x);
  };

  const cancelSpring = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

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
      cancelSpring();
      let x = offsetRef.current;
      let v = v0 * 1000; // px/ms -> px/s
      let last = performance.now();
      const step = (now: number) => {
        let dt = (now - last) / 1000;
        last = now;
        if (dt > 0.032) dt = 0.032;
        const a = -SPRING_K * (x - target) - SPRING_C * v;
        v += a * dt;
        x += v * dt;
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
    [cancelSpring, closeSelf],
  );
  springToRef.current = springTo;

  const beginOpen = useCallback(() => {
    if (openRegistry.close && openRegistry.close !== closeSelf) {
      openRegistry.close();
    }
    openRegistry.close = closeSelf;
  }, [closeSelf]);

  // 再レンダー後、DOM を現在の offsetRef に合わせ直す（ドラッグ/バネの最中に親が
  // 再レンダーしても位置が飛ばないための保険）。paint 前に実行。静止（0）なら
  // JSX の初期 style で正しいので書き込まない（一覧再レンダー時に全行へ書かない）。
  useIsoLayoutEffect(() => {
    if (offsetRef.current !== 0) applyOffsetRef.current(offsetRef.current);
  });

  useEffect(
    () => () => {
      cancelSpring();
      if (openRegistry.close === closeSelf) openRegistry.close = null;
    },
    [cancelSpring, closeSelf],
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
        cancelSpring();
        const rowW = rowRef.current?.offsetWidth ?? 0;
        let next = offsetRef.current - e.deltaX * WHEEL_SENSITIVITY;
        const maxRight = leadingActionRef.current ? rowW : 0;
        if (next > maxRight) next = maxRight;
        if (next < -openWidth) next = -openWidth;
        if (leadingActionRef.current && next > 0) {
          const inZone = next >= rowW * LEAD_COMMIT_RATIO;
          if (inZone !== committingRef.current) {
            committingRef.current = inZone;
            if (inZone) fireHaptic();
          }
        }
        moveTo(next);
      }

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelAccum.current = 0;
        const cur = offsetRef.current;
        const rowW = rowRef.current?.offsetWidth ?? 0;
        const wasZone = committingRef.current;
        committingRef.current = false;
        if (cur > 0) {
          const lead = leadingActionRef.current;
          if (lead && (wasZone || cur >= rowW * LEAD_COMMIT_RATIO)) {
            springTo(0, 0);
            lead.onClick();
          } else {
            springTo(cur >= leadWidth / 2 ? leadWidth : 0, 0);
          }
        } else {
          springTo(cur <= -openWidth / 2 ? -openWidth : 0, 0);
        }
      }, 140);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [openWidth, leadWidth, isTouch, disabled, beginOpen, cancelSpring, springTo]);

  if (!isTouch || disabled || (actions.length === 0 && !leadingAction)) {
    return <div className={className}>{children}</div>;
  }

  function onTouchStart(e: React.TouchEvent) {
    // 割り込み：バネ収束中でも触れた瞬間に現在位置から 1:1 追従を再開。
    cancelSpring();
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: offsetRef.current };
    axis.current = "none";
    vel.current = { x: offsetRef.current, t: performance.now(), v: 0 };
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
      if (axis.current === "x") beginOpen();
    }
    if (axis.current !== "x") return;

    // 1:1 追従。可動域の外はラバーバンド（0.2 減衰）。
    let next = start.current.base + dx;
    const rowW = rowWidthRef.current;
    if (next > 0) {
      if (!hasLead) next = next * 0.2;
      else if (next > rowW) next = rowW + (next - rowW) * 0.2;
    }
    if (next < -openWidth) next = -openWidth + (next + openWidth) * 0.2;

    // 速度計測（軽い平滑化）
    const now = performance.now();
    const dtv = now - vel.current.t;
    if (dtv > 0) {
      const inst = (next - vel.current.x) / dtv;
      vel.current.v = vel.current.v * 0.4 + inst * 0.6;
      vel.current.x = next;
      vel.current.t = now;
    }

    // 振り切りゾーンの出入りを監視し、「未達→到達」でのみ合図（拡大・彩度・振動）。
    if (hasLead && next > 0) {
      const inZone = next >= rowW * LEAD_COMMIT_RATIO;
      if (inZone !== committingRef.current) {
        committingRef.current = inZone;
        if (inZone) fireHaptic();
      }
    } else if (committingRef.current) {
      committingRef.current = false;
    }

    moveTo(next); // ref+DOM 直書き（state 更新なし）。applyOffset が合図も反映。
  }

  function onTouchEnd() {
    if (axis.current !== "x") {
      axis.current = "none";
      return;
    }
    axis.current = "none";
    const rowW = rowWidthRef.current;
    const v = vel.current.v; // px/ms（右が正）
    const cur = offsetRef.current;
    const wasZone = committingRef.current;
    committingRef.current = false;

    if (cur > 0) {
      // 右スワイプ
      const lead = leadingAction;
      if (lead && (wasZone || cur >= rowW * LEAD_COMMIT_RATIO)) {
        springTo(0, v); // 振り切り → 実行してその場でスナップして戻す
        lead.onClick();
        return;
      }
      let target: number;
      if (v > FLICK_VELOCITY) target = leadWidth;
      else if (v < -FLICK_VELOCITY) target = 0;
      else target = cur >= leadWidth / 2 ? leadWidth : 0;
      springTo(target, v);
      return;
    }

    // 左スワイプ
    let target: number;
    if (v < -FLICK_VELOCITY) target = -openWidth;
    else if (v > FLICK_VELOCITY) target = 0;
    else target = cur <= -openWidth / 2 ? -openWidth : 0;
    springTo(target, v);
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
