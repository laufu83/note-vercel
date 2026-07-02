/**
 * 下划线命名转小驼峰
 * @param obj 原始下划线格式对象
 * @returns 小驼峰格式对象
 */
export function snakeToCamel<T>(obj: unknown): T {
  if (obj === null || typeof obj !== 'object') return obj as T;

  // 数组递归处理
  if (Array.isArray(obj)) {
    return obj.map((item) => snakeToCamel(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
      result[camelKey] = snakeToCamel((obj as Record<string, unknown>)[key]);
    }
  }
  return result as T;
}

/**
 * 小驼峰转下划线命名（数据库入库统一格式）
 * @param obj 小驼峰对象
 * @returns 下划线格式对象
 */
export function camelToSnake<T>(obj: unknown): T {
  if (obj === null || typeof obj !== 'object') return obj as T;

  if (Array.isArray(obj)) {
    return obj.map((item) => camelToSnake(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
      result[snakeKey] = camelToSnake((obj as Record<string, unknown>)[key]);
    }
  }
  return result as T;
}