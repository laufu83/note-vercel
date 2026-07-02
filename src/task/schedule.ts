import { createKnex } from "../config/knex";
import type { Env } from "../types/env";

/**
 * 通用定时任务处理器
 * 1. 物理删除回收站中过期笔记（移入回收站满30天）
 * 2. 物理删除已过期未使用的用户刷新令牌
 * 适配 MySQL / PostgreSQL 双数据库、全局软删除设计规范
 */
export async function scheduleTaskHandler(env: Env) {
  const knex = createKnex(env);
  const now = knex.fn.now();

  // 1. 物理删除：回收站已过期笔记（仅标记为删除且过期）
  await knex("notes")
    .where({ is_deleted: 1 })
    .where("delete_expire", "<", now)
    .delete();

  // 2. 物理删除：已过期的有效刷新令牌
  await knex("user_refresh_token")
    .where({ is_deleted: 0 })
    .where("activate_expire", "<", now)
    .delete();
}