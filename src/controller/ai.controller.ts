// src/controllers/aiController.ts
import type { Env } from '../types/env';
import { jsonResp } from '../utils/response';
import { CODE } from '../types/response';
import { callZhipu, type ZhipuMessage } from '../config/zhipu';

// ===================== 类型定义优化 =====================
/** AI 服务自定义错误类型 */
interface ZhipuError {
  status?: number;
  code?: number;
  message?: string;
}

/** 类型守卫：判断是否为智谱接口业务错误 */
function isZhipuError(err: unknown): err is ZhipuError {
  return typeof err === 'object' && err !== null && ('status' in err || 'code' in err || 'message' in err);
}

/** 通用错误类型 */
type ServiceError = Error | ZhipuError;

// AI 配置常量
const AI_CONFIG = {
  DEFAULT_TEMPERATURE: 0.7,
  DEFAULT_MAX_TOKENS: 2000,
  SUMMARIZE_TEMPERATURE: 0.3,
  POLISH_TEMPERATURE: 0.4,
  TRANSLATE_TEMPERATURE: 0.2,
  MAX_CONTENT_LENGTH: 10000,
  CACHE_TTL: 3600,
};

// 提示词模板
const PROMPT_TEMPLATES = {
  SUMMARIZE: (content: string) =>
    `请对下面这段笔记内容进行精简总结，语言通顺精炼，控制在200字以内：\n\n${content}`,

  POLISH: (content: string) =>
    `帮我润色下面这段笔记，修正语病、优化语句通顺度，保持原有原意，只返回优化后的内容：\n\n${content}`,

  CONTINUE: (content: string) =>
    `基于下面这段笔记的内容，合理往下续写内容，保持原文风格一致，续写内容要自然连贯：\n\n${content}`,

  TRANSLATE: (content: string, targetLang: string) =>
    `将下面文本翻译成${targetLang}，只返回翻译结果，不要额外解释：\n\n${content}`,
};

// AI 响应内存缓存
type CacheItem = {
  data: unknown;
  timestamp: number;
};
const responseCache = new Map<string, CacheItem>();

export class AIController {
  /**
   * 统一AI异常处理（类型安全）
   */
  private static handleAIError(err: unknown): ReturnType<typeof jsonResp> {
    // 类型守卫收窄错误类型
    const error: ServiceError = isZhipuError(err) ? err : err as Error;

    // 智谱限流 429 code:1305
    if ('status' in error && error.status === CODE.RATE_LIMIT && error.code === 1305) {
      return jsonResp(null, CODE.RATE_LIMIT, '该模型当前访问量过大，请您稍后再试');
    }

    const errMsg = 'message' in error ? (error.message ?? '') : '';

    // 未配置密钥
    if (errMsg.includes('ZHIPU_API_KEY')) {
      return jsonResp(null, CODE.SERVER_ERR, '服务端未配置AI密钥，请联系管理员');
    }

    // 超时错误
    if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
      return jsonResp(null, CODE.SERVER_ERR, 'AI服务响应超时，请稍后重试');
    }

