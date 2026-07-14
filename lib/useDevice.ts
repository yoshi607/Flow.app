"use client";

import { useEffect, useState } from "react";

// 端末種別。iPhone/iPad/タッチ端末でだけ有効にしたい挙動の出し分けに使う。
//
// ⚠️ Web アプリなので端末判定は「推測」であり 100% ではない。
//   - iPadOS の Safari はデスクトップ表示だと自身を "Macintosh" と名乗るため、
//     「Mac なのにタッチがある＝iPad」というヒューリスティックで判定している。
//   - そのためタッチ対応の Windows PC を iPad と誤判定し得る。手書きなど
//     ペン前提の機能は isPen（スタイラス）も併せて見て最終判断すること。
export interface DeviceInfo {
  /** 指/ペンなどの粗いポインタを持つ（＝タッチ端末） */
  isTouch: boolean;
  /** iPhone */
  isIPhone: boolean;
  /** iPad（iPadOS の Mac 偽装も含めて推定） */
  isIPad: boolean;
  /** iOS/iPadOS のいずれか */
  isIOS: boolean;
  /** SSR/初回描画が終わりクライアント判定が確定したか */
  ready: boolean;
}

const initial: DeviceInfo = {
  isTouch: false,
  isIPhone: false,
  isIPad: false,
  isIOS: false,
  ready: false,
};

function detect(): DeviceInfo {
  if (typeof navigator === "undefined") return initial;
  const ua = navigator.userAgent;
  const maxTouch = navigator.maxTouchPoints ?? 0;
  const isTouch =
    maxTouch > 0 ||
    (typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches);

  const isIPhone = /iPhone/.test(ua);
  // 明示的な iPad、または「Mac を名乗るがタッチがある」= iPadOS の偽装
  const isIPad =
    /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);
  const isIOS = isIPhone || isIPad || /iPod/.test(ua);

  return { isTouch: !!isTouch, isIPhone, isIPad, isIOS, ready: true };
}

/** クライアントでのみ端末種別を判定して返す（SSR では全て false→マウント後に確定）。 */
export function useDevice(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(initial);
  useEffect(() => {
    setInfo(detect());
  }, []);
  return info;
}
