"use client";

// ===================================================================
// 【一時的な調査用コード】トラックパッドのスワイプ カクつき原因の計測
//
// 裏付けが取れたらこのファイルごと削除する。削除する場合は併せて
//   - components/SwipeDebugOverlay.tsx（画面表示）を削除
//   - components/AppShell.tsx の SwipeDebugOverlay の記述を削除
//   - components/SwipeRow.tsx の dbg(...) 呼び出しと import を削除
// を行うこと。
//
// iPad では Safari の DevTools（console）が使えないため、記録した値を
// その場で自動判定して画面に出す。生ログはクリップボードへコピーできる。
// ===================================================================

/** これを false にすると計測は一切走らない（記録も判定もしない）。 */
export const WHEEL_DEBUG = true;

/** SwipeRow.tsx の FLICK_VELOCITY と同じ値。判定の再現に使う。 */
const FLICK_VELOCITY = 0.3;
/** 「指を止めた」とみなす、最後の wheel イベントからの経過時間(ms)。 */
const STALE_VELOCITY_MS = 250;
/** 補間ループのフレーム間隔がこれを超えたら「穴」とみなす(ms)。 */
const FRAME_GAP_MS = 30;

export type DebugRow = Record<string, string | number | boolean | null>;

/** 1ジェスチャーぶんの記録と、そこから導いた判定。 */
export interface GestureReport {
  id: number;
  reason: string;
  durationMs: number;
  rows: DebugRow[];
  /** 原因1: バネ実行中に、確定済みの行き先と食い違う古い基準で再接触した */
  staleBase: number;
  /** 原因1の症状: deltaX が入り続けているのに目標が 0 に張り付いている */
  pinnedAtZero: number;
  /** 原因2: 指を止めてから時間が経っているのにフリック判定になった */
  staleVelocity: number;
  /** 原因2 の最悪ケース（経過ms と そのときの速度） */
  worstStaleVel: { age: number; v: number } | null;
  /** 原因3: ジェスチャー中盤で engaged が外れた */
  engagedDropout: number;
  /** 補間ループのフレーム間隔の最大値(ms) */
  maxFrameGap: number;
  /** wheel イベント間隔の最大値(ms)。バースト具合の把握用 */
  maxEventGap: number;
  frameCount: number;
  wheelCount: number;
}

const rows: DebugRow[] = [];
let lastWheelT = 0;
let nextId = 1;
const reports: GestureReport[] = [];
const listeners = new Set<() => void>();
// useSyncExternalStore は同一参照を返し続ける必要があるので、更新時だけ差し替える。
let snapshot: GestureReport[] = [];

const r2 = (n: number) => Math.round(n * 100) / 100;
export { r2 };

function emit() {
  snapshot = reports.slice();
  listeners.forEach((fn) => fn());
}

