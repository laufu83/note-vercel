/**
 * Node 环境下环境变量类型定义，兼容原有业务代码
 * 移除 Cloudflare Workers 专属绑定类型 Hyperdrive、KVNamespace
 */
export interface Env extends NodeJS.ProcessEnv {
  /** 当前运行环境：development / production */
  NODE_ENV: string;
    /** 后端服务公网基础地址，用于拼接回调、分享链接、邮件跳转地址 */
  APP_BASE_URL: string;

  /** 数据库客户端类型：pg | mysql2 */
  DB_TYPE: string;
  /** 通用数据库连接地址 */
  DATABASE_URL: string;
  /** 数据库是否开启SSL加密：true / false */
  DB_SSL: string;

  /** Upstash Redis 服务连接地址 */
  REDIS_URL: string;
  /** Upstash Redis 访问密钥（Node下可保留兼容，不再强制使用） */
  REDIS_TOKEN?: string;

  /** Supabase 项目接口地址 */
  SUPABASE_URL: string;
  /** Supabase 服务端密钥（拥有全量权限） */
  SUPABASE_SERVICE_KEY: string;
  /** Supabase 文件存储桶名称 */
  SUPABASE_STORAGE_BUCKET: string;

  /** JWT 短期访问令牌加密密钥 */
  JWT_ACCESS_SECRET: string;
  /** JWT 刷新令牌加密密钥 */
  JWT_REFRESH_SECRET: string;
  /** 访问令牌过期时间，如 15m、1h */
  ACCESS_TOKEN_EXPIRE: string;
  /** 刷新令牌过期时间，如 7d、30d */
  REFRESH_TOKEN_EXPIRE: string;

  /** Bcrypt 密码加密加盐轮次 */
  BCRYPT_SALT_ROUND: string;

  /** IP维度限流：单个时间窗口内最大请求次数 */
  RATE_LIMIT_IP_MAX: string;
  /** 用户账号维度限流：单个时间窗口内最大请求次数 */
  RATE_LIMIT_USER_MAX: string;
  /** 限流时间窗口，单位：秒 */
  RATE_LIMIT_WINDOW_SEC: string;

  /** 智谱AI 接口密钥 */
  ZHIPU_API_KEY: string;
  /** 智谱AI 接口请求地址 */
  ZHIPU_BASE_URL: string;
  /** 智谱AI 使用的模型名称 */
  ZHIPU_MODEL: string;



  /** Resend 邮件发送服务密钥 */
  RESEND_API_KEY: string;
  /** 邮件发送人邮箱地址 */
  EMAIL_FROM: string;

  ENABLE_LOG: string;
}