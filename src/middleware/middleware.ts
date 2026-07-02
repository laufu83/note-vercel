import { verifyAccessToken } from "../config/jwt";
import { corsHeaders } from "../utils/cors";
import { CODE } from "../types/response";
import { jsonResp } from "../utils/response";
import{Env} from "../types/env";
import type { UserJWTPayload } from "../types/model";

export async function authMiddleware(req: Request, env: Env) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { error: jsonResp(null, CODE.UNAUTH, "请登录账号"), payload: null };
  }
  const token = auth.slice(7);
  try {
    const payload = await verifyAccessToken(token, env);
    return { error: null, payload };
  } catch {
    return { error: jsonResp(null, CODE.UNAUTH, "登录令牌失效，请重新登录", 401), payload: null };
  }
}

export function requireAdmin(payload: UserJWTPayload): Response | null {
  // payload 一定存在 uid，再判断角色
  if (!payload || payload.role !== "admin") {
    return new Response(
      JSON.stringify({
        code: 403,
        msg: "权限不足，仅系统管理员可访问"
      }),
      {
        status: 403,
        headers: { ...corsHeaders }
      }
    );
  }
  return null;
}