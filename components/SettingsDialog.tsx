"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useNotes } from "@/lib/store";
import { passwordIssue } from "@/lib/passwordPolicy";
import {
  MIN_SHORT_NOTE_DAYS,
  MAX_SHORT_NOTE_DAYS,
  TRASH_RETENTION_DAYS,
} from "@/lib/types";
import splashScreens from "@/lib/splashScreens.json";
import {
  isPushSupported,
  isStandalone,
  isIOS,
  permissionState,
  getSubscription,
  subscribePush,
  unsubscribePush,
} from "@/lib/push";
import { IconClose } from "./icons";

// 短期メモの日数のよく使う候補（これ以外は数値入力で指定できる）
const DAY_PRESETS = [1, 3, 7, 14, 30];

// 保存に失敗したときの案内文。
// 「通信環境を確認してください」だけだと、実際は DB 側の設定漏れ
// （マイグレーション未適用など）でも通信のせいに見えてしまうため、
// エラーコードごとに次にやることが分かる文言を出す。
function saveErrorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string };
  const raw = e?.message ? `（${e.message}）` : "";
  switch (e?.code) {
    // テーブルが無い / PostgREST がまだ認識していない
    case "PGRST205":
    case "42P01":
      return `保存先のテーブルが見つかりません。Supabase で 0007_user_settings.sql を実行してください。実行直後の場合は1分ほど待って再試行してください。${raw}`;
    // GRANT 不足 / RLS で弾かれた
    case "42501":
      return `保存の権限がありません。Supabase で 0007_user_settings.sql（GRANT と RLS ポリシー）を最後まで実行してください。${raw}`;
    case "23514":
      return `その日数は保存できません。${MIN_SHORT_NOTE_DAYS}〜${MAX_SHORT_NOTE_DAYS} の範囲で指定してください。${raw}`;
    default:
      return e?.message
        ? `設定の保存に失敗しました${raw}`
        : "設定の保存に失敗しました。通信環境を確認してください。";
  }
}

