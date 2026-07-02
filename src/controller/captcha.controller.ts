import { v4 as uuidv4 } from 'uuid'
import { createCache, CacheAdapter } from '../config/cache'
import { createSvgCaptcha } from '../utils/captcha'
import { jsonResp } from '../utils/response'
import { CODE } from '../types/response'
import type { Env } from '../types/env'

const CAPTCHA_KEY_PREFIX = 'img:captcha:'
const CAPTCHA_EXPIRE = 300

/**
 * 图形验证码控制器
 */
export class CaptchaController {
  /**
   * 获取SVG图形验证码
   */
  static async getImageCaptcha(env: Env): Promise<Response> {
    const cache: CacheAdapter = createCache(env)
    const { code, svg } = await createSvgCaptcha()
    const key = uuidv4()
    const cacheKey = `${CAPTCHA_KEY_PREFIX}${key}`

    // 统一存储大写验证码，忽略大小写校验
    await cache.set(cacheKey, code.toUpperCase(), CAPTCHA_EXPIRE)

    return jsonResp({
      key,
      svg
    })
  }

  /**
   * 校验图形验证码，校验通过返回临时安全令牌
   * @param env 环境变量
   * @param key 验证码唯一标识
   * @param code 用户输入验证码
   */
  static async verifyImageCaptcha(env: Env, key: string, code: string): Promise<Response> {
    // 入参非空校验
    if (!key || !code) {
      return jsonResp(null, CODE.PARAM_ERR, '验证码标识和验证码不能为空')
    }

    const cache: CacheAdapter = createCache(env)
    const cacheKey = `${CAPTCHA_KEY_PREFIX}${key}`
    const realCode = await cache.get(cacheKey)

    // 验证码已过期、key不存在
    if (!realCode) {
      return jsonResp(null, CODE.FAIL, '验证码已过期，请刷新')
    }

    // 验证后立即删除，防止重复提交刷接口
    await cache.del(cacheKey)

    // 统一转大写比对，避免大小写差异导致校验失败
    const inputCode = String(code).trim().toUpperCase()
    if (realCode !== inputCode) {
      return jsonResp(null, CODE.FAIL, '验证码错误')
    }

    // 下发临时安全凭证，用于注册、登录接口做前置校验
    const token = uuidv4()
    await cache.set(`img:token:${token}`, '1', CAPTCHA_EXPIRE)

    return jsonResp(token, CODE.SUCCESS, '验证通过')
  }
}