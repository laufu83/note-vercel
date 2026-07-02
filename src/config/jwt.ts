import { SignJWT, jwtVerify } from "jose";
import type { UserJWTPayload } from "../types/model";
import type { Env } from "../types/env";
/**
 * 获取对应类型JWT密钥
 * @param env 环境变量
 * @param type access/refresh 令牌类型
 * @returns 编码后的密钥字节数组
 */
function getSecret(env:Env, type: "access" | "refresh"): Uint8Array {
  const key = type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  if (!key) throw new Error(`JWT ${type} 密钥未配置`);
  return new TextEncoder().encode(key);
}

/**
 * 签发访问令牌（携带用户ID、角色，用于接口权限校验）
 * @param uid 用户ID
 * @param role 用户角色 admin / user
 * @param env 环境变量
 * @returns accessToken
 */
export async function signAccessToken(uid: number, role: string, env: Env) {
   const expireStr = env.JWT_ACCESS_EXPIRE?.trim();
  if (!expireStr) throw new Error("JWT_REFRESH_EXPIRE 未配置");
  return new SignJWT({ uid, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expireStr)
    .sign(getSecret(env, "access"));
}

/**
 * 签发刷新令牌（仅携带用户ID，用于无感续期登录）
 * @param uid 用户ID
 * @param env 环境变量
 * @returns refreshToken
 */
export async function signRefreshToken(uid: number, env: Env) {
    const expireStr = env.JWT_REFRESH_EXPIRE?.trim();
  if (!expireStr) throw new Error("JWT_REFRESH_EXPIRE 未配置");
  return new SignJWT({ uid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expireStr)
    .sign(getSecret(env, "refresh"));
}

/**
 * 校验访问令牌，返回携带uid、role的载荷
 * @param token accessToken
 * @param env 环境变量
 * @returns UserJWTPayload
 */
export async function verifyAccessToken(token: string, env: Env): Promise<UserJWTPayload> {
  const { payload } = await jwtVerify(token, getSecret(env, "access"));
  return payload as UserJWTPayload;
}

/**
 * 校验刷新令牌，仅返回uid
 * @param token refreshToken
 * @param env 环境变量
 * @returns UserJWTPayload
 */
export async function verifyRefreshToken(token: string, env: Env): Promise<UserJWTPayload> {
  const { payload } = await jwtVerify(token, getSecret(env, "refresh"));
  return payload as UserJWTPayload;
}