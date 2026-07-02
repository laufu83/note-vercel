// src/utils/env.ts
import type { Env } from "../types/env";
export function getBaseUrl(env: Env): string {
  return env.APP_BASE_URL?.trim() || "http://localhost:8787";
}