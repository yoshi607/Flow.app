// Apple Pencil での手書き入力。
//
// 【重要】この構成は iPad + Apple Pencil で「文字の2画目が描けない」不具合を
// 実機ログを取りながら潰した結果（旧・全画面手書き HandwritingCanvas から
// 切り出したもの。元コンポーネントは廃止済み）。安易に変えないこと:
//  - React の合成イベントではなくネイティブリスナーを使う
//  - setPointerCapture は使わない
//  - touchstart/touchmove を preventDefault して Safari のジェスチャー認識を
//    止める（これが無いと2画目の pointerdown が発火しない）
//  - pointerdown は window のキャプチャで受け、座標で領域内か判定する
//
// 本文中（スクロールする領域の中）に置くにあたって足したのは2点だけ:
//  - 領域判定に「見えている範囲」との重なりを加える
//  - 指はスクロールに使う（下の onDown を参照）

export type PenPoint = { x: number; y: number; pressure: number };

export type PenHandlers = {
  /** true なら指では描かない（手のひら誤爆を防ぐ既定） */
  penOnly: boolean;
  onStrokeStart: (p: PenPoint) => void;
  onStrokeMove: (points: PenPoint[]) => void;
  onStrokeEnd: () => void;
};

export type PenOptions = {
  /** 見えている範囲。領域判定に使う（省略時はキャンバス全体） */
  viewport?: HTMLElement | null;
  /** 指でなぞったときにスクロールさせる要素 */
  scroller?: HTMLElement | null;
};

