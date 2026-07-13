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

// 短期メモの有効日数（作成からこの日数でゴミ箱行き）
export const SHORT_NOTE_DAYS = 7;
// ゴミ箱の保持日数（この日数で完全削除）
export const TRASH_RETENTION_DAYS = 30;
