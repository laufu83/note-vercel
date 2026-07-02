// src/controllers/category.controller.ts
import { createKnex } from "../config/knex";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export const CategoryController = {
  async create(env: Env, uid: number, body: { name: string; sort: number }): Promise<Response> {
    const knex = createKnex(env);
    try {
      const insertData = {
        user_id: uid,
        name: body.name,
        sort: body.sort,
        is_deleted: 0,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      };
      // 双库兼容 returning 获取新增记录
      const [category] = await knex("note_category")
        .insert(insertData)
        .returning("*");

      return jsonResp(category);
    } catch (err) {
      const error = err as Error;
      console.error("【创建分类失败】", { uid, name: body.name, msg: error.message, stack: error.stack });
      return jsonResp(null, CODE.FAIL, "该分类名称已存在");
    }
  },

  async list(env: Env, uid: number): Promise<Response> {
    const knex = createKnex(env);
    const list = await knex("note_category")
      .where({ user_id: uid, is_deleted: 0 })
      .orderBy("sort", "desc");
    return jsonResp(list);
  },

  async update(env: Env, uid: number, cid: string, body: { name?: string; sort?: number }): Promise<Response> {
    const knex = createKnex(env);
    const updateData: Record<string, any> = {
      updated_at: knex.fn.now()
    };
    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.sort !== undefined) {
      updateData.sort = body.sort;
    }

    const rowCount = await knex("note_category")
      .where({ id: cid, user_id: uid, is_deleted: 0 })
      .update(updateData);

    if (rowCount === 0) {
      return jsonResp(null, CODE.NOT_FOUND, "分类不存在");
    }
    const updatedItem = await knex("note_category")
      .where({ id: cid, is_deleted: 0 })
      .first();
    return jsonResp(updatedItem);
  },

  async del(env: Env, uid: number, cid: string): Promise<Response> {
    const knex = createKnex(env);
    await knex.transaction(async (trx) => {
      // 中间表逻辑删除
      await trx("note_category_rel")
        .where({ category_id: cid, is_deleted: 0 })
        .update({ is_deleted: 1, updated_at: trx.fn.now() });

      // 分类逻辑删除
      const rowCount = await trx("note_category")
        .where({ id: cid, user_id: uid, is_deleted: 0 })
        .update({ is_deleted: 1, updated_at: trx.fn.now() });

      if (rowCount === 0) {
        throw new Error("分类不存在");
      }
    });
    return jsonResp(null, CODE.SUCCESS, "删除成功");
  }
};