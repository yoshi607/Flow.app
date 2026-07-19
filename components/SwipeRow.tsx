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
const LEAD_WIDTH = 96; // 右スワイプで出るリーディングアクション（ピン留め）の幅。少し横長。

// --- トラックパッド(2本指スクロール)の効き具合。数値を上げるほど敏感になる ---
// スクロール量に対して実際に開く量の比率（1.0 で等倍＝かなり敏感）
const WHEEL_SENSITIVITY = 0.4;
// 横方向が縦方向のこの倍率を超えたときだけ反応する（縦スクロール中の誤爆防止）
const WHEEL_AXIS_RATIO = 1.5;
// 横に累計これだけ動くまでは開き始めない（触れただけで開かないための「あそび」）
const WHEEL_START_PX = 30;

// 開いている行は常に1つだけにする。別の行で横スワイプが始まったら、前に開いて
// いた行を閉じる（＝スライドのアニメーションで元に戻す）。フォルダ一覧・メモ一覧
// をまたいで単一にしたいので、モジュールレベルに1つだけ持つ。
const openRegistry: { close: (() => void) | null } = { close: null };

// 左スワイプで右側にアクション（共有・移動・削除など）を表示する行（⑥）。
// タッチ端末でのみジェスチャーを有効化し、非タッチ端末では
// そのまま children を表示する（右クリック等は各画面の別UIで対応）。
export default function SwipeRow({
  actions,
  children,
  disabled = false,
  className = "",
  // 背の低い行（フォルダ一覧）でアクションが枠からはみ出さないよう、
  // アイコン・文字を一回り小さくした詰めた表示にする。
  compact = false,
  // スワイプで動く前面の背景。背後のアクションを隠すため不透明である必要がある。
  // 置かれる場所の地色に合わせて差し替える（既定は本文一覧の白）。
  contentClassName = "bg-white dark:bg-neutral-950",
  // 右スワイプで左側に出す単一アクション（ピン留めなど）。スワイプしきると
  // ボタンを押さなくても実行する。
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
  const [offset, setOffset] = useState(0); // 現在の表示ずらし量(px, 0以下)
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0, base: 0 });
  const axis = useRef<"none" | "x" | "y">("none");
  const rowRef = useRef<HTMLDivElement>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 「あそび」判定用に、今回のスクロールで横に動いた累計量
  const wheelAccum = useRef(0);
  // 最新の offset をリスナーから読むための控え
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const actionWidth = compact ? ACTION_WIDTH_COMPACT : ACTION_WIDTH_NORMAL;
  const openWidth = actions.length * actionWidth;
  const hasLead = !!leadingAction;
  const leadWidth = LEAD_WIDTH;
  // 右スワイプ用リーディングアクションの最新値を native wheel リスナーから読む控え。
  const leadingActionRef = useRef(leadingAction);
  leadingActionRef.current = leadingAction;

  // この行を閉じる（他の行から呼ばれても同じ）。インスタンスごとに安定させ、
  // openRegistry の同一判定に使う。
  const closeSelf = useCallback(() => setOffset(0), []);

  // 横スワイプが始まったときに呼ぶ。前に開いていた別の行を閉じ、自分を登録する。
  const beginOpen = useCallback(() => {
    if (openRegistry.close && openRegistry.close !== closeSelf) {
      openRegistry.close(); // 前の行をスライドで元に戻す
    }
    openRegistry.close = closeSelf;
  }, [closeSelf]);

  // 閉じ切ったら登録を外す。アンマウント時も同様（開いたまま消えた場合の掃除）。
  useEffect(() => {
    if (offset === 0 && openRegistry.close === closeSelf) {
      openRegistry.close = null;
    }
  }, [offset, closeSelf]);
  useEffect(
    () => () => {
      if (openRegistry.close === closeSelf) openRegistry.close = null;
    },
    [closeSelf],
  );

  // トラックパッド（iPadのキーボード接続時など）の2本指・横スクロールでも
  // アクションを開けるようにする。指のスワイプは touch イベント側で処理。
  // ※ preventDefault が必要なため、passive:false のネイティブリスナーで登録する。
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // 明確に横方向のときだけ反応（縦スクロールは邪魔しない）
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * WHEEL_AXIS_RATIO) return;
      e.preventDefault();

      // 開き始めるまでの「あそび」。少し触れただけでは動かさない。
      // 既に開いている最中はそのまま追従させる。
      wheelAccum.current += e.deltaX;
      const engaged =
        offsetRef.current !== 0 || Math.abs(wheelAccum.current) > WHEEL_START_PX;

      if (engaged) {
        beginOpen(); // 他の開いている行を閉じる
        const rowW = rowRef.current?.offsetWidth ?? 0;
        let next = offsetRef.current - e.deltaX * WHEEL_SENSITIVITY;
        // 右方向（正）はリーディングアクションがある行のみ。行幅まで引ける。
        const maxRight = leadingActionRef.current ? rowW : 0;
        if (next > maxRight) next = maxRight;
        if (next < -openWidth) next = -openWidth;
        setDragging(true); // 追従中はアニメーションを切る
        setOffset(next);
      }

      // スクロールが止まったら開/閉にスナップする
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelAccum.current = 0;
        setDragging(false);
        const cur = offsetRef.current;
        if (cur > 0) {
          // 右スワイプ：しきり（行幅の半分超）ならボタンを押さず実行、そうでなければ
          // ボタンを表示した状態でスナップ、浅ければ閉じる。
          const rowW = rowRef.current?.offsetWidth ?? 0;
          const lead = leadingActionRef.current;
          if (lead && cur >= rowW * 0.5) {
            setOffset(0);
            lead.onClick();
          } else {
            setOffset(cur >= leadWidth / 2 ? leadWidth : 0);
          }
        } else {
          setOffset(cur < -openWidth / 2 ? -openWidth : 0);
        }
      }, 140);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
    // isTouch/disabled を依存に入れるのは必須。初回描画は端末判定前で
    // isTouch=false のため ref の付かない div が描画され、この effect は
    // rowRef.current=null で何もせず終わる。判定後に描画が切り替わった
    // タイミングで再実行しないと、wheel リスナーが永久に付かない。
  }, [openWidth, isTouch, disabled, beginOpen]);

  if (!isTouch || disabled || actions.length === 0) {
    return <div className={className}>{children}</div>;
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: offset };
    axis.current = "none";
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    // 最初の動きで縦横どちらのジェスチャーか判定
    if (axis.current === "none") {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      // 横スワイプと確定した瞬間に、前に開いていた別の行を閉じる
      if (axis.current === "x") beginOpen();
    }
    if (axis.current !== "x") return;
    let next = start.current.base + dx;
    // 開ける範囲：左（アクション）は 0〜-openWidth、右（ピン留め）はリーディング
    // アクションがある行のみ 0〜行幅まで（しきりで実行するため広く引ける）。少し弾性。
    const rowW = rowRef.current?.offsetWidth ?? 0;
    if (next > 0) {
      if (!hasLead) next = next * 0.2;
      else if (next > rowW) next = rowW + (next - rowW) * 0.2;
    }
    if (next < -openWidth) next = -openWidth + (next + openWidth) * 0.2;
    setOffset(next);
  }

  function onTouchEnd() {
    setDragging(false);
    if (axis.current !== "x") return;
    if (offset > 0) {
      // 右スワイプ：しきり（行幅の半分超）ならボタンを押さず実行、そうでなければ
      // ボタンを表示した状態でスナップ、浅ければ閉じる。
      const rowW = rowRef.current?.offsetWidth ?? 0;
      if (leadingAction && offset >= rowW * 0.5) {
        setOffset(0);
        leadingAction.onClick();
      } else {
        setOffset(offset >= leadWidth / 2 ? leadWidth : 0);
      }
      return;
    }
    // 左スワイプ：半分以上開いていれば全開、そうでなければ閉じる
    setOffset(offset < -openWidth / 2 ? -openWidth : 0);
  }

  // スワイプの開き具合（0〜1）。これに応じてアクションを小→大に見せる。
  // 左スワイプ（offset<0）のときだけ効かせる（右スワイプ中は 0）。
  const revealRatio =
    openWidth > 0 ? Math.min(1, Math.max(0, -offset) / openWidth) : 0;

  // 各ボタンを「小さい状態から」スワイプ量に応じて順番に現れさせる。
  // 前面のコンテンツは不透明でボタンを覆っているため、スワイプで“覆いが外れた”
  // ボタンから見えていく。右端（削除）が最初に外れ、手前のボタンほど後に外れる。
  // そこで各ボタンは「自分の覆いが外れる区間」で小→大にせり上がるようにし、
  // スワイプすると順番に・小さいものから大きく育って見えるようにする。
  const n = actions.length;
  const actionStyle = (i: number) => {
    // i=0 が手前、i=n-1 が右端。右端(n-1)は revealRatio 0〜1/n で、
    // 手前(0)は (n-1)/n〜1 で 0→1 になる。
    const p = Math.max(0, Math.min(1, n * revealRatio - (n - 1 - i)));
    return {
      transform: `scale(${0.2 + 0.8 * p})`,
      opacity: p,
      transition: dragging
        ? "none"
        : "transform 200ms var(--ease-spring), opacity 200ms ease-out",
    } as const;
  };

  // リーディングアクション（右スワイプ）も同じ質感で小→大にせり上げる。
  const leadRatio =
    leadWidth > 0 ? Math.min(1, Math.max(0, offset) / leadWidth) : 0;
  const leadStyle = {
    transform: `scale(${0.2 + 0.8 * leadRatio})`,
    opacity: leadRatio,
    transition: dragging
      ? "none"
      : "transform 200ms var(--ease-spring), opacity 200ms ease-out",
  } as const;

  return (
    <div
      ref={rowRef}
      className={`flow-swipe-row relative overflow-hidden ${className}`}
    >
      {/* 背後のアクション（丸みのある四角ボタン）。スワイプ量に応じて拡大する */}
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

      {/* 右スワイプで左側に出るリーディングアクション（ピン留め）。スワイプ量に
          応じて領域が広がり、しきると押さずに実行される。 */}
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

      {/* 前面のコンテンツ */}
      <div
        className={`flow-swipe-content relative ${contentClassName} ${
          dragging ? "dragging" : ""
        }`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        // 開いている状態で本体をタップしたら閉じる（誤操作防止）
        onClickCapture={(e) => {
          if (offset !== 0) {
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
