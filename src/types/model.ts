import type { JWTPayload } from "jose";

export type UserJWTPayload = JWTPayload & {
  uid: number;
  role?: string;
};

export type UserRow = {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  avatar: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
};

export type NoteRow = {
  id: number;
  user_id: number;
  title: string;
  content: string | null;
  is_draft: boolean;
  is_top: boolean;
  is_star: boolean;
  is_delete: boolean;
  delete_expired_at: string | null;
  created_at: string;
  updated_at: string;
};