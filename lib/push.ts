// プッシュ通知（購読の開始・解除）のクライアント側ヘルパー。
//
// 実際の通知表示は worker/index.js（カスタム Service Worker）が行い、
// 配信は /api/cron/expiry-notify が行う。ここは「この端末を宛先として
// 登録する／外す」だけを担当する。

/** この端末・ブラウザがプッシュ通知に対応しているか */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * iOS（iPhone / iPad）で「ホーム画面に追加」された状態か。
 * iOS の Web Push は iOS 16.4 以降かつインストール済み PWA でのみ動作し、
 * Safari のタブで開いている間は購読自体ができない。
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari だけが持つ独自プロパティ
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS は既定で Mac を名乗るため、タッチの有無で見分ける
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** 現在の通知許可の状態。未対応端末では "unsupported" を返す */
export function permissionState(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** この端末が既に購読済みか */
export async function getSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * 通知を購読する。
 * ※ Notification.requestPermission() は「ユーザー操作から同期的に始まる処理」
 *    でないと iOS が拒否するため、必ずボタンの onClick から呼ぶこと。
 */
export async function subscribePush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("この端末では通知を利用できません");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "通知が許可されませんでした。端末の設定から Flow の通知を許可してください。",
    );
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    throw new Error("通知の設定が未完了です（VAPID 公開鍵が未設定）");
  }

  const registration = await navigator.serviceWorker.ready;

  // 既に購読済みならそれを再利用する（サーバー側は upsert なので送り直して良い）
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // 「通知を必ず表示する」約束。false は事実上使えない
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    }));

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "通知の登録に失敗しました");
  }
}

/** 購読を解除する（この端末の宛先をサーバーからも消す） */
export async function unsubscribePush(): Promise<void> {
  const subscription = await getSubscription();
  if (!subscription) return;

  // 先にサーバーの行を消す。ブラウザ側だけ消えてサーバーに残ると、
  // 届かない宛先へ送り続けることになるため。
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {
    // 通信に失敗しても、無効な宛先は配信時に 404/410 で自動削除される
  });

  await subscription.unsubscribe();
}

/**
 * VAPID 公開鍵（base64url 文字列）を pushManager.subscribe が要求する
 * Uint8Array へ変換する。Push API の仕様上この変換が必要。
 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // ArrayBuffer から作る。`new Uint8Array(長さ)` だと型が
  // Uint8Array<ArrayBufferLike> になり、applicationServerKey が要求する
  // ArrayBuffer 由来のビューと合わずに型エラーになるため。
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
