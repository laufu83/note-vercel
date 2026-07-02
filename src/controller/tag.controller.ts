// src/controllers/tag.controller.ts
import { createKnex } from "../config/knex";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export const TagController = {
  async create(env: Env, uid: number, body: { name: string }): Promise<Response> {
    const knex = createKnex(env);
    const now = knex.fn.now();
    try {
      const insertData = {
        user_id: uid,
        name: body.name,
        is_deleted: 0,
        created_at: now,
        updated_at: now,
      };
      const [tagInfo] = await knex("note_tag")
        .insert(insertData)
        .returning("*");

      return jsonResp(tagInfo);
    } catch (err) {
      const error = err as Error;
      console.error("【创建标签失败】", { uid, name: body.name, msg: error.message, stack: error.stack });
      return jsonResp(null, CODE.FAIL, "标签已存在");
    }
  },

  async list(env: Env, uid: number): Promise<Response> {
    const knex = createKnex(env);
    const list = await knex("note_tag")
      .where({ user_id: uid, is_deleted: 0 })
      .orderBy("created_at", "desc");
    return jsonResp(list);
  },

  async del(env: Env, uid: number, tid: string): Promise<Response> {
    const knex = createKnex(env);
    const updateTime = knex.fn.now();
    await knex.transaction(async (trx) => {
      await trx("note_tag_rel")
        .where({ tag_id: tid, is_deleted: 0 })
        .update({ is_deleted: 1, updated_at: updateTime });

      const affectRows = await trx("note_tag")
        .where({ id: tid, user_id: uid, is_deleted: 0 })
        .update({ is_deleted: 1, updated_at: updateTime });

      if (affectRows === 0) {
        throw new Error("标签不存在");
      }
    });
    return jsonResp(null, CODE.SUCCESS, "删除成功");
  }
};