export function attachPenInput(
  canvas: HTMLCanvasElement,
  handlers: { current: PenHandlers },
  options: PenOptions = {},
): () => void {
  const { viewport = null, scroller = null } = options;

  let drawing = false;
  let activeId: number | null = null;
  let strokeStart = 0;
  let penSeen = false;

  // 指1本でのスクロール中のポインタ
  let scrollId: number | null = null;
  let scrollFromY = 0;
  let scrollFromTop = 0;

  const pointOf = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pressureOf = (e: { pressure: number }) =>
    e.pressure && e.pressure > 0 ? e.pressure : 0.5;

  const penPointOf = (e: PointerEvent | { clientX: number; clientY: number; pressure: number }): PenPoint => {
    const p = pointOf(e);
    return { x: p.x, y: p.y, pressure: pressureOf(e) };
  };

  const shouldDraw = (e: PointerEvent) => {
    if (e.pointerType === "pen") {
      penSeen = true;
      return true;
    }
    if (e.pointerType === "mouse") return true; // PCでの確認用
    // touch（指・手のひら）:
    //  - ペンのみモード（既定）では一切描かない＝手のひら誤爆を完全に防ぐ
    //  - ペンが一度でも使われたら、以後 touch は無視
    if (handlers.current.penOnly) return false;
    if (penSeen) return false;
    return true;
  };

  // キャンバス領域内か（要素ではなく座標で判定する。Safari がイベントを
  // 別要素へリターゲットしても取りこぼさないようにするため）。
  // スクロールする領域の中にあるので、見えている範囲との重なりで判定する。
  const insideCanvas = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const v = viewport ? viewport.getBoundingClientRect() : r;
    return (
      e.clientX >= Math.max(r.left, v.left) &&
      e.clientX <= Math.min(r.right, v.right) &&
      e.clientY >= Math.max(r.top, v.top) &&
      e.clientY <= Math.min(r.bottom, v.bottom)
    );
  };

  const endStroke = () => {
    if (!drawing) return;
    drawing = false;
    activeId = null;
    handlers.current.onStrokeEnd();
  };

  // ツールバーや色・太さのポップアップの上での操作は描画にしない。
  // これらはキャンバスの上に重なって表示されるため、座標だけの判定では
  // 「キャンバス内」とみなされ、ペンで選ぶと同時に点が入ってしまう。
  // 【重要】e.target での判定は不可。Safari は Apple Pencil の pointerdown の
  // ターゲットを別要素へ付け替えるため、closest がすり抜ける（座標判定にして
  // いるのと同じ理由）。UI 要素の矩形との重なりで座標判定する。
  const overUi = (ev: PointerEvent) => {
    const els = document.querySelectorAll("[data-sketch-ui]");
    for (const el of Array.from(els)) {
      const r = el.getBoundingClientRect();
      if (
        ev.clientX >= r.left &&
        ev.clientX <= r.right &&
        ev.clientY >= r.top &&
        ev.clientY <= r.bottom
      ) {
        return true;
      }
    }
    return false;
  };

  const onDown = (e: PointerEvent) => {
    if (overUi(e)) return;

    // 指はメモのスクロールに使う。
    // ※ touchstart/touchmove は下で全て preventDefault しており、ブラウザ標準の
    //   スクロールは効かない（2画目対策を緩めないため）。そこで scrollTop を
    //   自分で動かす。判定は実績のある pointerType のみに頼る。
    if (e.pointerType === "touch" && handlers.current.penOnly) {
      if (!scroller || !insideCanvas(e)) return;
      scrollId = e.pointerId;
      scrollFromY = e.clientY;
      scrollFromTop = scroller.scrollTop;
      return;
    }

    if (!shouldDraw(e)) return;
    if (!insideCanvas(e)) return;
    e.preventDefault();
    // 前の筆が pointerup を取りこぼしていても、必ず新しい筆として開始する
    drawing = true;
    activeId = e.pointerId;
    strokeStart = e.timeStamp;
    handlers.current.onStrokeStart(penPointOf(e));
  };

  const onMove = (e: PointerEvent) => {
    if (scrollId === e.pointerId) {
      if (scroller) scroller.scrollTop = scrollFromTop - (e.clientY - scrollFromY);
      return;
    }
    if (!shouldDraw(e)) return;

    // 【重要】down/up の記録だけに頼らず、「今ペンが実際に触れているか」を
    // buttons / pressure で判断する。iOS では画の途中で pointerup が
    // 届いてしまうことがあり、それ以降の move が全て無視されて
    // 「点しか描かれない＝2画目が反応しない」状態になっていた。
    const pressed =
      e.buttons > 0 || (e.pointerType !== "mouse" && e.pressure > 0);

    if (!pressed) {
      // ペンが浮いている（ホバー移動）→ 筆を終える
      if (drawing && activeId === e.pointerId) endStroke();
      return;
    }

    // 触れているのに筆が始まっていない（up の誤検知・取りこぼし）→
    // ここから筆を再開する。これにより画が途中で切れなくなる。
    if (!drawing || activeId !== e.pointerId) {
      // 【重要】ここでも UI 判定が要る。ペンでスウォッチをタップすると微小な
      // 動きで onMove が発火し、スウォッチはキャンバスの上に重なっているため、
      // insideCanvas だけだと「筆の再開」として点が描かれてしまう。
      if (overUi(e)) return;
      if (!insideCanvas(e)) return;
      drawing = true;
      activeId = e.pointerId;
      strokeStart = e.timeStamp;
      handlers.current.onStrokeStart(penPointOf(e));
      return;
    }

    e.preventDefault();
    // 速く書くと move が間引かれるため、中間点(coalesced events)も全て拾う
    const coalesced =
      typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const source = coalesced.length > 0 ? coalesced : [e];
    handlers.current.onStrokeMove(source.map((pe) => penPointOf(pe)));
  };

  const onUp = (e: PointerEvent) => {
    if (scrollId === e.pointerId) {
      scrollId = null;
      return;
    }
    if (!drawing) return;
    // 今描いている筆の pointerup 以外は無視（手のひら等の指を弾く）。
    // ※ activeId が null のときに素通りしないよう、厳密に比較する。
    if (activeId !== e.pointerId) return;
    // 【重要】iOS は pointerId を使い回すことがあり、1画目の pointerup が
    // 2画目の pointerdown より遅れて届くと、この筆を誤って終了させてしまう
    // （＝2画目が描けない）。筆の開始より前に発生した up は捨てる。
    if (e.timeStamp < strokeStart) return;
    endStroke();
  };

  // pointercancel は「遅れて届いた古いup」判定を適用せず、確実に筆を終える
  const onCancel = (e: PointerEvent) => {
    if (scrollId === e.pointerId) {
      scrollId = null;
      return;
    }
    if (activeId !== e.pointerId) return;
    endStroke();
  };

  // 【重要】Safari は Apple Pencil に対して touch-action:none を効かせず、
  // ジェスチャー認識（ダブルタップ等）が働いて2画目の pointerdown を
  // 握りつぶすことがある。ペン/指のタッチ既定動作をここで明示的に止める。
  const blockTouch = (e: TouchEvent) => e.preventDefault();

  // pointerdown も window のキャプチャで受ける（要素へのリターゲットや
  // 途中での stopPropagation に影響されないようにするため）
  window.addEventListener("pointerdown", onDown, {
    passive: false,
    capture: true,
  });
  canvas.addEventListener("touchstart", blockTouch, { passive: false });
  canvas.addEventListener("touchmove", blockTouch, { passive: false });
  // move/up は window で受ける（指が要素外へ出ても筆が途切れないように）
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);

  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    canvas.removeEventListener("touchstart", blockTouch);
    canvas.removeEventListener("touchmove", blockTouch);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };
}