export default function SettingsDialog({
  userEmail,
  onClose,
}: {
  userEmail: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { shortNoteDays, setShortNoteDays } = useNotes();

  // 短期メモの日数設定。入力欄は保存済みの値に追従させる
  // （他端末で変更された場合もここに反映される）。
  const [daysInput, setDaysInput] = useState(String(shortNoteDays));
  const [daysSaving, setDaysSaving] = useState(false);
  const [daysError, setDaysError] = useState<string | null>(null);

  useEffect(() => {
    setDaysInput(String(shortNoteDays));
  }, [shortNoteDays]);

  // --- プッシュ通知（短期メモの期限リマインド） ---
  // この端末が購読済みか。null = まだ調べ終えていない。
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported()) {
      setPushOn(false);
      return;
    }
    let alive = true;
    getSubscription()
      .then((sub) => {
        if (alive) setPushOn(!!sub);
      })
      .catch(() => {
        if (alive) setPushOn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // トグル。requestPermission() は「ユーザー操作から始まる処理」でないと
  // iOS が拒否するため、必ずこの onClick から呼ぶこと。
  async function togglePush() {
    setPushError(null);
    setPushBusy(true);
    try {
      if (pushOn) {
        await unsubscribePush();
        setPushOn(false);
      } else {
        await subscribePush();
        setPushOn(true);
      }
    } catch (err) {
      setPushError(
        err instanceof Error ? err.message : "通知の設定を変更できませんでした",
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function saveDays(days: number) {
    if (!Number.isFinite(days)) {
      setDaysError("日数を数字で入力してください。");
      return;
    }
    const n = Math.round(days);
    if (n < MIN_SHORT_NOTE_DAYS || n > MAX_SHORT_NOTE_DAYS) {
      setDaysError(
        `${MIN_SHORT_NOTE_DAYS}〜${MAX_SHORT_NOTE_DAYS} の範囲で入力してください。`,
      );
      return;
    }
    setDaysError(null);
    setDaysSaving(true);
    try {
      await setShortNoteDays(n);
    } catch (err) {
      setDaysError(saveErrorMessage(err));
    } finally {
      setDaysSaving(false);
    }
  }

  // パスワード変更用の状態。
  // このプロジェクトは Supabase 側で「パスワード変更時に現在のパスワードを必須」
  // （GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD）が有効。
  // そのため updateUser に current_password を渡す必要がある（メールコードは不要）。
  const [pwOpen, setPwOpen] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("current-password") ?? "");
    const password = String(data.get("new-password") ?? "");
    const confirm = String(data.get("confirm-password") ?? "");

    setPwError(null);
    setPwDone(false);

    const issue = passwordIssue(password);
    if (issue) {
      setPwError(issue);
      return;
    }
    if (password !== confirm) {
      setPwError("確認用パスワードが一致しません。");
      return;
    }
    if (password === currentPassword) {
      setPwError("現在と異なるパスワードを設定してください。");
      return;
    }

    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password,
        current_password: currentPassword,
      });
      if (error) throw error;
      setPwDone(true);
      form.reset();
      setPwOpen(false);
    } catch (err: unknown) {
      const e2 = err as { message?: string; code?: string; status?: number };
      // 開発者確認用にコンソールへ生のまま残す
      console.error("password change error:", err);
      // 現在のパスワード違い・必須系はわかりやすい日本語にする
      if (
        e2?.code === "current_password_required" ||
        e2?.code === "current_password_invalid" ||
        e2?.status === 400 ||
        /current password/i.test(e2?.message ?? "")
      ) {
        setPwError("現在のパスワードが正しくありません。");
      } else {
        setPwError(e2?.message ?? "パスワードの変更に失敗しました。");
      }
    } finally {
      setPwSaving(false);
    }
  }

  // バージョン情報（デプロイのたびに変わる。反映されているかの確認用）
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT ?? "local";
  const buildTimeRaw = process.env.NEXT_PUBLIC_BUILD_TIME;
  const buildTime = buildTimeRaw
    ? new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tokyo",
      }).format(new Date(buildTimeRaw))
    : "不明";

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // 端末情報（起動画像がどの端末で一致していないかを調べるための表示）。
  // iOS のスプラッシュは media が実機と完全一致しないと真っ白になるため、
  // 実測値と「一致した起動画像があるか」をここで確認できるようにする。
  const [deviceInfo, setDeviceInfo] = useState<{
    screen: string;
    dpr: number;
    viewport: string;
    standalone: boolean;
    orientation: string;
    deviceMq: string;
    matched: string[];
  } | null>(null);

  useEffect(() => {
    function measure() {
      const w = window.screen.width;
      const h = window.screen.height;
      const mm = (q: string) => window.matchMedia(q).matches;

      // 横向き時に device-width/height が入れ替わるかを実測する。
      // （iOS の起動画像はこの値で選ばれるため、入れ替わるなら横向き用の
      //   メディアクエリも入れ替えた寸法で書く必要がある）
      const dw = mm(`(device-width: ${w}px)`) ? w : mm(`(device-width: ${h}px)`) ? h : 0;
      const dh = mm(`(device-height: ${h}px)`) ? h : mm(`(device-height: ${w}px)`) ? w : 0;

      setDeviceInfo({
        screen: `${w}x${h}`,
        dpr: window.devicePixelRatio,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        standalone:
          mm("(display-mode: standalone)") ||
          // iOS Safari 独自
          (window.navigator as unknown as { standalone?: boolean }).standalone === true,
        orientation: mm("(orientation: landscape)") ? "landscape" : "portrait",
        deviceMq: `${dw || "?"}x${dh || "?"}`,
        // 一致するものを全部出す（複数一致していると iOS がどれを選ぶかで化ける）
        matched: splashScreens
          .filter((s) => mm(s.media))
          .map((s) => s.href.replace("/splash/apple-splash-", "").replace(".png", "")),
      });
    }
    measure();
    // 回転しても開いたまま追従させる
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
    >
      {/* スマホでは設定の内容が画面より高くなる。パネル全体を高さ上限つきの
          縦フレックスにし、ヘッダー（×）は固定・中身だけをスクロールさせる。
          こうしないと内容が画面外にあふれ、×にも届かず「戻れない・スクロール
          できない」状態になる（パネルは fixed 上に置かれ、ページ側は
          overflow-hidden なので、内側にスクロールを持たせる必要がある）。 */}
      <div
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-6">
          <h3 className="text-lg font-bold">設定</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <IconClose />
          </button>
        </div>

        <div className="thin-scroll space-y-4 overflow-y-auto px-6 pb-6 text-sm">
          <div>
            <div className="text-neutral-400">ログイン中のアカウント</div>
            <div className="font-medium">{userEmail || "（不明）"}</div>
          </div>

          {/* パスワード変更（現在のパスワードで本人確認する方式） */}
          <div className="rounded-lg border border-neutral-200 p-3">
            <button
              onClick={() => {
                setPwOpen((v) => !v);
                setPwDone(false);
                setPwError(null);
              }}
              className="flex w-full items-center justify-between font-medium"
            >
              <span>パスワードを変更</span>
              <span className="text-neutral-400">{pwOpen ? "−" : "＋"}</span>
            </button>

            {pwDone && !pwOpen && (
              <p className="mt-2 text-xs text-green-600">
                パスワードを変更しました。
              </p>
            )}

            {pwOpen && (
              <form onSubmit={handleChangePassword} className="mt-3 space-y-2">
                {/* 自動入力のためユーザー名欄を隠して置く */}
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  defaultValue={userEmail}
                  className="hidden"
                  readOnly
                  aria-hidden
                />
                <input
                  type="password"
                  name="current-password"
                  required
                  autoComplete="current-password"
                  placeholder="現在のパスワード"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400"
                />
                <input
                  type="password"
                  name="new-password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  placeholder="新しいパスワード（10文字以上）"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400"
                />
                <input
                  type="password"
                  name="confirm-password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  placeholder="新しいパスワード（確認）"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400"
                />
                <p className="text-xs text-neutral-400">
                  10文字以上。英小文字・英大文字・数字・記号のうち3種類以上。
                </p>
                {pwError && (
                  <p className="text-xs text-red-600">{pwError}</p>
                )}
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="w-full rounded-lg bg-brand-500 py-2 font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  {pwSaving ? "変更中…" : "パスワードを変更する"}
                </button>
              </form>
            )}
          </div>

          {/* 短期メモの保存日数。ここを変えると、以降に作成・復元・短期へ
              切り替えたメモの「あと◯日」の上限がその日数になる。 */}
          <div className="rounded-lg border border-neutral-200 p-3">
            <div className="font-medium">短期メモの保存日数</div>
            <p className="mt-0.5 text-xs text-neutral-400">
              作成からこの日数でゴミ箱へ移動します。
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {DAY_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={daysSaving}
                  onClick={() => saveDays(d)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                    shortNoteDays === d
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {d}日
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveDays(Number(daysInput));
              }}
              className="mt-2 flex items-center gap-2"
            >
              <input
                type="number"
                inputMode="numeric"
                min={MIN_SHORT_NOTE_DAYS}
                max={MAX_SHORT_NOTE_DAYS}
                step={1}
                value={daysInput}
                onChange={(e) => setDaysInput(e.target.value)}
                className="w-24 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 outline-none focus:ring-2 focus:ring-brand-400"
                aria-label="短期メモの保存日数"
              />
              <span className="text-neutral-500">日</span>
              <button
                type="submit"
                disabled={daysSaving || Number(daysInput) === shortNoteDays}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
              >
                {daysSaving ? "保存中…" : "保存"}
              </button>
            </form>

            <p className="mt-2 text-xs text-neutral-400">
              現在の設定：{shortNoteDays} 日（{MIN_SHORT_NOTE_DAYS}〜
              {MAX_SHORT_NOTE_DAYS} 日）。変更は、これから作成・復元する
              短期メモから適用されます（すでにあるメモの残り日数は変わりません）。
            </p>
            {daysError && <p className="mt-1 text-xs text-red-600">{daysError}</p>}
          </div>

          {/* プッシュ通知。短期メモが期限の2日前になった日の朝9時に、
              その日ぶんをまとめて1通だけ届ける。 */}
          <div className="rounded-lg border border-neutral-200 p-3">
            <div className="font-medium">期限が近いメモの通知</div>
            <p className="mt-0.5 text-xs text-neutral-400">
              短期メモがゴミ箱へ移動する2日前の朝9時に、その日ぶんをまとめて
              1回だけお知らせします。
            </p>

            {!isPushSupported() ? (
              // iOS はホーム画面に追加した PWA でしか通知を使えない。
              // 「非対応」で終わらせず、次にやることを出す。
              <p className="mt-2 text-xs text-neutral-500">
                {isIOS() && !isStandalone()
                  ? "共有ボタンから「ホーム画面に追加」すると、通知を受け取れるようになります。"
                  : "この端末・ブラウザでは通知を利用できません。"}
              </p>
            ) : permissionState() === "denied" ? (
              // 一度拒否されると JS からは再要求できない
              <p className="mt-2 text-xs text-neutral-500">
                通知がブロックされています。端末の設定から Flow の通知を許可してから、
                この画面を開き直してください。
              </p>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePush}
                  disabled={pushBusy || pushOn === null}
                  aria-pressed={pushOn === true}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                    pushOn
                      ? "bg-neutral-200 text-neutral-700 hover:bg-neutral-300"
                      : "bg-brand-500 text-white hover:bg-brand-600"
                  }`}
                >
                  {pushBusy
                    ? "設定中…"
                    : pushOn === null
                      ? "確認中…"
                      : pushOn
                        ? "通知を止める"
                        : "通知を受け取る"}
                </button>
                <span className="text-xs text-neutral-400">
                  {pushOn === null
                    ? ""
                    : pushOn
                      ? "この端末は通知ONです"
                      : "この端末は通知OFFです"}
                </span>
              </div>
            )}

            <p className="mt-2 text-xs text-neutral-400">
              設定は端末ごとです。複数の端末で受け取るには、それぞれで通知をONにしてください。
            </p>
            {pushError && <p className="mt-1 text-xs text-red-600">{pushError}</p>}
          </div>

          <div className="rounded-lg bg-neutral-100 p-3">
            <div className="mb-1 font-medium">自動削除ルール</div>
            <ul className="list-inside list-disc space-y-0.5 text-neutral-600">
              <li>短期メモは作成から {shortNoteDays} 日でゴミ箱へ移動</li>
              <li>ゴミ箱のメモは {TRASH_RETENTION_DAYS} 日で完全削除</li>
            </ul>
            <p className="mt-2 text-xs text-neutral-400">
              ※ 実際の自動処理は Supabase 側（pg_cron）で毎日実行されます。
            </p>
          </div>

          <button
            onClick={signOut}
            className="w-full rounded-lg border border-red-200 py-2.5 font-medium text-red-600 hover:bg-red-50"
          >
            ログアウト
          </button>

          {/* バージョン（反映されているかの確認用） */}
          <div className="flex items-center justify-between pt-1 text-xs text-neutral-400">
            <span>バージョン</span>
            <span className="font-mono">
              {commit} ・ {buildTime}
            </span>
          </div>

          {/* 端末情報（起動画面の不一致を調べるための一時的な表示） */}
          {deviceInfo && (
            <div className="rounded-lg bg-neutral-100 p-2 font-mono text-[10px] leading-relaxed text-neutral-500">
              <div>screen: {deviceInfo.screen} @{deviceInfo.dpr}x</div>
              <div>viewport: {deviceInfo.viewport}</div>
              <div>orientation: {deviceInfo.orientation}</div>
              <div>device-mq: {deviceInfo.deviceMq}</div>
              <div>standalone: {String(deviceInfo.standalone)}</div>
              <div
                className={deviceInfo.matched.length === 0 ? "text-red-500" : ""}
              >
                splash: {deviceInfo.matched.join(" , ") || "一致なし"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
