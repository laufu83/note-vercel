import 'dotenv/config'
import { handleOptionsCors } from "./utils/cors";
import { dispatch } from "./route/router";
import type { Env } from "./types/env";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return handleOptionsCors();
  // 类型断言为你扩展后的 Env
  return dispatch(req, process.env as unknown as Env);
}