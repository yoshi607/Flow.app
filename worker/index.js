// カスタム Service Worker（プッシュ通知）
//
// next-pwa が生成する sw.js から importScripts される。ここに書いたハンドラは
// アプリが閉じていても（ブラウザが SW を起こして）実行される。
//
// ※ このファイルは Service Worker の文脈で動くため、React や @/ エイリアスは
//    使えない。素の DOM/SW API のみで書くこと。

// サーバー（/api/cron/expiry-notify）が送る JSON の形：
//   { title: string, body: string, url: string, tag?: string }
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // JSON で送れなかった場合の保険（本文だけ出す）
    payload = { title: "Flow", body: event.data.text(), url: "/" };
  }

  const title = payload.title || "Flow";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // 同じ tag の通知は積み重ならず置き換わる。1日1通なので、
    // 再送時に通知欄が埋まらないようにする。
    tag: payload.tag || "flow-notification",
    // タップ時にどこを開くかを notificationclick 側へ渡す
    data: { url: payload.url || "/" },
  };

  // waitUntil を付けないと、表示前に SW が停止されることがある
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        // 起動済みだがフォーカスされていないウィンドウも拾う
        includeUncontrolled: true,
      });

      // 既に開いているウィンドウがあれば、それを使い回して遷移する
      // （PWA を二重に開かないため）
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // 別オリジンなどで navigate が失敗しても、フォーカスまでは済んでいる
            }
          }
          return;
        }
      }

      // 開いているウィンドウが無ければ新しく開く
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
