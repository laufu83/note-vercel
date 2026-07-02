// src/controllers/share.controller.ts

import { createKnex } from "../config/knex";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { v4 as uuidv4 } from "uuid";
import type { Env } from "../types/env";
import type { Knex } from "knex";

// ============================================
// 分享配置常量
// ============================================

const SHARE_CONFIG = {
  /** 分享码长度 */
  CODE_LENGTH: 16,
  /** 默认永久有效（天数） */
  DEFAULT_EXPIRE_DAYS: 0,
  /** 最大有效期（天数） */
  MAX_EXPIRE_DAYS: 365,
  /** 允许的分享权限 */
  ALLOWED_PERMISSIONS: ['read', 'read_write'] as const,
  /** 加密笔记提示信息 */
  ENCRYPTED_NOTE_MESSAGE: '加密笔记不支持分享，请先解密后再分享',
} as const;

/** 分享权限类型 */
type SharePermission = typeof SHARE_CONFIG.ALLOWED_PERMISSIONS[number];

/**
 * 统一获取站点基础地址
 */
function getBaseUrl(env: Env): string {
  return env.APP_BASE_URL?.trim() || "http://localhost:8787";
}

/**
 * 验证分享权限是否合法
 */
function isValidPermission(permission: string): permission is SharePermission {
  return SHARE_CONFIG.ALLOWED_PERMISSIONS.includes(permission as SharePermission);
}

/**
 * 生成分享码
 */
function generateShareCode(): string {
  return uuidv4().replace(/-/g, "").slice(0, SHARE_CONFIG.CODE_LENGTH);
}

