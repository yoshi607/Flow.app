"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createSignedImageUrl, storagePathFromSrc } from "@/lib/attachments";

// 本文の data-src / attachments.file_url（＝Storageパスまたは旧URL）を、
// 非公開バケット用の署名付きURLへ解決するフック。
// - src が変わるたびに再発行する
// - 期限（既定1時間）内に自動で1回だけ更新し、開きっぱなしでも切れにくくする
// - 解決前は空文字を返す（呼び出し側でプレースホルダ表示できる）
export function useSignedUrl(src: string | undefined | null): string {
  const supabase = useMemo(() => createClient(), []);
  const [url, setUrl] = useState("");

  useEffect(() => {
    let alive = true;
    const path = storagePathFromSrc(src ?? "");
    if (!path) {
      setUrl("");
      return;
    }

    const resolve = () => {
      createSignedImageUrl(supabase, path).then((u) => {
        if (alive) setUrl(u);
      });
    };
    resolve();

    // 有効期限より少し手前で再発行し、長時間開いていても失効しないようにする。
    const refresh = setInterval(resolve, 55 * 60 * 1000); // 55分ごと
    return () => {
      alive = false;
      clearInterval(refresh);
    };
  }, [src, supabase]);

  return url;
}
