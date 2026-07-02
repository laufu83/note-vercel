// src/controllers/auth.controller.ts
import { createKnex } from "../config/knex";
import { createCache, CacheAdapter } from "../config/cache";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../config/jwt";
import { hashPassword, comparePassword } from "../utils/password";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { sendActivateEmail, sendResetPasswordEmail } from "../utils/email";
import type { Env } from "../types/env";
import { v4 as uuidv4 } from "uuid";
import type { Knex } from "knex";

// 缓存配置
const CACHE_TTL = {
  CAPTCHA: 300, // 5分钟
  USER_SESSION: 3600, // 1小时
  TOKEN_BLACKLIST: 86400, // 24小时
  RESET_TOKEN: 900, // 15分钟
};

// 会话缓存接口
interface SessionCache {
  role: string;
  status?: string;
}

/**
 * 验证码校验辅助函数
 */
async function verifyCaptcha(
  cache: CacheAdapter,
  captchaToken: string
): Promise<boolean> {
  if (!captchaToken) return false;
  const tokenKey = `img:token:${captchaToken}`;
  const exists = await cache.exists(tokenKey);
  if (!exists) return false;
  await cache.del(tokenKey);
  return true;
}

/**
 * 获取用户会话缓存
 */
async function getUserSession(
  cache: CacheAdapter,
  knex: Knex,
  uid: number
): Promise<SessionCache | null> {
  const sessionKey = `user:session:${uid}`;
  const cachedSession = await cache.get(sessionKey);

  if (cachedSession && cachedSession.length > 0) {
    try {
      const session = JSON.parse(cachedSession) as SessionCache;
      return session;
    } catch {
      await cache.del(sessionKey);
    }
  }

  const user = await knex("users")
    .select("role", "status")
    .where({ id: uid, is_deleted: 0 })
    .first();

  if (!user) return null;

  const sessionData: SessionCache = {
    role: user.role,
    status: user.status,
  };

  await cache.set(sessionKey, JSON.stringify(sessionData), CACHE_TTL.USER_SESSION);

  return sessionData;
}

