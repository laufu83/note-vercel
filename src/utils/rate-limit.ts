import { v4 as uuidv4 } from "uuid";
import { createCache } from "../config/cache";
import { jsonResp } from "./response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

/**
 * 滑动窗口限流（IP + 用户双维度）
 * 自动兼容 Redis / 内存缓存
 * @param req 请求对象
 * @param uid 当前登录用户ID，公开接口传null
 * @param env 环境变量
 * @returns 触发限流返回429响应，否则返回null放行
 */
export async function rateLimitCheck(
  req: Request,
  uid: number | null,
  env: Env
): Promise<Response | null> {
  // 复用全局缓存适配器
  const cache = createCache(env);

  // 获取客户端真实IP（移除cf专属请求头兜底）
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

  // 参数容错兜底
  const windowSec = parseInt(env.RATE_LIMIT_WINDOW_SEC || "60", 10) || 60;
  const ipMax = parseInt(env.RATE_LIMIT_IP_MAX || "60", 10) || 60;
  const userMax = parseInt(env.RATE_LIMIT_USER_MAX || "120", 10) || 120;

  const now = Date.now();
  const windowStartTs = now - windowSec * 1000;
  const uniqueMember = `${now}-${uuidv4()}`;

  const ipKey = `ratelimit:ip:${ip}`;
  const userKey = uid ? `ratelimit:user:${uid}` : null;

  try {
    
    // 1. 清理窗口外过期数据
    await cache.zremrangebyscore(ipKey, 0, windowStartTs);
    // 2. 统计当前窗口请求数
    const ipCount = await cache.zcard(ipKey);
    if (ipCount >= ipMax) {
      return jsonResp(null, CODE.RATE_LIMIT, "当前IP请求过于频繁，请稍后再试", 429);
    }
    // 3. 写入本次请求记录 + 设置key过期
    await cache.zadd(ipKey, { score: now, member: uniqueMember });
    await cache.expire(ipKey, windowSec);

    // 用户维度限流
    if (userKey) {
      await cache.zremrangebyscore(userKey, 0, windowStartTs);
      const userCount = await cache.zcard(userKey);
      if (userCount >= userMax) {
        return jsonResp(null, CODE.RATE_LIMIT, "账号操作过于频繁，请稍后再试", 429);
      }
      await cache.zadd(userKey, { score: now, member: uniqueMember });
      await cache.expire(userKey, windowSec);
    }

    return null;
  } catch (err) {
    // 缓存异常兜底：限流服务故障直接放行，不阻断业务
    console.error("[RateLimit] 限流缓存异常", err);
    return null;
  }
}