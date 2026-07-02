import Redis, { ChainableCommander } from "ioredis";
import { Env } from "../types/env";

// ============================================
// 内存缓存模拟 Pipeline 实现
// ============================================
class MemoryPipeline {
  private readonly adapter: MemoryAdapter;
  private readonly commands: Array<{
    method: string;
    args: any[];
  }> = [];

  constructor(adapter: MemoryAdapter) {
    this.adapter = adapter;
  }

  zremrangebyscore(key: string, min: number, max: number): this {
    this.commands.push({ method: "zremrangebyscore", args: [key, min, max] });
    return this;
  }

  zcard(key: string): this {
    this.commands.push({ method: "zcard", args: [key] });
    return this;
  }

  zadd(key: string, score: number, member: string): this {
    this.commands.push({ method: "zadd", args: [key, { score, member }] });
    return this;
  }

  expire(key: string, ttl: number): this {
    this.commands.push({ method: "expire", args: [key, ttl] });
    return this;
  }

  set(key: string, value: string, ...args: any[]): this {
    this.commands.push({ method: "set", args: [key, value, ...args] });
    return this;
  }

  // 对齐 ioredis pipeline.exec 返回格式：[[err|null, result], ...]
  async exec(): Promise<Array<[Error | null, any]>> {
    const resultList: Array<[Error | null, any]> = [];
    for (const cmd of this.commands) {
      try {
        const fn = Reflect.get(this.adapter, cmd.method) as Function;
        const res = await fn.apply(this.adapter, cmd.args);
        resultList.push([null, res]);
      } catch (err) {
        resultList.push([err as Error, null]);
      }
    }
    return resultList;
  }
}

type AnyPipeline = ChainableCommander | MemoryPipeline;

// ============================================
// 类型定义
// ============================================
export interface CacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  expire(key: string, ttl: number): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
  mset(entries: Record<string, string>, ttl?: number): Promise<void>;
  incr(key: string): Promise<number>;
  flushAll?(): Promise<void>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  zadd(key: string, item: { score: number; member: string }): Promise<number>;

  pipeline(): AnyPipeline;
}

export interface CacheConfig {
  defaultTTL?: number;
  enableCompression?: boolean;
  slowQueryThreshold?: number;
  enableVerboseLogging?: boolean;
}

// ============================================
// 全局单例
// ============================================
type CacheInstanceKey = string;
const instanceMap = new Map<CacheInstanceKey, CacheAdapter>();

function getEnvUniqueKey(env: Env): string {
  return `${env.REDIS_URL ?? ''}_${env.NODE_ENV ?? ''}`;
}

// ============================================
// 耗时日志 Proxy Handler
// ============================================
function createLoggingProxy<T extends object>(
  target: T,
  operationName: string,
  slowThreshold: number,
  enableVerbose: boolean
): T {
  return new Proxy(target, {
    get(obj, prop) {
      const original = (obj as any)[prop];

      if (typeof original !== 'function') {
        return original;
      }

      return async function (...args: any[]) {
        const startTime = Date.now();
        const key = args.length > 0 ? args[0] : 'unknown';
        const keyStr = typeof key === 'string' ? key : JSON.stringify(key);

        try {
          const result = await original.apply(obj, args);
          const duration = Date.now() - startTime;

          if (duration > slowThreshold) {
            console.warn(
              `\x1b[33m[Redis Slow] ${String(prop)} key=${keyStr} 耗时=${duration}ms (阈值=${slowThreshold}ms)\x1b[0m`
            );
          } else if (enableVerbose) {
            console.log(
              `\x1b[36m[Redis Verbose] ${String(prop)} key=${keyStr} 耗时=${duration}ms\x1b[0m`
            );
          }

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(
            `\x1b[31m[Redis Error] ${String(prop)} key=${keyStr} 耗时=${duration}ms error=${error instanceof Error ? error.message : String(error)}\x1b[0m`
          );
          throw error;
        }
      };
    }
  });
}

// ============================================
// Redis 适配器（连接池优化 + 原生Pipeline）
// ============================================
class RedisAdapter implements CacheAdapter {
  private readonly redis: Redis;

