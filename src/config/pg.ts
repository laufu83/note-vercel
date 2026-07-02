import { Pool } from "pg";
import { Env } from "../types/env";
export function createPgPool(env: Env) {
  if (!env.DATABASE_URL) {
    throw new Error('未配置 DATABASE_URL 数据库连接地址');
  }
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 20000,
    ssl: true,
  });
}