export const AuthController = {
  async register(
    env: Env,
    body: { username: string; password: string; email?: string; captchaToken: string }
  ) {
    const knex = createKnex(env);
    const cache = createCache(env);
    const { username, password, email, captchaToken } = body;

    // 1. 验证码校验
    const isValidCaptcha = await verifyCaptcha(cache, captchaToken);
    if (!isValidCaptcha) {
      return jsonResp(null, CODE.PARAM_ERR, "验证码已失效或无效，请刷新验证码");
    }

    // 2. 参数校验
    if (!username || !password) {
      return jsonResp(null, CODE.PARAM_ERR, "账号密码不能为空");
    }

    if (username.length < 3 || username.length > 20) {
      return jsonResp(null, CODE.PARAM_ERR, "用户名长度必须在3-20个字符之间");
    }

    if (password.length < 6) {
      return jsonResp(null, CODE.PARAM_ERR, "密码长度不能少于6位");
    }

    // 3. 邮箱格式校验
    if (email) {
      const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailReg.test(email)) {
        return jsonResp(null, CODE.PARAM_ERR, "邮箱格式不正确");
      }

      const existUser = await knex("users")
        .select("id")
        .where({ email, is_deleted: 0 })
        .first();

      if (existUser) {
        return jsonResp(null, CODE.FAIL, "该邮箱已被注册");
      }
    }

    // 4. 用户名查重
    const existUsername = await knex("users")
      .select("id")
      .where({ username, is_deleted: 0 })
      .first();

    if (existUsername) {
      return jsonResp(null, CODE.FAIL, "该用户名已被使用");
    }

    const activateToken = uuidv4();
    const salt = parseInt(env.BCRYPT_SALT_ROUND);
    const hash = await hashPassword(password, salt);

    try {
      const userId = await knex.transaction(async (trx) => {
        const insertData = {
          username,
          email: email ?? null,
          password_hash: hash,
          status: "inactive",
          role: "user",
          activate_token: activateToken,
          activate_expire: trx.raw(`CURRENT_TIMESTAMP + INTERVAL '1' DAY`),
          is_deleted: 0,
          is_frozen: 0,
        };

        const [newUser] = await trx("users").insert(insertData).returning("id");
        return Number(newUser.id);
      });

      // Node/Vercel 直接异步发送邮件，无需 waitUntil
      if (email) {
        const sendTask = async () => {
          try {
            const activateUrl = `${env.APP_BASE_URL}/activate?token=${activateToken}`;
            await sendActivateEmail(env, email, activateUrl);
          } catch (emailErr) {
            console.error("【注册】激活邮件发送失败", {
              username,
              email,
              error: emailErr,
            });
          }
        };
        sendTask();
      }

      return jsonResp(
        { userId },
        CODE.SUCCESS,
        email ? "注册成功，请前往邮箱激活账号后登录" : "注册成功"
      );
    } catch (dbErr) {
      const err = dbErr as Error;
      if (err.message.includes("duplicate key") || err.message.includes("UNIQUE")) {
        return jsonResp(null, CODE.FAIL, "用户名或邮箱已被占用");
      }
      console.error("【注册】数据库异常", {
        username,
        email,
        errorMsg: err.message,
      });
      return jsonResp(null, CODE.FAIL, "注册失败，请稍后重试");
    }
  },

  async login(
    env: Env,
    body: { username: string; password: string; captchaToken: string }
  ) {
    const knex = createKnex(env);
    const cache = createCache(env);
    const { username, password, captchaToken } = body;

    // 1. 验证码校验
    const isValidCaptcha = await verifyCaptcha(cache, captchaToken);
    if (!isValidCaptcha) {
      return jsonResp(null, CODE.PARAM_ERR, "验证码已失效或无效，请刷新验证码");
    }

    // 2. 查询用户
    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const queryField = emailReg.test(username) ? "email" : "username";

    const user = await knex("users")
      .select("id", "password_hash", "status", "role", "is_frozen")
      .where({ [queryField]: username, is_deleted: 0 })
      .first();

    if (!user) {
      return jsonResp(null, CODE.UNAUTH, "账号或密码错误");
    }

    // 3. 状态检查
    if (user.is_frozen === 1) {
      return jsonResp(null, CODE.UNAUTH, "账号已被冻结，请联系管理员");
    }

    if (user.status !== "active") {
      return jsonResp(null, CODE.UNAUTH, "账号尚未激活，请前往注册邮箱完成激活");
    }

    // 4. 密码验证
    const ok = await comparePassword(password, user.password_hash);
    if (!ok) {
      return jsonResp(null, CODE.UNAUTH, "账号或密码错误");
    }

    // 5. 生成令牌
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id, user.role, env),
      signRefreshToken(user.id, env),
    ]);

    // 6. 保存刷新令牌
    await knex("user_refresh_token").insert({
      user_id: user.id,
      refresh_token: refreshToken,
      activate_expire: knex.raw(`CURRENT_TIMESTAMP + INTERVAL '30' DAY`),
      is_deleted: 0,
    });

    // 7. 缓存用户会话信息
    const sessionData: SessionCache = {
      role: user.role,
      status: user.status,
    };
    await cache.set(`user:session:${user.id}`, JSON.stringify(sessionData), CACHE_TTL.USER_SESSION);

    return jsonResp(
      { accessToken, refreshToken, uid: user.id, role: user.role },
      CODE.SUCCESS,
      "登录成功"
    );
  },

  async activateUser(env: Env, rawToken: string | null | undefined) {
    const token = rawToken?.trim();
    if (!token) {
      return jsonResp(null, CODE.PARAM_ERR, "激活令牌不能为空");
    }

    const knex = createKnex(env);
    const cache = createCache(env);

    const user = await knex.transaction(async (trx) => {
      const userRecord = await trx("users")
        .select("id")
        .where({
          activate_token: token,
          status: "inactive",
          is_deleted: 0,
        })
        .where("activate_expire", ">", trx.fn.now())
        .first();

      if (!userRecord) {
        return null;
      }

      await trx("users")
        .where({ id: userRecord.id })
        .update({
          status: "active",
          activate_token: null,
          activate_expire: null,
          updated_at: trx.fn.now(),
        });

      return userRecord;
    });

    if (!user) {
      return jsonResp(null, CODE.FAIL, "激活链接无效或已过期，请重新注册");
    }

    await cache.del(`user:session:${user.id}`);

    return jsonResp(null, CODE.SUCCESS, "账号激活成功，请前往登录");
  },

  async resendActivateMail(env: Env, body: { email: string }) {
    const knex = createKnex(env);
    const { email } = body;

    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailReg.test(email)) {
      return jsonResp(null, CODE.PARAM_ERR, "邮箱格式不正确");
    }

    const user = await knex.transaction(async (trx) => {
      const userRecord = await trx("users")
        .select("id", "status")
        .where({ email, is_deleted: 0 })
        .first();

      if (!userRecord) {
        return null;
      }

      if (userRecord.status === "active") {
        return { ...userRecord, isActive: true };
      }

      const newToken = uuidv4();
      await trx("users")
        .where({ id: userRecord.id })
        .update({
          activate_token: newToken,
          activate_expire: trx.raw(`CURRENT_TIMESTAMP + INTERVAL '1' DAY`),
          updated_at: trx.fn.now(),
        });

      return { ...userRecord, newToken };
    });

    if (!user) {
      return jsonResp(null, CODE.FAIL, "该邮箱未注册");
    }

    if ((user as any).isActive) {
      return jsonResp(null, CODE.SUCCESS, "账号已激活，直接登录即可");
    }

    const sendTask = async () => {
      try {
        const activateUrl = `${env.APP_BASE_URL}/activate?token=${(user as any).newToken}`;
        await sendActivateEmail(env, email, activateUrl);
      } catch (err) {
        console.error("【重发激活邮件】发送失败", { email, error: err });
      }
    };
    sendTask();

    return jsonResp(null, CODE.SUCCESS, "激活邮件已重新发送，请查收");
  },

  async refreshToken(env: Env, body: { refreshToken: string }) {
    const knex = createKnex(env);
    const cache = createCache(env);
    const { refreshToken } = body;

    if (!refreshToken) {
      return jsonResp(null, CODE.PARAM_ERR, "刷新令牌不能为空");
    }

    const blackKey = `token:black:${refreshToken}`;
    const isBlacklisted = await cache.exists(blackKey);
    if (isBlacklisted) {
      return jsonResp(null, CODE.UNAUTH, "该令牌已失效");
    }

    try {
      const payload = await verifyRefreshToken(refreshToken, env);
      const uid = Number(payload.uid);

      const tokenRecord = await knex("user_refresh_token")
        .select("id")
        .where({
          user_id: uid,
          refresh_token: refreshToken,
          is_deleted: 0,
        })
        .where("activate_expire", ">", knex.fn.now())
        .first();

      if (!tokenRecord) {
        return jsonResp(null, CODE.UNAUTH, "刷新令牌已过期");
      }

      const session = await getUserSession(cache, knex, uid);
      if (!session) {
        return jsonResp(null, CODE.UNAUTH, "用户不存在");
      }

      const newAccess = await signAccessToken(uid, session.role, env);
      return jsonResp({ accessToken: newAccess }, CODE.SUCCESS, "刷新成功");
    } catch (err) {
      const error = err as Error;
      console.error("【刷新令牌异常】", error.message);
      return jsonResp(null, CODE.UNAUTH, "刷新令牌无效");
    }
  },

  async resetPwdSend(env: Env, body: { email: string }) {
    const knex = createKnex(env);
    const { email } = body;

    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailReg.test(email)) {
      return jsonResp(null, CODE.PARAM_ERR, "邮箱格式不正确");
    }

    const user = await knex.transaction(async (trx) => {
      const userRecord = await trx("users")
        .select("id")
        .where({ email, is_deleted: 0 })
        .first();

      if (!userRecord) {
        return null;
      }

      const resetToken = uuidv4();

      await trx("user_reset_token")
        .where({ user_id: userRecord.id })
        .update({
          is_deleted: 1,
          updated_at: trx.fn.now(),
        });

      await trx("user_reset_token").insert({
        user_id: userRecord.id,
        reset_token: resetToken,
        activate_expire: trx.raw(`CURRENT_TIMESTAMP + INTERVAL '15' MINUTE`),
        is_deleted: 0,
      });

      return { ...userRecord, resetToken };
    });

    if (!user) {
      return jsonResp(null, CODE.FAIL, "该邮箱未注册");
    }

    const sendTask = async () => {
      try {
        const resetUrl = `${env.APP_BASE_URL}/reset-password?token=${encodeURIComponent((user as any).resetToken)}`;
        await sendResetPasswordEmail(env, email, resetUrl);
      } catch (err) {
        console.error("【密码重置邮件】发送失败", { email, error: err });
      }
    };
    sendTask();

    return jsonResp(
      null,
      CODE.SUCCESS,
      "密码重置邮件已发送，请前往邮箱查收，15分钟内有效"
    );
  },

  async resetPwd(env: Env, body: { token: string; newPwd: string }) {
    const knex = createKnex(env);
    const cache = createCache(env);
    const { token, newPwd } = body;

    if (!token) {
      return jsonResp(null, CODE.PARAM_ERR, "重置令牌不能为空");
    }

    if (newPwd.length < 6) {
      return jsonResp(null, CODE.PARAM_ERR, "密码长度不能少于6位");
    }
    if (newPwd.length > 32) {
      return jsonResp(null, CODE.PARAM_ERR, "密码长度不能超过32位");
    }

    const result = await knex.transaction(async (trx) => {
      const tokenRow = await trx("user_reset_token")
        .select("user_id")
        .where({ reset_token: token, is_deleted: 0 })
        .where("activate_expire", ">", trx.fn.now())
        .first();

      if (!tokenRow) {
        return { success: false, message: "重置链接无效或已过期" };
      }

      const userId = tokenRow.user_id;
      const salt = parseInt(env.BCRYPT_SALT_ROUND);
      const hash = await hashPassword(newPwd, salt);

      await trx("users")
        .where({ id: userId, is_deleted: 0 })
        .update({
          password_hash: hash,
          updated_at: trx.fn.now(),
        });

      await trx("user_reset_token")
        .where({ reset_token: token })
        .update({
          is_deleted: 1,
          updated_at: trx.fn.now(),
        });

      const refreshList = await trx("user_refresh_token")
        .select("refresh_token")
        .where({ user_id: userId, is_deleted: 0 });

      // 循环批量写入黑名单（无pipeline时串行写入）
      for (const item of refreshList) {
        await cache.set(`token:black:${item.refresh_token}`, "1", CACHE_TTL.TOKEN_BLACKLIST);
      }

      await trx("user_refresh_token")
        .where({ user_id: userId })
        .update({
          is_deleted: 1,
          updated_at: trx.fn.now(),
        });

      await cache.del(`user:session:${userId}`);

      return { success: true };
    });

    if (!result.success) {
      return jsonResp(null, CODE.FAIL, result.message);
    }

    return jsonResp(null, CODE.SUCCESS, "密码重置成功，请前往登录");
  },

  async activateChangeEmail(env: Env, search?: URLSearchParams) {
    const token = search?.get("token");
    if (!token) {
      return jsonResp(null, CODE.PARAM_ERR, "激活令牌不能为空");
    }

    const knex = createKnex(env);
    const cache = createCache(env);

    const result = await knex.transaction(async (trx) => {
      const activateRow = await trx("user_email_activate")
        .select("user_id", "new_email")
        .where({ activate_token: token, is_deleted: 0 })
        .where("activate_expire", ">", trx.fn.now())
        .first();

      if (!activateRow) {
        return { success: false, message: "激活链接已过期或无效" };
      }

      const { user_id, new_email } = activateRow;

      const existUser = await trx("users")
        .select("id")
        .where({ email: new_email, is_deleted: 0 })
        .whereNot({ id: user_id })
        .first();

      if (existUser) {
        return { success: false, message: "该邮箱已被其他用户使用" };
      }

      await trx("users")
        .where({ id: user_id, is_deleted: 0 })
        .update({
          email: new_email,
          updated_at: trx.fn.now(),
        });

      await trx("user_email_activate")
        .where({ activate_token: token })
        .update({
          is_deleted: 1,
          updated_at: trx.fn.now(),
        });

      await cache.del(`user:session:${user_id}`);

      return { success: true };
    });

    if (!result.success) {
      return jsonResp(null, CODE.FAIL, result.message);
    }

    return jsonResp(null, CODE.SUCCESS, "邮箱激活成功，已更新为新邮箱");
  },

  async logout(env: Env, uid: number, refreshToken: string) {
    const knex = createKnex(env);
    const cache = createCache(env);

    if (!refreshToken) {
      return jsonResp(null, CODE.PARAM_ERR, "刷新令牌不能为空");
    }

    await cache.set(`token:black:${refreshToken}`, "1", CACHE_TTL.TOKEN_BLACKLIST);

    await knex("user_refresh_token")
      .where({ user_id: uid, refresh_token: refreshToken })
      .update({
        is_deleted: 1,
        updated_at: knex.fn.now(),
      });

    await cache.del(`user:session:${uid}`);

    return jsonResp(null, CODE.SUCCESS, "登出成功");
  },
};