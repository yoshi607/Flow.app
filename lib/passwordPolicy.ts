// 新規登録・パスワード変更で共通に使うパスワード強度チェック。
// ※サーバー側でも Supabase ダッシュボードの「最低文字数」「文字種要件」
//   「漏洩パスワード保護(HaveIBeenPwned・Proプラン)」を併用すること。
//   ここはクライアント側の第一関門で、単体では迂回されうる。
export function passwordIssue(pw: string): string | null {
  if (pw.length < 10) return "パスワードは10文字以上にしてください。";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) =>
    r.test(pw),
  ).length;
  if (classes < 3) {
    return "英小文字・英大文字・数字・記号のうち、3種類以上を含めてください。";
  }
  // ありがちな弱いパスワードを軽くはじく
  if (/^(?:password|passw0rd|12345678|qwerty)/i.test(pw)) {
    return "推測されやすいパスワードです。別のものにしてください。";
  }
  return null;
}
