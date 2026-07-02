// src/controllers/note.controller.ts
import { createKnex } from "../config/knex";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";
import { noteEncryptService } from "../utils/note-encrypt";

type NoteCreateBody = {
  title: string;
  content?: string;
  categoryIds?: number[];
  tagNames?: string[];
  is_draft?: number;
  is_top?: number;
  is_star?: number;
  is_encrypted?: number;
  note_password?: string;
};

type NoteUpdateBody = {
  title?: string;
  content?: string;
  is_draft?: number;
  is_top?: number;
  is_star?: number;
  categoryIds?: number[];
  tagNames?: string[];
  is_encrypted?: number;
  note_password?: string;
  new_password?: string;
};

export const NoteController = {
  async create(env: Env, uid: number, body: NoteCreateBody): Promise<Response> {
    const knex = createKnex(env);
    const { title, content, categoryIds, tagNames, is_draft, is_top, is_star, is_encrypted, note_password } = body;

    if (is_encrypted === 1) {
      if (!note_password) {
        return jsonResp(null, CODE.PARAM_ERR, '开启笔记加密必须设置访问密码');
      }
      const pwdCheck = noteEncryptService.validatePassword(note_password);
      if (!pwdCheck.isValid) {
        return jsonResp(null, CODE.PARAM_ERR, pwdCheck.message);
      }
      if (!title || !content) {
        return jsonResp(null, CODE.PARAM_ERR, '标题、内容不能为空');
      }
    }

    let saveTitle = title;
    let saveContent: string | null = content ?? null;
    let salt: string | null = null;
    let iv: string | null = null;
    let passwordHash: string | null = null;

    if (is_encrypted === 1) {
      const result = await noteEncryptService.encryptWithNewSalt(content!, note_password!);
      saveContent = result.cipherText;
      salt = result.salt;
      iv = result.iv;
      passwordHash = result.hash;
    }

    try {
      return await knex.transaction(async (trx) => {
        const now = trx.fn.now();
        const insertData = {
          user_id: uid,
          title: saveTitle,
          content: saveContent,
          is_draft: is_draft ?? 0,
          is_top: is_top ?? 0,
          is_star: is_star ?? 0,
          is_encrypted: is_encrypted ?? 0,
          salt,
          iv,
          password_hash: passwordHash,
          version: 1,
          is_deleted: 0,
          created_at: now,
          updated_at: now,
        };

        const [noteId] = await trx('notes').insert(insertData).returning('id');
        const nid = Number(noteId.id);

        await trx('note_history').insert({
          note_id: nid,
          user_id: uid,
          title: saveTitle,
          content: saveContent,
          is_deleted: 0,
          created_at: now,
          updated_at: now,
        });

        if (categoryIds?.length) {
          const rels = categoryIds.map(cid => ({
            note_id: nid,
            category_id: cid,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
          }));
          await trx('note_category_rel')
            .insert(rels)
            .onConflict(['note_id', 'category_id', 'is_deleted'])
            .ignore();
        }

        if (tagNames?.length) {
          const uniqueTagNames = [...new Set(tagNames)];

          const existingTags = await trx('note_tag')
            .where({ user_id: uid, is_deleted: 0 })
            .whereIn('name', uniqueTagNames)
            .select('id', 'name');

          const existingTagMap = new Map(existingTags.map(tag => [tag.name, tag.id]));
          const newTagNames = uniqueTagNames.filter(name => !existingTagMap.has(name));

          if (newTagNames.length) {
            const newTags = newTagNames.map(name => ({
              user_id: uid,
              name,
              is_deleted: 0,
              created_at: now,
              updated_at: now,
            }));
            await trx('note_tag').insert(newTags);

            const newTagRecords = await trx('note_tag')
              .where({ user_id: uid, is_deleted: 0 })
              .whereIn('name', newTagNames)
              .select('id', 'name');

            newTagRecords.forEach(tag => existingTagMap.set(tag.name, tag.id));
          }

          const tagRels = uniqueTagNames.map(name => ({
            note_id: nid,
            tag_id: existingTagMap.get(name)!,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
          }));

          await trx('note_tag_rel')
            .insert(tagRels)
            .onConflict(['note_id', 'tag_id', 'is_deleted'])
            .ignore();
        }

        const insertedNote = await trx('notes')
          .where({ id: nid, user_id: uid, is_deleted: 0 })
          .first();

        if (insertedNote?.is_encrypted === 1) {
          insertedNote.content = null;
        }

        return jsonResp(insertedNote);
      });
    } catch (err) {
      const error = err as Error;
      console.error("【创建笔记异常】", { uid, title, msg: error.message });
      return jsonResp(null, CODE.FAIL, error.message);
    }
  },

  async list(env: Env, uid: number, search: URLSearchParams): Promise<Response> {
    const knex = createKnex(env);
    const page = Math.max(1, parseInt(search.get("page") || "1"));
    const size = Math.min(100, Math.max(1, parseInt(search.get("size") || "20")));
    const keyword = search.get("q")?.trim();
    const isDraft = search.get("is_draft");
    const isStar = search.get("is_star");
    const isTop = search.get("is_top");
    const isDelete = search.get("trash") === "1" || search.get("is_deleted") === "1";
    const offset = (page - 1) * size;

    let query = knex('notes')
      .select(
        'id',
        'title',
        'is_encrypted',
        'is_top',
        'is_star',
        'is_draft',
        'is_deleted',
        'created_at',
        'updated_at',
        'version'
      )
      .where({ user_id: uid, is_deleted: isDelete ? 1 : 0 });

    if (keyword) {
      const kw = `%${keyword}%`;
      query.andWhere(function (qb) {
        qb.whereRaw('LOWER(title) LIKE LOWER(?)', [kw]);
      });
    }

    if (isDraft !== null) query.andWhere('is_draft', isDraft === '1' ? 1 : 0);
    if (isStar !== null) query.andWhere('is_star', isStar === '1' ? 1 : 0);
    if (isTop !== null) query.andWhere('is_top', isTop === '1' ? 1 : 0);

    const [countResult, noteList] = await Promise.all([
      query.clone().clearSelect().count('* as total').first(),
      query
        .orderBy('is_top', 'desc')
        .orderBy('updated_at', 'desc')
        .limit(size)
        .offset(offset)
    ]);

    const total = countResult ? Number(countResult.total) : 0;

    if (noteList.length > 0) {
      const noteIds = noteList.map(n => n.id);

      const [categoryRels, tagRels] = await Promise.all([
        knex('note_category_rel')
          .join('note_category', 'note_category_rel.category_id', 'note_category.id')
          .whereIn('note_id', noteIds)
          .andWhere('note_category_rel.is_deleted', 0)
          .select('note_id', 'category_id', 'note_category.name'),
        knex('note_tag_rel')
          .join('note_tag', 'note_tag_rel.tag_id', 'note_tag.id')
          .whereIn('note_id', noteIds)
          .andWhere('note_tag_rel.is_deleted', 0)
          .select('note_id', 'note_tag.name')
      ]);

      const categoryMap = new Map();
      const tagMap = new Map();

      categoryRels.forEach(c => {
        if (!categoryMap.has(c.note_id)) {
          categoryMap.set(c.note_id, { ids: [], names: [] });
        }
        const data = categoryMap.get(c.note_id);
        data.ids.push(c.category_id);
        data.names.push(c.name);
      });

      tagRels.forEach(t => {
        if (!tagMap.has(t.note_id)) {
          tagMap.set(t.note_id, []);
        }
        tagMap.get(t.note_id).push(t.name);
      });

      const list = noteList.map(row => ({
        ...row,
        categoryIds: categoryMap.get(row.id)?.ids || [],
        categoryNames: categoryMap.get(row.id)?.names || [],
        tags: tagMap.get(row.id) || [],
        content: undefined
      }));

      return jsonResp({ list, total });
    }

    return jsonResp({ list: [], total: 0 });
  },

  async detail(env: Env, uid: number, nid: string, search?: URLSearchParams): Promise<Response> {
    const knex = createKnex(env);
    const query = search || new URLSearchParams();
    const decryptPwd = query.get('password');

    const note = await knex('notes')
      .where({ id: nid, user_id: uid, is_deleted: 0 })
      .first();

    if (!note) return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");

    const cateRows = await knex('note_category_rel')
      .select('category_id')
      .where({ note_id: nid, is_deleted: 0 });
    note.categoryIds = cateRows.map(item => item.category_id);

    const tagRows = await knex('note_tag_rel')
      .join('note_tag', 'note_tag_rel.tag_id', 'note_tag.id')
      .select('note_tag.name')
      .where({ 'note_tag_rel.note_id': nid, 'note_tag.user_id': uid, 'note_tag_rel.is_deleted': 0 });
    note.tagNames = tagRows.map(item => item.name);

    if (note.is_encrypted === 0) return jsonResp(note);

    if (!decryptPwd) {
      return jsonResp({
        id: note.id,
        title: note.title,
        categoryIds: note.categoryIds,
        tagNames: note.tagNames,
        content: null,
        is_encrypted: note.is_encrypted,
        is_top: note.is_top,
        is_star: note.is_star,
        is_draft: note.is_draft,
        is_deleted: note.is_deleted,
        created_at: note.created_at,
        updated_at: note.updated_at,
        version: note.version
      }, CODE.SUCCESS, '需要传入访问密码解密查看正文内容');
    }

    const isValid = await noteEncryptService.verifyPassword(decryptPwd, note.salt, note.password_hash);
    if (!isValid) return jsonResp(null, CODE.UNAUTH, '密码错误');

    try {
      const plainContent = await noteEncryptService.decrypt(note.content, decryptPwd, note.salt, note.iv);
      return jsonResp({ ...note, content: plainContent });
    } catch (err) {
      console.error("【笔记解密失败】", { noteId: nid, err });
      return jsonResp(null, CODE.UNAUTH, '解密失败，数据可能已损坏');
    }
  },

  async update(env: Env, uid: number, nid: string, body: NoteUpdateBody): Promise<Response> {
    const knex = createKnex(env);
    const updateTime = knex.fn.now();
    try {
      return await knex.transaction(async (trx) => {
        const origin = await trx('notes')
          .select('id', 'title', 'content', 'is_encrypted', 'salt', 'iv', 'password_hash')
          .where({ id: nid, user_id: uid, is_deleted: 0 })
          .first();
        if (!origin) throw new Error("笔记不存在");

        const now = trx.fn.now();
        await trx('note_history').insert({
          note_id: nid,
          user_id: uid,
          title: origin.title,
          content: origin.content,
          is_deleted: 0,
          created_at: now,
          updated_at: now,
        });

        const { title, content, categoryIds, tagNames, is_encrypted, note_password, new_password } = body;
        let saveTitle = title ?? origin.title;
        let saveContent = origin.content;
        let newSalt: string | null = origin.salt;
        let newIv: string | null = origin.iv;
        let newPasswordHash: string | null = origin.password_hash;

        if (origin.is_encrypted === 1) {
          if (!note_password) throw new Error('修改加密笔记必须传入原访问密码');
          const isValid = await noteEncryptService.verifyPassword(note_password, origin.salt, origin.password_hash);
          if (!isValid) throw new Error('原访问密码错误');

          if (is_encrypted === 1) {
            if (new_password) {
              const res = await noteEncryptService.changePassword(content!, new_password, origin.salt);
              saveContent = res.cipherText;
              newSalt = res.salt;
              newIv = res.iv;
              newPasswordHash = res.hash;
            } else {
              const res = await noteEncryptService.encryptWithExistingSalt(content!, note_password, origin.salt);
              saveContent = res.cipherText;
              newSalt = res.salt;
              newIv = res.iv;
            }
          } else {
            const plain = await noteEncryptService.decrypt(origin.content, note_password, origin.salt, origin.iv);
            saveContent = content ?? plain;
            newSalt = null;
            newIv = null;
            newPasswordHash = null;
          }
        } else {
          if (is_encrypted !== 1) {
            saveContent = content ?? origin.content;
            newSalt = null;
            newIv = null;
            newPasswordHash = null;
          } else {
            if (!note_password) throw new Error('开启加密必须设置访问密码');
            const check = noteEncryptService.validatePassword(note_password);
            if (!check.isValid) throw new Error(check.message);
            const res = await noteEncryptService.encryptWithNewSalt(content!, note_password);
            saveContent = res.cipherText;
            newSalt = res.salt;
            newIv = res.iv;
            newPasswordHash = res.hash;
          }
        }

        const updateData: Record<string, any> = {
          title: saveTitle,
          content: saveContent,
          salt: newSalt,
          iv: newIv,
          password_hash: newPasswordHash,
          is_encrypted: is_encrypted ?? 0,
          updated_at: updateTime,
        };

        await trx('notes').where({ id: nid, user_id: uid, is_deleted: 0 }).update('version', trx.raw('version + 1'));
        if (body.is_top !== undefined) updateData.is_top = body.is_top;
        if (body.is_star !== undefined) updateData.is_star = body.is_star;
        if (body.is_draft !== undefined) updateData.is_draft = body.is_draft;

        await trx('notes').where({ id: nid, user_id: uid, is_deleted: 0 }).update(updateData);
        const updatedNote = await trx('notes').where({ id: nid, is_deleted: 0 }).first();

        if (categoryIds !== undefined) {
          await trx('note_category_rel')
            .where({ note_id: nid, is_deleted: 0 })
            .update({ is_deleted: 1, updated_at: updateTime });
          if (categoryIds.length) {
            const rels = categoryIds.map(cid => ({
              note_id: nid,
              category_id: cid,
              is_deleted: 0,
              created_at: updateTime,
              updated_at: updateTime,
            }));
            await trx('note_category_rel').insert(rels).onConflict(['note_id', 'category_id', 'is_deleted']).ignore();
          }
        }

        if (tagNames !== undefined) {
          await trx('note_tag_rel')
            .where({ note_id: nid, is_deleted: 0 })
            .update({ is_deleted: 1, updated_at: updateTime });

          const uniqueTagNames = [...new Set(tagNames)];
          const existingTags = await trx('note_tag')
            .where({ user_id: uid, is_deleted: 0 })
            .whereIn('name', uniqueTagNames)
            .select('id', 'name');

          const existingTagMap = new Map(existingTags.map(tag => [tag.name, tag.id]));
          const newTagNames = uniqueTagNames.filter(name => !existingTagMap.has(name));

          if (newTagNames.length) {
            const newTags = newTagNames.map(name => ({
              user_id: uid,
              name,
              is_deleted: 0,
              created_at: updateTime,
              updated_at: updateTime,
            }));
            await trx('note_tag').insert(newTags);

            const newTagRecords = await trx('note_tag')
              .where({ user_id: uid, is_deleted: 0 })
              .whereIn('name', newTagNames)
              .select('id', 'name');

            newTagRecords.forEach(tag => existingTagMap.set(tag.name, tag.id));
          }

          const tagRels = uniqueTagNames.map(name => ({
            note_id: nid,
            tag_id: existingTagMap.get(name)!,
            is_deleted: 0,
            created_at: updateTime,
            updated_at: updateTime,
          }));

          await trx('note_tag_rel')
            .insert(tagRels)
            .onConflict(['note_id', 'tag_id', 'is_deleted'])
            .ignore();
        }

        if (updatedNote.is_encrypted === 1) updatedNote.content = null;
        return jsonResp(updatedNote);
      });
    } catch (err) {
      const error = err as Error;
      console.error("【更新笔记异常】", { uid, nid, msg: error.message, stack: error.stack });
      return jsonResp(null, CODE.FAIL, error.message);
    }
  },

  async moveRecycle(env: Env, uid: number, nid: string): Promise<Response> {
    const knex = createKnex(env);
    const expire = knex.raw(`CURRENT_TIMESTAMP + INTERVAL '30' DAY`);
    const affected = await knex('notes')
      .where({ id: nid, user_id: uid, is_deleted: 0 })
      .update({
        is_deleted: 1,
        delete_expire: expire,
        updated_at: knex.fn.now()
      });
    if (!affected) return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");
    return jsonResp(null, CODE.SUCCESS, "已移入回收站");
  },

  async restore(env: Env, uid: number, nid: string): Promise<Response> {
    const knex = createKnex(env);
    const affected = await knex('notes')
      .where({ id: nid, user_id: uid, is_deleted: 1 })
      .update({
        is_deleted: 0,
        delete_expire: null,
        updated_at: knex.fn.now()
      });
    if (!affected) return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");
    return jsonResp(null, CODE.SUCCESS, "恢复成功");
  },

  async permanentDelete(env: Env, uid: number, nid: string): Promise<Response> {
    const knex = createKnex(env);
    try {
      return await knex.transaction(async trx => {
        await trx('note_category_rel').where({ note_id: nid }).delete();
        await trx('note_tag_rel').where({ note_id: nid }).delete();
        await trx('note_history').where({ note_id: nid }).delete();
        await trx('note_share').where({ note_id: nid }).delete();
        const delCnt = await trx('notes').where({ id: nid, user_id: uid, is_deleted: 1 }).delete();
        if (!delCnt) throw new Error('笔记不存在，仅回收站可永久删除');
      }).then(() => jsonResp(null, CODE.SUCCESS, "永久删除成功"));
    } catch (err) {
      const error = err as Error;
      console.error("【永久删除笔记异常】", { uid, nid, msg: error.message });
      return jsonResp(null, CODE.FAIL, error.message);
    }
  },

  async rollback(env: Env, uid: number, nid: string, hid: number): Promise<Response> {
    const knex = createKnex(env);
    const note = await knex('notes').where({ id: nid, user_id: uid, is_deleted: 0 }).first();
    if (!note) return jsonResp(null, CODE.FORBIDDEN, "无权限操作");

    const history = await knex('note_history').where({ id: hid, note_id: nid, is_deleted: 0 }).first();
    if (!history) return jsonResp(null, CODE.NOT_FOUND, "版本不存在");

    try {
      await knex.transaction(async trx => {
        const now = trx.fn.now();
        await trx('note_history').insert({
          note_id: nid, user_id: uid, title: note.title, content: note.content, is_deleted: 0,
          created_at: now, updated_at: now
        });
        await trx('notes').where({ id: nid, is_deleted: 0 }).update({
          title: history.title,
          content: history.content,
          updated_at: now,
          version: trx.raw('version + 1')
        });
      });
      return jsonResp(null, CODE.SUCCESS, "版本回滚成功");
    } catch (err) {
      const error = err as Error;
      console.error("【笔记回滚异常】", error.message);
      return jsonResp(null, CODE.FAIL, error.message);
    }
  },

  async clearTrash(env: Env, uid: number): Promise<Response> {
    const knex = createKnex(env);
    try {
      return await knex.transaction(async trx => {
        const trash = await trx('notes').select('id').where({ user_id: uid, is_deleted: 1 });
        const ids = trash.map(i => i.id);
        if (!ids.length) throw new Error("回收站暂无数据可清空");

        await trx('note_category_rel').whereIn('note_id', ids).delete();
        await trx('note_tag_rel').whereIn('note_id', ids).delete();
        await trx('note_history').whereIn('note_id', ids).delete();
        await trx('note_share').whereIn('note_id', ids).delete();
        await trx('notes').where({ user_id: uid, is_deleted: 1 }).delete();
        return jsonResp(null, CODE.SUCCESS, "回收站清空成功");
      });
    } catch (err) {
      const error = err as Error;
      console.error("【清空回收站异常】", error.message);
      return jsonResp(null, CODE.FAIL, error.message);
    }
  },

  async exportAllNote(env: Env, uid: number, search: URLSearchParams): Promise<Response> {
    const knex = createKnex(env);
    const page = Math.max(1, parseInt(search.get("page") || "1"));
    const size = Math.min(1000, Math.max(0, parseInt(search.get("size") || "0")));
    const keyword = search.get("q")?.trim();
    const isDraftStr = search.get("is_draft");
    const isStarStr = search.get("is_star");
    const isDelete = search.get("trash") === "1" || search.get("is_deleted") === "1";
    const offset = size > 0 ? (page - 1) * size : 0;

    let query = knex('notes')
      .select(
        'id',
        'title',
        'content',
        'is_encrypted',
        'is_top',
        'is_star',
        'is_draft',
        'is_deleted',
        'created_at',
        'updated_at',
        'version'
      )
      .where({ user_id: uid, is_deleted: isDelete ? 1 : 0 });

    if (keyword) {
      const kw = `%${keyword}%`;
      query.andWhere(function (qb) {
        qb.whereRaw('LOWER(title) LIKE LOWER(?)', [kw]);
      });
    }

    if (isDraftStr !== null) query.andWhere('is_draft', isDraftStr === '1' ? 1 : 0);
    if (isStarStr !== null) query.andWhere('is_star', isStarStr === '1' ? 1 : 0);

    query.orderBy('is_top', 'desc').orderBy('updated_at', 'desc');
    if (size > 0) query.limit(size).offset(offset);

    const rows = await query;
    const noteIds = rows.map(r => r.id);

    if (noteIds.length > 0) {
      const [categoryRels, tagRels] = await Promise.all([
        knex('note_category_rel')
          .join('note_category', 'note_category_rel.category_id', 'note_category.id')
          .whereIn('note_id', noteIds)
          .andWhere('note_category_rel.is_deleted', 0),
        knex('note_tag_rel')
          .join('note_tag', 'note_tag_rel.tag_id', 'note_tag.id')
          .whereIn('note_id', noteIds)
          .andWhere('note_tag_rel.is_deleted', 0)
      ]);

      const result = rows.map(row => {
        const cate = categoryRels.filter(c => c.note_id === row.id);
        const tags = tagRels.filter(t => t.note_id === row.id);
        return {
          ...row,
          categoryIds: cate.map(c => c.category_id),
          categoryNames: cate.map(c => c.name),
          tagNames: tags.map(t => t.name),
          content: row.is_encrypted === 1 ? null : row.content
        };
      });

      return jsonResp(result, CODE.SUCCESS, "查询成功");
    }

    return jsonResp([], CODE.SUCCESS, "查询成功");
  }
};