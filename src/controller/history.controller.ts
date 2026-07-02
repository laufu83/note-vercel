import type { Env } from '../types/env'
import { createKnex } from '../config/knex'
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";

export class HistoryController {

  /**
   * 获取笔记所有历史版本
   * GET /api/note/:id/history
   */
  static async getNoteHistory(env: Env, uid: number, noteId: string): Promise<Response> {
    console.log(noteId, uid);
    const knex = createKnex(env)

    const rows = await knex('note_history')
      .where({ note_id: noteId, user_id: uid })
      .orderBy('created_at', 'desc')
      .select('id', 'note_id', 'title', 'content', 'created_at')

    return jsonResp(rows, CODE.SUCCESS)
  }

  /**
   * 手动新建笔记历史快照（编辑保存时自动调用）
   * POST /api/note/history
   */
  static async createHistorySnapshot(
    env: Env,
    uid: number,
    body: { note_id: number; title: string; content: string }
  ): Promise<Response> {
    const knex = createKnex(env)
    const now = knex.fn.now();

    await knex('note_history').insert({
      user_id: uid,
      note_id: body.note_id,
      title: body.title,
      content: body.content,
      created_at: now,
      updated_at: now,
    })

    return jsonResp(null, CODE.SUCCESS, '已保存历史快照')
  }

  /**
   * 删除单条笔记历史版本
   * DELETE /api/note/history/:id
   */
  static async deleteHistory(env: Env, uid: number, id: string): Promise<Response> {
    console.log(id, uid);
    const knex = createKnex(env)

    const affectedRows = await knex('note_history')
      .where({ id, user_id: uid })
      .delete()

    if (affectedRows === 0) {
      return jsonResp(null, CODE.NOT_FOUND, '该历史记录不存在或无权限删除');
    }

    return jsonResp(null, CODE.SUCCESS, '删除成功');
  }
}