  constructor(env: Env) {
    if (!env.REDIS_URL) {
      throw new Error('Redis 配置缺失：需要 REDIS_URL');
    }
  this.redis = new Redis(env.REDIS_URL, {
    keepAlive: 30000,
    connectTimeout: 10000,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    family: 4,
    retryStrategy: (times) => Math.min(times * 100, 3000)
  });

    this.redis.on('connect', () => console.log('[Redis] 连接成功'));
    this.redis.on('error', (err) => console.error('[Redis] 连接错误:', err));
    this.redis.on('close', () => console.warn('[Redis] 连接关闭'));
  }

  pipeline(): ChainableCommander {
    return this.redis.pipeline();
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, 'EX', ttl);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const cnt = await this.redis.exists(key);
    return cnt === 1;
  }

  async expire(key: string, ttl: number): Promise<void> {
    await this.redis.expire(key, ttl);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.redis.mget(keys);
  }

  async mset(entries: Record<string, string>, ttl?: number): Promise<void> {
    const entryList = Object.entries(entries);
    if (entryList.length === 0) return;

    if (ttl) {
      const pipeline = this.redis.pipeline();
      for (const [k, v] of entryList) {
        pipeline.set(k, v, 'EX', ttl);
      }
      await pipeline.exec();
    } else {
      await this.redis.mset(entries);
    }
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async flushAll(): Promise<void> {
    await this.redis.flushall();
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.redis.zremrangebyscore(key, min, max);
  }

  async zcard(key: string): Promise<number> {
    return this.redis.zcard(key);
  }

  async zadd(key: string, item: { score: number; member: string }): Promise<number> {
    return this.redis.zadd(key, item.score, item.member);
  }

  getClient(): Redis {
    return this.redis;
  }

  async quit(): Promise<void> {
    await this.redis.quit();
  }
}

// ============================================
// 内存适配器（内置模拟Pipeline）
// ============================================
class MemoryAdapter implements CacheAdapter {
  private static globalStore = new Map<string, { value: string; expire: number }>();
  private static globalZsetStore = new Map<string, number[]>();
  private static timerRegistered = false;
  private readonly defaultTTL: number;

  constructor(config?: CacheConfig) {
    this.defaultTTL = config?.defaultTTL ?? 3600;
    if (!MemoryAdapter.timerRegistered) {
      MemoryAdapter.timerRegistered = true;
      setInterval(() => {
        const now = Date.now();
        for (const [key, item] of MemoryAdapter.globalStore.entries()) {
          if (item.expire > 0 && now > item.expire) {
            MemoryAdapter.globalStore.delete(key);
          }
        }
      }, 10000);
    }
  }

  pipeline(): MemoryPipeline {
    return new MemoryPipeline(this);
  }

