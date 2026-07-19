"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDevice } from "@/lib/useDevice";

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
// 右へ「振り切った（行幅分いっぱいまでスワイプ）」とみなす割合。これを超えたら
// ボタンを押さなくても実行する。
const LEAD_COMMIT_RATIO = 0.9;

// 横方向の意図を判定する不感帯(px)。これを超えるまでは反応しない。
const AXIS_DEADZONE = 6;
// フリック判定の速度しきい値(px/ms)。これ以上の速さで離すと、距離が足りなくても
// その向きへスナップする。
const FLICK_VELOCITY = 0.5;
// 指を離した後の収束に使うバネ（ほぼ臨界減衰＝オーバーシュートしにくい）。
const SPRING_K = 220; // 剛性
const SPRING_C = 30; // 減衰（やや高め）

// --- トラックパッド(2本指スクロール)の効き具合。数値を上げるほど敏感になる ---
const WHEEL_SENSITIVITY = 0.4;
const WHEEL_AXIS_RATIO = 1.5;
const WHEEL_START_PX = 30;

// 開いている行は常に1つだけにする。別の行で横スワイプが始まったら、前に開いて
// いた行を閉じる。フォルダ一覧・メモ一覧をまたいで単一にしたいのでモジュール
// レベルに1つだけ持つ。
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

