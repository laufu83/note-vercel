import { createKnex } from "../config/knex";
import { createCache, CacheAdapter } from "../config/cache";
import { hashPassword, comparePassword } from "../utils/password";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";
import { v4 as uuidv4 } from "uuid";
import { sendChangeEmail } from "../utils/email";

// Token黑名单过期时间：1天
const TOKEN_BLACK_EXPIRE = 86400;

export const UserController = {
  /**
   * 获取当前登录用户详细信息
   */
  async getCurrentUserInfo(env: Env, uid: number): Promise<Response> {
    const knex = createKnex(env);
    const user = await knex('users')
      .select(
        'id',
        'username',
        'email',
        'avatar',
        'role',
        'status',
        'is_frozen',
        'created_at',
        'updated_at'
      )
      .where({ id: uid, is_deleted: 0 })
      .first();

    if (!user) {
      return jsonResp(null, CODE.NOT_FOUND, "用户不存在或已被注销");
    }
    return jsonResp(user, CODE.SUCCESS, "获取用户信息成功");
  },

  /**
   * 修改个人资料：用户名、头像直接生效；邮箱需邮件激活后生效
   * 仅字段发生变更才执行更新/校验，相同值直接跳过处理
   */
  async updateProfile(
    env: Env,
    uid: number,
    body: {
      username?: string
      email?: string
      avatar?: string
    }
  ): Promise<Response> {
    const knex = createKnex(env);
    const updateTime = knex.fn.now();
    // 1. 一次性查询当前用户信息，用于新旧值比对
    const current = await knex('users')
      .select('id', 'username', 'email', 'avatar')
      .where({ id: uid, is_deleted: 0 })
      .first();

    if (!current) {
      return jsonResp(null, CODE.NOT_FOUND, "用户不存在");
    }

    const updateData: Record<string, any> = {};
    let needSendEmailActivate = false;
    let targetNewEmail = "";

    // ====================== 1. 用户名处理 ======================
    if (body.username?.trim()) {
      const newUsername = body.username.trim();
      if (newUsername !== current.username) {
        if (newUsername.length < 2 || newUsername.length > 20) {
          return jsonResp(null, CODE.PARAM_ERR, "用户名长度需为2-20位");
        }
        const existUser = await knex('users')
          .where('username', newUsername)
          .whereNot('id', uid)
          .where('is_deleted', 0)
          .first();
        if (existUser) {
          return jsonResp(null, CODE.PARAM_ERR, "用户名已被占用");
        }
        updateData.username = newUsername;
      }
    }

    // ====================== 2. 头像处理（支持清空） ======================
    if (body.avatar !== undefined) {
      const newAvatar = body.avatar?.trim() || null;
      if (newAvatar !== current.avatar) {
        updateData.avatar = newAvatar;
      }
    }

    // ====================== 3. 邮箱处理（需激活，不直接更新主表） ======================
    if (body.email?.trim()) {
      const newEmail = body.email.trim();
      if (newEmail !== current.email) {
        const emailReg = /^[\w.-]+@[\w-]+\.[\w.-]+$/;
        if (!emailReg.test(newEmail)) {
          return jsonResp(null, CODE.PARAM_ERR, "邮箱格式错误");
        }
        const existEmail = await knex('users')
          .where('email', newEmail)
          .where('is_deleted', 0)
          .first();
        if (existEmail) {
          return jsonResp(null, CODE.PARAM_ERR, "该邮箱已被其他账号绑定");
        }
        needSendEmailActivate = true;
        targetNewEmail = newEmail;
      }
    }

    // ====================== 全局拦截：无任何字段变更 ======================
    if (Object.keys(updateData).length === 0 && !needSendEmailActivate) {
      return jsonResp(null, CODE.PARAM_ERR, "未修改任何资料内容");
    }

    // ====================== 事务保证：基础资料更新 + 邮箱激活记录 ======================
    try {
      await knex.transaction(async (trx) => {
        if (Object.keys(updateData).length > 0) {
          updateData.updated_at = updateTime;
          await trx('users')
            .where({ id: uid, is_deleted: 0 })
            .update(updateData);
        }

        // 写入邮箱激活临时记录
        if (needSendEmailActivate) {
          const activateToken = uuidv4();

          // 先软删除该用户旧的未激活邮箱记录，再新增
          await trx('user_email_activate')
            .where({ user_id: uid, is_deleted: 0 })
            .update({ is_deleted: 1, updated_at: updateTime });

          await trx('user_email_activate').insert({
            user_id: uid,
            new_email: targetNewEmail,
            activate_token: activateToken,
            activate_expire: knex.raw(`CURRENT_TIMESTAMP + INTERVAL '1' DAY`),
            is_deleted: 0,
            created_at: updateTime,
            updated_at: updateTime,
          });

          const activateUrl = `${env.APP_BASE_URL}/change-email?token=${activateToken}`;
          await sendChangeEmail(env, targetNewEmail, activateUrl);
        }
      });
    } catch (err) {
      const error = err as Error;
      console.error("【修改个人资料异常】", { uid, msg: error.message, stack: error.stack });
      return jsonResp(null, CODE.FAIL, "资料更新失败，请稍后重试");
    }

    if (needSendEmailActivate) {
      return jsonResp(null, CODE.SUCCESS, "资料已保存，新邮箱请前往邮箱完成激活后生效");
    }
    return jsonResp(null, CODE.SUCCESS, "个人资料修改成功");
  },

  /**
   * 修改当前登录用户密码
   */
  async changePwd(
    env: Env,
    uid: number,
    body: { oldPwd: string; newPwd: string }
  ): Promise<Response> {
    if (!body?.oldPwd?.trim() || !body?.newPwd?.trim()) {
      return jsonResp(null, CODE.PARAM_ERR, "原密码、新密码不能为空");
    }
    if (body.newPwd.length < 6) {
      return jsonResp(null, CODE.PARAM_ERR, "新密码长度不能少于6位");
    }
    if (body.oldPwd === body.newPwd) {
      return jsonResp(null, CODE.PARAM_ERR, "新密码不能与原密码一致");
    }

    const knex = createKnex(env);
    const cache: CacheAdapter = createCache(env);

    const user = await knex('users')
      .select('password_hash')
      .where({ id: uid, is_deleted: 0 })
      .first();

    if (!user) {
      return jsonResp(null, CODE.NOT_FOUND, "当前用户不存在或已被注销");
    }

    const isPwdMatch = await comparePassword(body.oldPwd, user.password_hash);
    if (!isPwdMatch) {
      return jsonResp(null, CODE.PARAM_ERR, "原密码输入错误");
    }

    const salt = parseInt(env.BCRYPT_SALT_ROUND);
    const newPasswordHash = await hashPassword(body.newPwd, salt);
    const updateTime = knex.fn.now();

    await knex('users')
      .where({ id: uid, is_deleted: 0 })
      .update({
        password_hash: newPasswordHash,
        updated_at: updateTime
      });

    // 拉黑所有刷新令牌，刷新令牌表逻辑删除
    const tokenList = await knex('user_refresh_token')
      .select('refresh_token')
      .where({ user_id: uid, is_deleted: 0 });

    for (const item of tokenList) {
      await cache.set(`token:black:${item.refresh_token}`, "1", TOKEN_BLACK_EXPIRE);
    }
    await knex('user_refresh_token')
      .where({ user_id: uid, is_deleted: 0 })
      .update({ is_deleted: 1, updated_at: updateTime });

    return jsonResp(null, CODE.SUCCESS, "密码修改成功，请重新登录");
  },

  /**
   * 当前登录用户注销账号（逻辑删除）
   */
  async destroyAccount(
    env: Env,
    uid: number,
  ): Promise<Response> {
    const knex = createKnex(env);
    const cache: CacheAdapter = createCache(env);
    const updateTime = knex.fn.now();

    try {
      await knex.transaction(async (trx) => {
        const user = await trx('users')
          .where({ id: uid, is_deleted: 0 })
          .first('id');

        if (!user) {
          throw new Error("账号不存在或已注销");
        }

        // 用户逻辑删除
        await trx('users')
          .where({ id: uid, is_deleted: 0 })
          .update({
            is_deleted: 1,
            updated_at: updateTime
          });

        // 刷新令牌批量拉黑+逻辑删除
        const tokenList = await trx('user_refresh_token')
          .select('refresh_token')
          .where({ user_id: uid, is_deleted: 0 });

        for (const item of tokenList) {
          await cache.set(`token:black:${item.refresh_token}`, "1", TOKEN_BLACK_EXPIRE);
        }
        await trx('user_refresh_token')
          .where({ user_id: uid, is_deleted: 0 })
          .update({ is_deleted: 1, updated_at: updateTime });
      });
      return jsonResp(null, CODE.SUCCESS, "账号注销完成");
    } catch (err) {
      const error = err as Error;
      console.error("【账号注销异常】", { uid, msg: error.message });
      return jsonResp(null, CODE.FAIL, error.message || "账号注销失败，请稍后重试");
    }
  },

  async getUserList(env: Env, search: URLSearchParams = new URLSearchParams()): Promise<Response> {
    const knex = createKnex(env);
    const page = parseInt(search.get('page') || '1')
    const pageSize = parseInt(search.get('pageSize') || '10')
    const current = page > 0 ? page : 1
    const size = pageSize > 0 && pageSize <= 100 ? pageSize : 10
    const offset = (current - 1) * size

    const keyword = search.get('keyword')?.trim()

    let query = knex('users').where('is_deleted', 0);
    if (keyword) {
      const kw = `%${keyword}%`;
      query.andWhereRaw('LOWER(username) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?)', [kw, kw]);
    }

    // 统计总数
    const totalRow = await query.clone().count('* as total').first();
    const total = Number(totalRow?.total ?? 0);

    // 分页数据
    const list = await query
      .select('id', 'username', 'email', 'role', 'status', 'is_frozen', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(size)
      .offset(offset);

    return jsonResp({
      list,
      total,
      page: current,
      pageSize: size
    }, CODE.SUCCESS)
  },

  async updateUserInfo(
    env: Env,
    body: { userId: bigint; role?: string; isFrozen?: boolean }
  ): Promise<Response> {
    const knex = createKnex(env);
    const { userId, role, isFrozen } = body;
    const updateTime = knex.fn.now();

    const updateData: Record<string, any> = {
      updated_at: updateTime
    };
    if (role !== undefined) updateData.role = role;
    if (isFrozen !== undefined) updateData.is_frozen = isFrozen ? 1 : 0;

    if (Object.keys(updateData).length === 1) {
      return jsonResp(null, CODE.PARAM_ERR, "无更新字段");
    }

    await knex('users')
      .where({ id: userId, is_deleted: 0 })
      .update(updateData);

    return jsonResp(null, CODE.SUCCESS, "用户信息更新成功");
  },

  async adminResetUserPwd(
    env: Env,
    body: { userId: bigint; newPwd: string }
  ): Promise<Response> {
    const knex = createKnex(env);
    const saltRounds = parseInt(env.BCRYPT_SALT_ROUND);
    const hash = await hashPassword(body.newPwd, saltRounds);
    const updateTime = knex.fn.now();

    await knex('users')
      .where({ id: body.userId, is_deleted: 0 })
      .update({
        password_hash: hash,
        updated_at: updateTime
      });

    return jsonResp(null, CODE.SUCCESS, "用户密码重置成功");
  },
};