  async get(key: string): Promise<string | null> {
    const item = MemoryAdapter.globalStore.get(key);
    if (!item) return null;
    if (item.expire > 0 && Date.now() > item.expire) {
      MemoryAdapter.globalStore.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const ttlSec = ttl ?? this.defaultTTL;
    const expire = ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0;
    MemoryAdapter.globalStore.set(key, { value, expire });
  }

  async del(key: string): Promise<void> {
    MemoryAdapter.globalStore.delete(key);
    MemoryAdapter.globalZsetStore.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const v = await this.get(key);
    return v !== null || MemoryAdapter.globalZsetStore.has(key);
  }

  async expire(key: string, ttl: number): Promise<void> {
    const item = MemoryAdapter.globalStore.get(key);
    if (item) {
      item.expire = Date.now() + ttl * 1000;
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map(k => this.get(k)));
  }

  async mset(entries: Record<string, string>, ttl?: number): Promise<void> {
    for (const [k, v] of Object.entries(entries)) {
      await this.set(k, v, ttl);
    }
  }

  async incr(key: string): Promise<number> {
    const val = await this.get(key);
    const num = val ? parseInt(val, 10) : 0;
    const next = num + 1;
    await this.set(key, String(next));
    return next;
  }

  async flushAll(): Promise<void> {
    MemoryAdapter.globalStore.clear();
    MemoryAdapter.globalZsetStore.clear();
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const arr = MemoryAdapter.globalZsetStore.get(key) ?? [];
    const remain = arr.filter(ts => !(ts >= min && ts <= max));
    const delCount = arr.length - remain.length;
    MemoryAdapter.globalZsetStore.set(key, remain);
    return delCount;
  }

  async zcard(key: string): Promise<number> {
    return (MemoryAdapter.globalZsetStore.get(key) ?? []).length;
  }

  async zadd(key: string, item: { score: number; member: string }): Promise<number> {
    const arr = MemoryAdapter.globalZsetStore.get(key) ?? [];
    arr.push(item.score);
    MemoryAdapter.globalZsetStore.set(key, arr);
    return 1;
  }
}

export enum CacheType {
  REDIS = 'redis',
  AUTO = 'auto',
}

// ============================================
// 缓存工厂函数
// ============================================
export function createCache(
  env: Env,
  type: CacheType = CacheType.AUTO,
  config?: CacheConfig
): CacheAdapter {
  const instanceKey = getEnvUniqueKey(env);
  if (instanceMap.has(instanceKey)) {
    return instanceMap.get(instanceKey)!;
  }

  const hasRedis = !!env.REDIS_URL;
  const isDev = env.NODE_ENV === 'development';
  let rawInstance: CacheAdapter;
  let finalInstance: CacheAdapter;

  if (type === CacheType.AUTO) {
    if (isDev) {
      console.log('[Cache] 开发环境，使用内存缓存（重启丢失数据）');
      rawInstance = new MemoryAdapter(config);
    } else if (hasRedis) {
      console.log('[Cache] 自动选择 Redis 作为缓存后端');
      rawInstance = new RedisAdapter(env);
    } else {
      throw new Error('未配置 REDIS_URL，请配置 Redis 连接地址');
    }
  } else if (type === CacheType.REDIS) {
    if (!hasRedis) throw new Error('未配置 Redis 环境变量 REDIS_URL');
    console.log('[Cache] 强制使用 Redis');
    rawInstance = new RedisAdapter(env);
  } else {
    throw new Error(`不支持的缓存类型：${type}`);
  }

  const slowThreshold = config?.slowQueryThreshold ?? 100;
  const enableVerbose = config?.enableVerboseLogging ?? false;

  if (rawInstance instanceof RedisAdapter) {
    finalInstance = createLoggingProxy(
      rawInstance,
      'Redis',
      slowThreshold,
      enableVerbose
    ) as CacheAdapter;
  } else {
    finalInstance = rawInstance;
  }

  instanceMap.set(instanceKey, finalInstance);
  return finalInstance;
}

export function createRedis(env: Env): CacheAdapter {
  return createCache(env, CacheType.REDIS);
}

export function clearCacheSingleton() {
  instanceMap.clear();
}

// ============================================
// 缓存装饰器
// ============================================
export function cacheDecorator<T extends (...args: any[]) => Promise<unknown>>(
  cache: CacheAdapter,
  ttl: number = 3600,
  keyPrefix: string = ''
) {
  return function (fn: T): T {
    return (async (...args: Parameters<T>) => {
      const keyParts = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      );
      const cacheKey = `${keyPrefix}${keyParts.join(':')}`;

      try {
        const cached = await cache.get(cacheKey);
        if (cached) return JSON.parse(cached!);
      } catch (e) {
        console.warn(`[Cache] 读取缓存异常 key=${cacheKey}`, e);
      }

      const result = await fn(...args);

      try {
        await cache.set(cacheKey, JSON.stringify(result), ttl);
      } catch (e) {
        console.warn(`[Cache] 写入缓存异常 key=${cacheKey}`, e);
      }

      return result;
    }) as T;
  };
}

export function generateCacheKey(...parts: (string | number)[]): string {
  return parts.map(p => String(p)).join(':');
}

export async function deleteCacheByPrefix(
  cache: CacheAdapter,
  prefix: string
): Promise<void> {
  if (cache instanceof RedisAdapter) {
    console.warn('[Cache] Redis 前缀批量删除建议使用 SCAN 遍历删除，避免 KEYS 阻塞');
  }
}