// 左スワイプで右側にアクション（共有・移動・削除など）、右スワイプで左側に
// リーディングアクション（ピン留め）を表示する行（⑥）。ドラッグ中は指に 1:1 で
// 追従し、離した後だけバネで収束する。アニメ中に触れば即座に追従を再開できる。
export default function SwipeRow({
  actions,
  children,
  disabled = false,
  className = "",
  compact = false,
  contentClassName = "bg-white dark:bg-neutral-950",
  // 右スワイプで左側に出す単一アクション（ピン留めなど）。振り切ると押さずに実行。
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
  const [offset, setOffset] = useState(0); // 現在の表示ずらし量(px)
  // 振り切りゾーンに入っているか（合図表示用）
  const [committing, setCommitting] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null); // バネアニメの rAF id
  const start = useRef({ x: 0, y: 0, base: 0 });
  const axis = useRef<"none" | "x" | "y">("none");
  // 速度計測（offset 方向, px/ms）。離した瞬間のフリック判定とバネ初速に使う。
  const vel = useRef({ x: 0, t: 0, v: 0 });
  const wasCommitting = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelAccum = useRef(0);
  const offsetRef = useRef(0);
  offsetRef.current = offset;
  const leadingActionRef = useRef(leadingAction);
  leadingActionRef.current = leadingAction;

  const actionWidth = compact ? ACTION_WIDTH_COMPACT : ACTION_WIDTH_NORMAL;
  const openWidth = actions.length * actionWidth;
  const hasLead = !!leadingAction;
  const leadWidth = LEAD_WIDTH;

  const cancelSpring = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // closeSelf は openRegistry の同一判定に使うので安定させる（最新の springTo は
  // ref 経由で呼ぶ）。
  const springToRef = useRef<(target: number, v0?: number) => void>(() => {});
  const closeSelf = useCallback(() => {
    setCommitting(false);
    wasCommitting.current = false;
    springToRef.current(0, 0);
  }, []);

  // 指を離した後の収束（バネ）。初速 v0(px/ms) を引き継ぐ。毎フレーム offset を
  // 更新するので、途中で touch されれば offsetRef から現在位置を拾って追従再開できる。
  const springTo = useCallback(
    (target: number, v0 = 0) => {
      cancelSpring();
      let x = offsetRef.current;
      let v = v0 * 1000; // px/ms -> px/s
      let last = performance.now();
      const step = (now: number) => {
        let dt = (now - last) / 1000;
        last = now;
        if (dt > 0.032) dt = 0.032; // タブ復帰などの大ジャンプを抑える
        const a = -SPRING_K * (x - target) - SPRING_C * v;
        v += a * dt;
        x += v * dt;
        if (Math.abs(x - target) < 0.5 && Math.abs(v) < 8) {
          rafRef.current = null;
          setOffset(target);
          if (target === 0 && openRegistry.close === closeSelf) {
            openRegistry.close = null;
          }
          return;
        }
        setOffset(x);
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancelSpring, closeSelf],
  );
  springToRef.current = springTo;

  // 横スワイプが始まったときに呼ぶ。前に開いていた別の行を閉じ、自分を登録する。
  const beginOpen = useCallback(() => {
    if (openRegistry.close && openRegistry.close !== closeSelf) {
      openRegistry.close();
    }
    openRegistry.close = closeSelf;
  }, [closeSelf]);

  // アンマウント時の掃除（開いたまま消えた場合）。
  useEffect(
    () => () => {
      cancelSpring();
      if (openRegistry.close === closeSelf) openRegistry.close = null;
    },
    [cancelSpring, closeSelf],
  );

  // トラックパッド（iPadのキーボード接続時など）の2本指・横スクロールでも操作できる。
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
          if (inZone !== wasCommitting.current) {
            wasCommitting.current = inZone;
            setCommitting(inZone);
            if (inZone) fireHaptic();
          }
        }
        setOffset(next);
      }

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelAccum.current = 0;
        const cur = offsetRef.current;
        const rowW = rowRef.current?.offsetWidth ?? 0;
        const wasZone = wasCommitting.current;
        wasCommitting.current = false;
        setCommitting(false);
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
    // 割り込み：バネ収束中でも、触れた瞬間に現在位置から 1:1 追従を再開する。
    cancelSpring();
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: offsetRef.current };
    axis.current = "none";
    vel.current = { x: offsetRef.current, t: performance.now(), v: 0 };
    wasCommitting.current = false;
    setCommitting(false);
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    // 最初の動きで縦横どちらか判定（不感帯を超えるまでは反応しない）
    if (axis.current === "none") {
      if (Math.abs(dx) < AXIS_DEADZONE && Math.abs(dy) < AXIS_DEADZONE) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "x") beginOpen();
    }
    if (axis.current !== "x") return;

    // 1:1 追従。可動域の外はラバーバンド（移動量を 0.2 に減衰）。
    let next = start.current.base + dx;
    const rowW = rowRef.current?.offsetWidth ?? 0;
    if (next > 0) {
      if (!hasLead) next = next * 0.2;
      else if (next > rowW) next = rowW + (next - rowW) * 0.2;
    }
    if (next < -openWidth) next = -openWidth + (next + openWidth) * 0.2;

    // 速度計測（軽い平滑化）
    const now = performance.now();
    const dt = now - vel.current.t;
    if (dt > 0) {
      const inst = (next - vel.current.x) / dt;
      vel.current.v = vel.current.v * 0.4 + inst * 0.6;
      vel.current.x = next;
      vel.current.t = now;
    }

    // 振り切りゾーンの出入りを監視し、「未達→到達」でのみ合図（拡大・彩度・振動）。
    if (hasLead && next > 0) {
      const inZone = next >= rowW * LEAD_COMMIT_RATIO;
      if (inZone !== wasCommitting.current) {
        wasCommitting.current = inZone;
        setCommitting(inZone);
        if (inZone) fireHaptic();
      }
    } else if (wasCommitting.current) {
      wasCommitting.current = false;
      setCommitting(false);
    }

    setOffset(next);
  }

  function onTouchEnd() {
    if (axis.current !== "x") {
      axis.current = "none";
      return;
    }
    axis.current = "none";
    const rowW = rowRef.current?.offsetWidth ?? 0;
    const v = vel.current.v; // px/ms（右が正）
    const cur = offsetRef.current;
    const wasZone = wasCommitting.current;
    wasCommitting.current = false;
    setCommitting(false);

    if (cur > 0) {
      // 右スワイプ
      const lead = leadingAction;
      if (lead && (wasZone || cur >= rowW * LEAD_COMMIT_RATIO)) {
        // 振り切り → 実行してその場でスナップして戻す
        springTo(0, v);
        lead.onClick();
        return;
      }
      // ボタン表示ゾーン：フリック速度 or 位置で開閉を決める
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

  // 左スワイプの開き具合（0〜1）。右スワイプ中は 0。
  const revealRatio =
    openWidth > 0 ? Math.min(1, Math.max(0, -offset) / openWidth) : 0;

  // 各ボタンを「小さい状態から」スワイプ量に応じて順番にせり上げる（右端＝削除が先）。
  const n = actions.length;
  const actionStyle = (i: number) => {
    const p = Math.max(0, Math.min(1, n * revealRatio - (n - 1 - i)));
    return {
      transform: `scale(${0.2 + 0.8 * p})`,
      opacity: p,
    } as const;
  };

  // リーディングアクション（右スワイプ）。振り切りゾーンではわずかに拡大＋彩度を
  // 上げて「離せば実行」を伝える。
  const leadReveal =
    leadWidth > 0 ? Math.min(1, Math.max(0, offset) / leadWidth) : 0;
  const leadStyle = {
    transform: `scale(${(0.2 + 0.8 * leadReveal) * (committing ? 1.12 : 1)})`,
    opacity: leadReveal,
    filter: committing ? "brightness(1.18) saturate(1.35)" : "none",
    transition: committing
      ? "transform 120ms var(--ease-spring), filter 120ms ease-out"
      : "filter 120ms ease-out",
  } as const;

  return (
    <div
      ref={rowRef}
      className={`flow-swipe-row relative overflow-hidden ${className}`}
    >
      {/* 背後の（左スワイプ）アクション。スワイプ量に応じて拡大する */}
      <div className="absolute inset-y-0 right-0 flex">
        {actions.map((a, i) => (
          <div
            key={a.key}
            style={{ width: actionWidth }}
            className={`flex ${compact ? "p-0.5" : "p-1"}`}
          >
            <button
              onClick={() => {
                if (!a.keepOpen) closeSelf();
                a.onClick();
              }}
              style={actionStyle(i)}
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
        ))}
      </div>

      {/* 右スワイプで左側に出るリーディングアクション（ピン留め）。振り切ると
          押さずに実行される。 */}
      {leadingAction && (
        <div
          className="absolute inset-y-0 left-0 flex"
          style={{ width: Math.max(leadWidth, offset) }}
        >
          <div className="flex flex-1 p-1">
            <button
              onClick={() => {
                closeSelf();
                leadingAction.onClick();
              }}
              style={leadStyle}
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

      {/* 前面のコンテンツ。位置は offset を直接反映（バネも offset を毎フレーム
          更新するので transition は掛けない＝指に遅れない）。 */}
      <div
        className={`flow-swipe-content relative ${contentClassName}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        // 開いている状態で本体をタップしたら閉じる（誤操作防止）
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
