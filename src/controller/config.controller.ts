import { createKnex } from '../config/knex'
import { createCache, CacheAdapter } from '../config/cache'
import { REDIS_GLOBAL_CONFIG_KEY, ConfigCacheItem, ConfigType } from '../types/system'
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

/**
 * 系统配置控制器
 */
export class ConfigController {
  /**
   * 【公开接口】前端获取解析后的配置键值
   */
  static async getPublicConfig(env: Env): Promise<Response> {
    const knex = createKnex(env)
    const cache: CacheAdapter = createCache(env)

    const cacheStr = await cache.get(REDIS_GLOBAL_CONFIG_KEY)
    let list: ConfigCacheItem[]

    if (!cacheStr) {
      // 只查询未删除配置
      list = await knex('sys_config')
        .where({ is_deleted: 0 })
        .select('config_key', 'config_value', 'config_type')
      // 全局配置默认缓存1小时
      await cache.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list), 3600)
    } else {
      try {
        list = JSON.parse(cacheStr)
      } catch {
        // 缓存数据损坏，重新查库
        list = await knex('sys_config')
          .where({ is_deleted: 0 })
          .select('config_key', 'config_value', 'config_type')
        await cache.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list), 3600)
      }
    }

    const configMap = new Map<string, { value: string; type: ConfigType }>()
    list.forEach(item => configMap.set(item.config_key, {
      value: item.config_value,
      type: item.config_type
    }))

    const result: Record<string, string | number | boolean | unknown> = {}
    for (const [key, item] of configMap) {
      switch (item.type) {
        case 'bool':
          result[key] = item.value === 'true'
          break
        case 'int':
          result[key] = Number(item.value)
          break
        case 'json':
          try {
            result[key] = JSON.parse(item.value)
          } catch {
            result[key] = item.value
          }
          break
        default:
          result[key] = item.value
      }
    }
    return jsonResp(result, CODE.SUCCESS)
  }

  /**
   * 通用根据 Key 获取配置，自动类型转换 + 默认值兜底
   */
  static async getConfigValue<T>(
    env: Env,
    configKey: string,
    defaultValue: T
  ): Promise<T> {
    const knex = createKnex(env)
    const cache: CacheAdapter = createCache(env)

    const cacheStr = await cache.get(REDIS_GLOBAL_CONFIG_KEY)
    let list: ConfigCacheItem[]
    if (!cacheStr) {
      list = await knex('sys_config')
        .where({ is_deleted: 0 })
        .select('config_key', 'config_value', 'config_type')
      await cache.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list), 3600)
    } else {
      try {
        list = JSON.parse(cacheStr)
      } catch {
        list = await knex('sys_config')
          .where({ is_deleted: 0 })
          .select('config_key', 'config_value', 'config_type')
        await cache.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list), 3600)
      }
    }

    const configMap = new Map<string, { value: string; type: ConfigType }>()
    list.forEach(item => configMap.set(item.config_key, { value: item.config_value, type: item.config_type }))

    const item = configMap.get(configKey)
    if (!item) return defaultValue
    switch (item.type) {
      case 'bool':
        return (item.value === 'true') as unknown as T
      case 'int':
        return Number(item.value) as unknown as T
      case 'json':
        try {
          return JSON.parse(item.value) as unknown as T
        } catch {
          return defaultValue
        }
      default:
        return item.value as unknown as T
    }
  }

  /**
   * 管理员：不分页获取全部配置字典
   */
  static async getConfigList(env: Env): Promise<Response> {
    const knex = createKnex(env)
    // 只查询未删除配置
    const list = await knex('sys_config')
      .where({ is_deleted: 0 })
      .orderBy('id', 'asc')
    return jsonResp(list, CODE.SUCCESS)
  }

  /**
   * 管理员：分页获取配置字典
   */
  static async getConfigPageList(
    env: Env,
    search: URLSearchParams = new URLSearchParams()
  ): Promise<Response> {
    const page = parseInt(search.get('page') || '1')
    const pageSize = parseInt(search.get('pageSize') || '10')
    const current = page > 0 ? page : 1
    const size = pageSize > 0 && pageSize <= 100 ? pageSize : 10
    const offset = (current - 1) * size

    const knex = createKnex(env)
    const totalRow = await knex('sys_config')
      .where({ is_deleted: 0 })
      .count('* as total')
      .first()
    const total = Number(totalRow?.total ?? 0)

    const list = await knex('sys_config')
      .where({ is_deleted: 0 })
      .orderBy('id', 'asc')
      .limit(size)
      .offset(offset)

    return jsonResp({
      list,
      total,
      page: current,
      pageSize: size
    }, CODE.SUCCESS)
  }

  /**
   * 管理员：新增配置项
   */
  static async addConfigItem(
    env: Env,
    body: {
      config_key: string
      config_value: string
      config_desc: string
      config_type: ConfigType
    }
  ): Promise<Response> {
    const key = body.config_key?.trim()
    if (!key) {
      return jsonResp(null, CODE.PARAM_ERR, '配置键不能为空')
    }

    const knex = createKnex(env)
    const cache: CacheAdapter = createCache(env)

    // 校验配置键唯一
    const exist = await knex('sys_config')
      .where({ config_key: key, is_deleted: 0 })
      .first()
    if (exist) {
      return jsonResp(null, CODE.FAIL, '该配置键已存在')
    }

    const now = knex.fn.now();
    await knex('sys_config').insert({
      config_key: key,
      config_value: body.config_value,
      config_desc: body.config_desc,
      config_type: body.config_type,
      is_deleted: 0,
      created_at: now,
      updated_at: now,
    })
    // 清空全局配置缓存，触发下一次重新加载
    await cache.del(REDIS_GLOBAL_CONFIG_KEY)
    return jsonResp(null, CODE.SUCCESS, '新增配置成功')
  }

  /**
   * 管理员：批量更新配置
   */
  static async batchUpdateSystemConfig(
    env: Env,
    updateList: Array<{ config_key: string; config_value: string; config_type: ConfigType }>
  ): Promise<Response> {
    if (!Array.isArray(updateList) || updateList.length === 0) {
      return jsonResp(null, CODE.PARAM_ERR, '更新配置数组不能为空')
    }
    const knex = createKnex(env)
    const cache: CacheAdapter = createCache(env)

    await knex.transaction(async (trx) => {
      for (const item of updateList) {
        await trx('sys_config')
          .where({ config_key: item.config_key, is_deleted: 0 })
          .update({
            config_value: item.config_value,
            config_type: item.config_type,
            updated_at: trx.fn.now()
          })
      }
    })

    await cache.del(REDIS_GLOBAL_CONFIG_KEY)
    return jsonResp(null, CODE.SUCCESS, '配置更新成功，缓存已刷新')
  }

  /**
   * 管理员：删除配置项（逻辑删除）
   */
  static async deleteConfigItem(
    env: Env,
    search: URLSearchParams = new URLSearchParams()
  ): Promise<Response> {
    const configKey = search.get('key')?.trim()
    if (!configKey) {
      return jsonResp(null, CODE.PARAM_ERR, '配置键不能为空')
    }

    const knex = createKnex(env)
    const cache: CacheAdapter = createCache(env)
    const now = knex.fn.now();

    await knex('sys_config')
      .where({ config_key: configKey, is_deleted: 0 })
      .update({
        is_deleted: 1,
        updated_at: now
      })
    await cache.del(REDIS_GLOBAL_CONFIG_KEY)

    return jsonResp(null, CODE.SUCCESS, '删除成功')
  }
}