export const ShareController = {
  /**
   * 创建笔记分享
   * POST /api/share/create
   *
   * @param env - 环境变量
   * @param uid - 用户ID
   * @param body - 请求体
   * @returns 分享链接
   */
  async create(
    env: Env,
    uid: number,
    body: {
      noteId: number;
      password?: string;
      permission: string;
      expireDays?: number;
    }
  ): Promise<Response> {
    const knex = createKnex(env);
    const { noteId, password, permission, expireDays = SHARE_CONFIG.DEFAULT_EXPIRE_DAYS } = body;

    // ==========================================
    // 1. 参数校验
    // ==========================================

    // 权限校验
    if (!isValidPermission(permission)) {
      return jsonResp(
        null,
        CODE.PARAM_ERR,
        `无效的权限类型，支持: ${SHARE_CONFIG.ALLOWED_PERMISSIONS.join(', ')}`
      );
    }

    // 有效期校验
    if (expireDays < 0 || expireDays > SHARE_CONFIG.MAX_EXPIRE_DAYS) {
      return jsonResp(
        null,
        CODE.PARAM_ERR,
        `有效期必须在 0-${SHARE_CONFIG.MAX_EXPIRE_DAYS} 天之间`
      );
    }

    // ==========================================
    // 2. 校验笔记归属和状态
    // ==========================================
    const note = await knex("notes")
      .where({
        id: noteId,
        user_id: uid,
        is_deleted: 0
      })
      .first("id", "is_encrypted", "title");

    if (!note) {
      return jsonResp(null, CODE.FORBIDDEN, "无权分享该笔记");
    }

    // ==========================================
    // 3. 加密笔记禁止分享
    // ==========================================
    if (note.is_encrypted === 1) {
      return jsonResp(
        null,
        CODE.FORBIDDEN,
        SHARE_CONFIG.ENCRYPTED_NOTE_MESSAGE
      );
    }

    // ==========================================
    // 4. 检查是否已存在有效的分享
    // ==========================================
    const existingShare = await knex("note_share")
      .where({
        note_id: noteId,
        is_deleted: 0
      })
      .where(function (qb) {
        qb.whereNull("activate_expire")
          .orWhere("activate_expire", ">", knex.fn.now());
      })
      .first("id", "share_code");

    if (existingShare) {
      const baseUrl = getBaseUrl(env);
      const shareUrl = `${baseUrl}/share/${existingShare.share_code}`;
      return jsonResp({
        shareCode: existingShare.share_code,
        shareUrl: shareUrl,
        isReused: true,
        message: '该笔记已有有效分享链接'
      }, CODE.SUCCESS, '分享链接已存在');
    }

    // ==========================================
    // 5. 生成分享码和过期时间
    // ==========================================
    const code = generateShareCode();
    let activateExpire: Knex.Raw | null = null;

    if (expireDays > 0) {
      activateExpire = knex.raw(`CURRENT_TIMESTAMP + INTERVAL '?' DAY`, [expireDays]);
    }

    // ==========================================
    // 6. 创建分享记录
    // ==========================================
    try {
      const now = knex.fn.now();
      await knex("note_share").insert({
        note_id: noteId,
        share_code: code,
        access_password: password?.trim() || null,
        permission: permission,
        activate_expire: activateExpire,
        is_deleted: 0,
        created_at: now,
        updated_at: now,
      });

      // 构建分享链接
      const baseUrl = getBaseUrl(env);
      let shareUrl = `${baseUrl}/share/${code}`;
      if (password?.trim()) {
        shareUrl += `?pwd=${encodeURIComponent(password.trim())}`;
      }

      return jsonResp({
        shareCode: code,
        shareUrl: shareUrl,
        noteTitle: note.title,
        permission: permission,
        expireDays: expireDays === 0 ? '永久有效' : `${expireDays}天`,
        isReused: false,
      }, CODE.SUCCESS, '分享创建成功');

    } catch (err) {
      const error = err as Error;
      console.error("【创建笔记分享失败】", { uid, noteId, msg: error.message });

      if (error.message?.includes('duplicate') || error.message?.includes('UNIQUE')) {
        return jsonResp(null, CODE.FAIL, '分享码生成冲突，请重试');
      }

      return jsonResp(null, CODE.FAIL, "创建分享失败");
    }
  },

  /**
   * 获取公开分享内容
   * GET /api/share/:code
   *
   * @param env - 环境变量
   * @param code - 分享码
   * @param pwd - 访问密码（可选）
   * @returns 分享内容
   */
  async getPublicShare(env: Env, code: string, pwd?: string | null): Promise<Response> {
    const knex = createKnex(env);

    const shareInfo = await knex("note_share as s")
      .join("notes as n", "s.note_id", "n.id")
      .where({
        "s.share_code": code,
        "s.is_deleted": 0,
        "n.is_deleted": 0
      })
      .where(function (qb) {
        qb.whereNull("s.activate_expire")
          .orWhere("s.activate_expire", ">", knex.fn.now());
      })
      .select(
        "n.id as note_id",
        "n.title",
        "n.content",
        "n.updated_at",
        "n.is_encrypted",
        "s.access_password",
        "s.activate_expire",
        "s.permission"
      )
      .first();

    if (!shareInfo) {
      return jsonResp(null, CODE.NOT_FOUND, "分享不存在或已失效");
    }

    if (shareInfo.is_encrypted === 1) {
      return jsonResp(
        null,
        CODE.FORBIDDEN,
        "该笔记为加密笔记，无法通过分享查看"
      );
    }

    if (shareInfo.access_password) {
      if (!pwd || pwd !== shareInfo.access_password) {
        return jsonResp(
          null,
          CODE.UNAUTH,
          "需要访问密码"
        );
      }
    }

    let remainingDays: number | null = null;
    if (shareInfo.activate_expire) {
      const now = new Date();
      const expire = new Date(shareInfo.activate_expire);
      const diffMs = expire.getTime() - now.getTime();
      remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    return jsonResp({
      title: shareInfo.title,
      content: shareInfo.content,
      updated_at: shareInfo.updated_at,
      permission: shareInfo.permission,
      expiresIn: remainingDays === null ? '永久有效' : `${remainingDays}天`,
      isEncrypted: false,
    }, CODE.SUCCESS, '获取分享成功');
  },

  /**
   * 获取我的分享列表
   * GET /api/share/list
   */
  async myShareList(env: Env, uid: number): Promise<Response> {
    const knex = createKnex(env);

    const shares = await knex("note_share as s")
      .join("notes as n", "s.note_id", "n.id")
      .where({
        "n.user_id": uid,
        "s.is_deleted": 0,
        "n.is_deleted": 0
      })
      .orderBy("s.created_at", "desc")
      .select(
        "s.id",
        "s.share_code",
        "s.permission",
        "s.access_password",
        "s.created_at",
        "s.activate_expire",
        "n.id as note_id",
        "n.title",
        "n.is_encrypted",
        "n.is_top",
        "n.is_star"
      );

    const baseUrl = getBaseUrl(env);
    const list = shares.map((share: any) => {
      const isExpired = share.activate_expire &&
        new Date(share.activate_expire) < new Date();

      return {
        id: share.id,
        shareCode: share.share_code,
        noteId: share.note_id,
        noteTitle: share.title,
        permission: share.permission,
        hasPassword: !!share.access_password,
        isEncrypted: share.is_encrypted === 1,
        isExpired: isExpired,
        createdAt: share.created_at,
        expiresAt: share.activate_expire,
        shareUrl: `${baseUrl}/share/${share.share_code}`,
      };
    });

    return jsonResp({
      total: list.length,
      list,
    }, CODE.SUCCESS, '获取分享列表成功');
  },

  /**
   * 删除分享
   */
  async deleteShare(env: Env, uid: number, sid: string): Promise<Response> {
    const knex = createKnex(env);

    const share = await knex("note_share as s")
      .join("notes as n", "s.note_id", "n.id")
      .where({
        "s.id": sid,
        "n.user_id": uid,
        "s.is_deleted": 0
      })
      .select("s.id", "n.title")
      .first();

    if (!share) {
      return jsonResp(null, CODE.NOT_FOUND, "分享记录不存在或无权限");
    }

    await knex("note_share")
      .where({ id: sid })
      .update({
        is_deleted: 1,
        updated_at: knex.fn.now()
      });

    return jsonResp({
      shareId: sid,
      noteTitle: share.title,
    }, CODE.SUCCESS, "分享已删除");
  },

  /**
   * 更新分享设置
   */
  async updateShare(
    env: Env,
    uid: number,
    sid: string,
    body: {
      password?: string;
      permission?: string;
      expireDays?: number;
    }
  ): Promise<Response> {
    const knex = createKnex(env);
    const { password, permission, expireDays } = body;

    const share = await knex("note_share as s")
      .join("notes as n", "s.note_id", "n.id")
      .where({
        "s.id": sid,
        "n.user_id": uid,
        "s.is_deleted": 0,
        "n.is_deleted": 0
      })
      .select("s.id", "s.share_code", "n.title", "n.is_encrypted")
      .first();

    if (!share) {
      return jsonResp(null, CODE.NOT_FOUND, "分享记录不存在或无权限");
    }

    if (share.is_encrypted === 1) {
      return jsonResp(
        null,
        CODE.FORBIDDEN,
        SHARE_CONFIG.ENCRYPTED_NOTE_MESSAGE
      );
    }

    if (permission && !isValidPermission(permission)) {
      return jsonResp(
        null,
        CODE.PARAM_ERR,
        `无效的权限类型，支持: ${SHARE_CONFIG.ALLOWED_PERMISSIONS.join(', ')}`
      );
    }

    if (expireDays !== undefined && (expireDays < 0 || expireDays > SHARE_CONFIG.MAX_EXPIRE_DAYS)) {
      return jsonResp(
        null,
        CODE.PARAM_ERR,
        `有效期必须在 0-${SHARE_CONFIG.MAX_EXPIRE_DAYS} 天之间`
      );
    }

    const updateData: any = {
      updated_at: knex.fn.now()
    };

    if (password !== undefined) {
      updateData.access_password = password?.trim() || null;
    }

    if (permission) {
      updateData.permission = permission;
    }

    if (expireDays !== undefined) {
      if (expireDays === 0) {
        updateData.activate_expire = null;
      } else {
        updateData.activate_expire = knex.raw(`CURRENT_TIMESTAMP + INTERVAL '?' DAY`, [expireDays]);
      }
    }

    await knex("note_share")
      .where({ id: sid })
      .update(updateData);

    const baseUrl = getBaseUrl(env);
    const shareUrl = `${baseUrl}/share/${share.share_code}`;

    return jsonResp({
      shareId: sid,
      shareCode: share.share_code,
      shareUrl: shareUrl,
      noteTitle: share.title,
      updatedFields: Object.keys(updateData).filter(k => k !== 'updated_at'),
    }, CODE.SUCCESS, '分享更新成功');
  },

  /**
   * 批量删除分享
   */
  async batchDeleteShare(
    env: Env,
    uid: number,
    body: { shareIds: string[] }
  ): Promise<Response> {
    const knex = createKnex(env);
    const { shareIds } = body;

    if (!shareIds || shareIds.length === 0) {
      return jsonResp(null, CODE.PARAM_ERR, '请选择要删除的分享');
    }

    if (shareIds.length > 100) {
      return jsonResp(null, CODE.PARAM_ERR, '单次最多删除100条分享');
    }

    const validShares = await knex("note_share as s")
      .join("notes as n", "s.note_id", "n.id")
      .whereIn("s.id", shareIds)
      .andWhere({
        "n.user_id": uid,
        "s.is_deleted": 0,
        "n.is_deleted": 0
      })
      .select("s.id");

    if (validShares.length === 0) {
      return jsonResp(null, CODE.NOT_FOUND, '没有找到可删除的分享');
    }

    const validIds = validShares.map(s => s.id);

    await knex("note_share")
      .whereIn("id", validIds)
      .update({
        is_deleted: 1,
        updated_at: knex.fn.now()
      });

    return jsonResp({
      deletedCount: validIds.length,
      shareIds: validIds,
    }, CODE.SUCCESS, `成功删除 ${validIds.length} 个分享`);
  }
};