// アプリ全体で使うデータ型

export type NoteType = "short" | "long";
export type NoteStatus = "active" | "trashed";

export interface Folder {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  body: string;
  type: NoteType;
  status: NoteStatus;
  pinned: boolean;
  tags: string[];
  expires_at: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
  // ネイティブ版が録音中にセットするロック（Web版は読んで従うだけ。書き込まない）
  recording_lock_by: string | null;
  recording_lock_until: string | null;
}

export interface Attachment {
  id: string;
  note_id: string;
  file_url: string;
  file_path: string | null;
  file_name: string;
  file_size: number;
  type: string;
  created_at: string;
}

// ユーザーごとの設定（設定画面で変更する値。アカウント単位で同期される）
export interface UserSettings {
  user_id: string;
  short_note_days: number;
  created_at: string;
  updated_at: string;
}

// 短期メモの有効日数（作成からこの日数でゴミ箱行き）。
// 設定画面から変更でき、未設定のユーザーはこの既定値になる。
export const DEFAULT_SHORT_NOTE_DAYS = 7;
// 設定画面で選べる範囲（DB 側の check 制約と揃えること）
export const MIN_SHORT_NOTE_DAYS = 1;
export const MAX_SHORT_NOTE_DAYS = 365;
// ゴミ箱の保持日数（この日数で完全削除）
export const TRASH_RETENTION_DAYS = 30;