    // 打印原始错误日志
    console.error('【AI服务异常】', err);
    return jsonResp(null, CODE.SERVER_ERR, errMsg || 'AI服务调用异常，请稍后重试');
  }

  /**
   * 通用执行AI请求（带缓存和重试）
   */
  private static async runZhipu(
    env: Env,
    prompt: string,
    temperature = AI_CONFIG.DEFAULT_TEMPERATURE,
    maxTokens = AI_CONFIG.DEFAULT_MAX_TOKENS,
    options?: { useCache?: boolean; retries?: number }
  ): Promise<unknown> {
    const { useCache = false, retries = 1 } = options || {};

    // 生成缓存键
    const cacheKey = useCache
      ? `ai:${prompt.slice(0, 100)}:${temperature}:${maxTokens}`
      : null;

    // 检查缓存
    if (cacheKey) {
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < AI_CONFIG.CACHE_TTL * 1000) {
        return cached.data;
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await callZhipu(
          env,
          [{ role: 'user', content: prompt }],
          temperature,
          maxTokens
        );

        // 写入缓存
        if (cacheKey) {
          responseCache.set(cacheKey, {
            data: result,
            timestamp: Date.now(),
          });
        }

        return result;
      } catch (err) {
        lastError = err;
        // 限流不重试
        if (isZhipuError(err) && err.status === CODE.RATE_LIMIT) {
          break;
        }
        // 最后一次直接抛出
        if (attempt === retries) {
          throw err;
        }
        // 指数退避等待
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }

    throw lastError;
  }

  /**
   * 内容长度校验
   */
  private static validateContent(content: string, maxLength: number = AI_CONFIG.MAX_CONTENT_LENGTH): boolean {
    if (!content?.trim()) return false;
    if (content.length > maxLength) return false;
    return true;
  }

  /**
   * 1. AI 对话聊天（支持历史上下文）
   * POST /api/ai/chat
   */
  static async chat(
    env: Env,
    body: { prompt: string; history?: ZhipuMessage[]; temperature?: number; max_tokens?: number }
  ): Promise<Response> {
    try {
      let { prompt, history = [], temperature = AI_CONFIG.DEFAULT_TEMPERATURE, max_tokens = AI_CONFIG.DEFAULT_MAX_TOKENS } = body;

      if (max_tokens > 4000) max_tokens = 4000;

      if (!prompt?.trim()) {
        const lastUserMessage = history.filter(m => m.role === 'user').pop();
        if (lastUserMessage) {
          prompt = lastUserMessage.content;
          history = history.filter(m => m !== lastUserMessage);
        }
      }

      const systemMessages = history.filter(m => m.role === 'system');
      let systemPrompt = '';
      if (systemMessages.length > 0) {
        systemPrompt = systemMessages.map(m => m.content).join('\n');
        history = history.filter(m => m.role !== 'system');
      }

      let finalPrompt = prompt || '请开始对话';
      if (systemPrompt && finalPrompt) {
        finalPrompt = `${systemPrompt}\n\n${finalPrompt}`;
      } else if (systemPrompt) {
        finalPrompt = systemPrompt;
      }

      if (!finalPrompt?.trim()) {
        return jsonResp(null, CODE.PARAM_ERR, '请输入对话内容');
      }

      const MAX_HISTORY = 20;
      if (history.length > MAX_HISTORY) {
        history = history.slice(-MAX_HISTORY);
      }

      const messages: ZhipuMessage[] = [];
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push(msg);
        }
      }
      messages.push({ role: 'user', content: finalPrompt });

      const reply = await callZhipu(env, messages, temperature, max_tokens);
      return jsonResp({ reply }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 2. 笔记内容总结
   * POST /api/ai/summarize
   */
  static async summarize(env: Env, body: { content: string }): Promise<Response> {
    try {
      const { content } = body;

      if (!this.validateContent(content)) {
        return jsonResp(
          null,
          CODE.PARAM_ERR,
          `笔记内容不能为空且不能超过${AI_CONFIG.MAX_CONTENT_LENGTH}字符`
        );
      }

      if (content.length < 50) {
        return jsonResp({ summary: content }, CODE.SUCCESS);
      }

      const prompt = PROMPT_TEMPLATES.SUMMARIZE(content);
      const summary = await this.runZhipu(
        env,
        prompt,
        AI_CONFIG.SUMMARIZE_TEMPERATURE,
        AI_CONFIG.DEFAULT_MAX_TOKENS,
        { useCache: true }
      );
      return jsonResp({ summary }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 3. 笔记润色优化
   * POST /api/ai/polish
   */
  static async polish(env: Env, body: { content: string }): Promise<Response> {
    try {
      const { content } = body;

      if (!this.validateContent(content)) {
        return jsonResp(
          null,
          CODE.PARAM_ERR,
          `笔记内容不能为空且不能超过${AI_CONFIG.MAX_CONTENT_LENGTH}字符`
        );
      }

      if (content.length < 20) {
        return jsonResp({ polished: content.trim() }, CODE.SUCCESS);
      }

      const prompt = PROMPT_TEMPLATES.POLISH(content);
      const polished = await this.runZhipu(
        env,
        prompt,
        AI_CONFIG.POLISH_TEMPERATURE,
        AI_CONFIG.DEFAULT_MAX_TOKENS,
        { useCache: true }
      );
      return jsonResp({ polished }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 4. 续写笔记
   * POST /api/ai/continue
   */
  static async continueWrite(env: Env, body: { content: string }): Promise<Response> {
    try {
      const { content } = body;

      if (!this.validateContent(content)) {
        return jsonResp(
          null,
          CODE.PARAM_ERR,
          `笔记内容不能为空且不能超过${AI_CONFIG.MAX_CONTENT_LENGTH}字符`
        );
      }

      if (content.length < 30) {
        return jsonResp(null, CODE.PARAM_ERR, '内容太短，无法进行合理续写');
      }

      const prompt = PROMPT_TEMPLATES.CONTINUE(content);
      const continue_content = await this.runZhipu(
        env,
        prompt,
        AI_CONFIG.DEFAULT_TEMPERATURE,
        AI_CONFIG.DEFAULT_MAX_TOKENS,
        { useCache: false }
      );
      return jsonResp({ continue_content }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 5. 文本翻译
   * POST /api/ai/translate
   */
  static async translate(
    env: Env,
    body: { content: string; target_lang?: string }
  ): Promise<Response> {
    try {
      const { content, target_lang = '英文' } = body;

      if (!this.validateContent(content)) {
        return jsonResp(
          null,
          CODE.PARAM_ERR,
          `待翻译内容不能为空且不能超过${AI_CONFIG.MAX_CONTENT_LENGTH}字符`
        );
      }

      const SUPPORTED_LANGS = ['中文', '英文', '日语', '韩语', '法语', '德语', '西班牙语', '俄语'];
      if (!SUPPORTED_LANGS.includes(target_lang)) {
        return jsonResp(
          null,
          CODE.PARAM_ERR,
          `不支持的目标语言，支持: ${SUPPORTED_LANGS.join('、')}`
        );
      }

      if (content.length < 10) {
        return jsonResp({ result: content }, CODE.SUCCESS);
      }

      const prompt = PROMPT_TEMPLATES.TRANSLATE(content, target_lang);
      const result = await this.runZhipu(
        env,
        prompt,
        AI_CONFIG.TRANSLATE_TEMPERATURE,
        AI_CONFIG.DEFAULT_MAX_TOKENS,
        { useCache: true }
      );
      return jsonResp({ result }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 6. 批量处理
   * POST /api/ai/batch
   */
  static async batchProcess(
    env: Env,
    body: {
      items: Array<{ type: 'summarize' | 'polish' | 'translate'; content: string; target_lang?: string }>;
      max_concurrent?: number;
    }
  ): Promise<Response> {
    try {
      const { items, max_concurrent = 3 } = body;

      if (!items || items.length === 0) {
        return jsonResp(null, CODE.PARAM_ERR, '待处理内容不能为空');
      }

      if (items.length > 10) {
        return jsonResp(null, CODE.PARAM_ERR, '单次批量处理最多支持10项');
      }

      const results: Response[] = [];
      const chunks: typeof items[] = [];
      for (let i = 0; i < items.length; i += max_concurrent) {
        chunks.push(items.slice(i, i + max_concurrent));
      }

      for (const chunk of chunks) {
        const promises = chunk.map(async (item) => {
          try {
            switch (item.type) {
              case 'summarize':
                return await this.summarize(env, { content: item.content });
              case 'polish':
                return await this.polish(env, { content: item.content });
              case 'translate':
                return await this.translate(env, {
                  content: item.content,
                  target_lang: item.target_lang || '英文'
                });
              default:
                return jsonResp(null, CODE.PARAM_ERR, `不支持的类型: ${item.type}`);
            }
          } catch (err) {
            return this.handleAIError(err);
          }
        });

        const chunkResults = await Promise.all(promises);
        results.push(...chunkResults);
      }

      return jsonResp({ results }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 7. 清除AI缓存
   * POST /api/ai/clear-cache
   */
  static async clearCache(): Promise<Response> {
    responseCache.clear();
    return jsonResp(null, CODE.SUCCESS, 'AI缓存已清除');
  }

  /**
   * 8. 获取AI状态
   * GET /api/ai/status
   */
  static async getStatus(): Promise<Response> {
    return jsonResp({
      cacheSize: responseCache.size,
      config: {
        maxContentLength: AI_CONFIG.MAX_CONTENT_LENGTH,
        cacheTTL: AI_CONFIG.CACHE_TTL,
        defaultTemperature: AI_CONFIG.DEFAULT_TEMPERATURE,
        defaultMaxTokens: AI_CONFIG.DEFAULT_MAX_TOKENS,
      }
    }, CODE.SUCCESS);
  }
}