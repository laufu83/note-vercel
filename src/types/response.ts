/**
 * 响应状态码定义
 */
export const CODE = {
  /** 成功 */
  SUCCESS: 200,
  /** 参数错误 */
  PARAM_ERR: 400,
  /** 未授权/未登录 */
  UNAUTH: 401,
  /** 禁止访问/权限不足 */
  FORBIDDEN: 403,
  /** 资源不存在 */
  NOT_FOUND: 404,
  /** 方法不允许 */
  METHOD_NOT_ALLOWED: 405,
  /** 请求失败/业务错误 */
  FAIL: 400,
  /** 服务器内部错误 */
  SERVER_ERR: 500,
  /** 限流 */
  RATE_LIMIT: 429,
  /** 冲突 */
  CONFLICT: 409,
  /** 请求实体过大 */
  PAYLOAD_TOO_LARGE: 413,
  /** 不支持的媒体类型 */
  UNSUPPORTED_MEDIA_TYPE: 415,
} as const;

export type CodeType = (typeof CODE)[keyof typeof CODE];

export type Resp<T = unknown> = {
  code: CodeType;
  msg: string;
  data?: T;
};