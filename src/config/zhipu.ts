import {Env} from '../types/env'
// 智谱官方基础地址

export interface ZhipuMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface ZhipuChatReq {
  model: string
  messages: ZhipuMessage[]
  temperature?: number
}

/**
 * 通用调用智谱AI（带429限流指数退避重试）
 * @param env 环境变量
 * @param messages 对话上下文
 * @param temperature 温度
 * @param retry 当前重试次数
 * @returns AI返回文本
 */
export async function callZhipu(
  env: Env,
  messages: ZhipuMessage[],
  temperature = 0.7,
  retry = 0
): Promise<string> {
  const MAX_RETRY = 2;
  const apiKey = env.ZHIPU_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 ZHIPU_API_KEY 环境变量');
  }
  const baseUrl = env.ZHIPU_BASE_URL;
  if (!baseUrl) {
    throw new Error('未配置 ZHIPU_BASE_URL 环境变量');
  }

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages,
        temperature,
      } as ZhipuChatReq),
    });

    // 响应异常：429/401/500 等
    if (!res.ok) {
      let errInfo: { error?: { code: number; message: string } } = {};
      try {
        errInfo = await res.json();
      } catch {
        const errText = await res.text();
        throw new Error(`智谱接口请求失败: ${res.status} ${errText}`);
      }

      // 智谱 429 限流错误 code=1305，触发重试
      if (res.status === 429 && errInfo.error?.code === 1305 && retry < MAX_RETRY) {
        // 指数退避：2s、4s
        const delay = (retry + 1) * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return callZhipu(env, messages, temperature, retry + 1);
      }

      // 结构化抛出业务错误，控制器直接识别
      throw {
        status: res.status,
        code: errInfo.error?.code,
        message: errInfo.error?.message || `请求异常：${res.status}`,
      };
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    // 非重试类错误直接向上抛出
    throw err;
  }
}