export function subscribeSwipeDebug(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function getSwipeDebugSnapshot(): GestureReport[] {
  return snapshot;
}
/** SSR 用（サーバーでは常に空）。 */
export function getSwipeDebugServerSnapshot(): GestureReport[] {
  return EMPTY;
}
const EMPTY: GestureReport[] = [];

export function clearSwipeDebug() {
  reports.length = 0;
  rows.length = 0;
  lastWheelT = 0;
  emit();
}

/** 最後の wheel イベント時刻を覚える（settle 時の「経過時間」算出用）。 */
export function markWheelEvent(t: number) {
  lastWheelT = t;
}
export function getLastWheelT() {
  return lastWheelT;
}
export function resetLastWheelT() {
  lastWheelT = 0;
}

export function dbg(kind: string, fields: DebugRow) {
  if (!WHEEL_DEBUG) return;
  rows.push({ t: r2(performance.now()), kind, ...fields });
  // バネが最後まで収束しないまま操作が続くと flush されないので、上限で古い方を捨てる。
  if (rows.length > 4000) rows.splice(0, rows.length - 4000);
}

const num = (v: DebugRow[string]) => (typeof v === "number" ? v : NaN);

/** 記録から原因1〜3を自動判定して、1件のレポートにまとめる。 */
function analyze(src: DebugRow[]): Omit<GestureReport, "id" | "reason" | "rows"> {
  let staleBase = 0;
  let pinnedAtZero = 0;
  let staleVelocity = 0;
  let worstStaleVel: { age: number; v: number } | null = null;
  let engagedDropout = 0;
  let maxFrameGap = 0;
  let maxEventGap = 0;
  let frameCount = 0;
  let wheelCount = 0;

  // バネが飛行中かどうかと、その確定済みの行き先を追う（原因1の判定に使う）。
  let springTarget: number | null = null;
  let sawEngaged = false;
  let zeroPinRun = 0;

  for (const row of src) {
    switch (row.kind) {
      case "spring":
        springTarget = num(row.target);
        break;
      case "rest":
        springTarget = null;
        break;
      case "frame": {
        frameCount++;
        const dt = num(row.dt);
        if (dt > maxFrameGap) maxFrameGap = dt;
        break;
      }
      case "wheel": {
        wheelCount++;
        const gap = num(row.evDt);
        if (Number.isFinite(gap) && gap > maxEventGap) maxEventGap = gap;

        // 原因1: バネ飛行中の再接触で、判定の基準（restPos）が
        // すでに確定している行き先と食い違っている。
        if (springTarget !== null && num(row.restPos) !== springTarget) {
          staleBase++;
        }
        // 原因1の症状: 入力は入っているのに目標が 0 に張り付いたまま
        // （clampPosition が反対側の壁で止めている）。
        if (Math.abs(num(row.dx)) > 0 && num(row.target) === 0) {
          zeroPinRun++;
          if (zeroPinRun >= 3) pinnedAtZero++;
        } else {
          zeroPinRun = 0;
        }

        // 原因3: 一度 engaged になった後に外れた
        if (row.engaged === true) sawEngaged = true;
        else if (sawEngaged && Math.abs(num(row.dx)) > 0) engagedDropout++;
        break;
      }
      case "settle": {
        const age = num(row.wheelAge);
        const v = num(row.v);
        // 原因2: 指を止めてから十分に時間が経っているのにフリック判定
        if (Number.isFinite(age) && age > STALE_VELOCITY_MS && Math.abs(v) > FLICK_VELOCITY) {
          staleVelocity++;
          if (!worstStaleVel || age > worstStaleVel.age) {
            worstStaleVel = { age: r2(age), v: r2(v) };
          }
        }
        break;
      }
    }
  }

  return {
    durationMs: src.length ? r2(num(src[src.length - 1].t) - num(src[0].t)) : 0,
    staleBase,
    pinnedAtZero,
    staleVelocity,
    worstStaleVel,
    engagedDropout,
    maxFrameGap: r2(maxFrameGap),
    maxEventGap: r2(maxEventGap),
    frameCount,
    wheelCount,
  };
}

/** バネが静止した時点で、溜めた記録を1ジェスチャーとして確定させる。 */
export function dbgFlush(reason: string) {
  if (!WHEEL_DEBUG || rows.length === 0) return;
  const src = rows.splice(0, rows.length);
  const t0 = num(src[0].t);
  for (const row of src) row.t = r2(num(row.t) - t0);

  reports.unshift({ id: nextId++, reason, rows: src, ...analyze(src) });
  if (reports.length > 20) reports.length = 20;
  emit();
}

/** クリップボードへ貼る用のテキスト。frame 行は穴だけ残して間引く。 */
export function buildSwipeDebugText(): string {
  if (reports.length === 0) return "（記録なし）";
  const out: string[] = [];
  out.push(`# SwipeRow 計測結果（新しい順・${reports.length}ジェスチャー）`);
  out.push(
    `判定基準: フリック=${FLICK_VELOCITY}px/ms / 速度の陳腐化=${STALE_VELOCITY_MS}ms超 / フレームの穴=${FRAME_GAP_MS}ms超`,
  );
  out.push("");

  for (const rep of reports) {
    out.push(
      `## #${rep.id} ${rep.reason} — ${rep.durationMs}ms / wheel${rep.wheelCount}件 frame${rep.frameCount}件`,
    );
    out.push(
      `原因1 古い基準での再接触=${rep.staleBase} / 0に張り付き=${rep.pinnedAtZero}`,
    );
    out.push(
      `原因2 陳腐化した速度でフリック判定=${rep.staleVelocity}` +
        (rep.worstStaleVel
          ? `（最悪: 停止から${rep.worstStaleVel.age}ms後に v=${rep.worstStaleVel.v}）`
          : ""),
    );
    out.push(`原因3 engaged の脱落=${rep.engagedDropout}`);
    out.push(
      `フレーム間隔の最大=${rep.maxFrameGap}ms / wheelイベント間隔の最大=${rep.maxEventGap}ms`,
    );

    // frame 行は穴だけ残す（そのままだと量が多すぎて貼れない）。
    const kept = rep.rows.filter(
      (row) => row.kind !== "frame" || num(row.dt) > FRAME_GAP_MS,
    );
    out.push("```");
    for (const row of kept) {
      const { t, kind, ...rest } = row;
      const body = Object.entries(rest)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      out.push(`${String(t).padStart(7)} ${String(kind).padEnd(10)} ${body}`);
    }
    out.push("```");
    out.push("");
  }
  return out.join("\n");
}

export { FRAME_GAP_MS, STALE_VELOCITY_MS, FLICK_VELOCITY };
