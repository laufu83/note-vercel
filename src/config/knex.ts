// src/config/knex.ts
import knex, { type Knex as KnexInstance } from 'knex';
import mysql2 from 'mysql2';
import {Env} from '../types/env';
// 慢SQL阈值：毫秒
const SLOW_SQL_THRESHOLD = 200;

/**
 * 拼接带参数完整可执行SQL，自动转义单引号、日期、null
 */
function compileFullSql(sql: string, bindings: unknown[]): string {
  let fullSql = sql;
  for (const val of bindings) {
    let replaceVal: string;
    if (val === null || val === undefined) {
      replaceVal = 'NULL';
    } else if (typeof val === 'string') {
      replaceVal = `'${val.replace(/'/g, "''")}'`;
    } else if (val instanceof Date) {
      replaceVal = `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
    } else {
      replaceVal = String(val);
    }
    fullSql = fullSql.replace('?', replaceVal);
  }
  return fullSql;
}

// 存储每条SQL开始时间，key使用queryId
const queryStartTimeMap = new Map<string, number>();

/**
 * 挂载全局SQL日志 + 慢SQL告警 + 异常日志
 */
function attachSqlLogger(db: KnexInstance, enableLog: boolean) {
  if (!enableLog) return;

  db.on('query', (queryData) => {
    const startTime = Date.now();
    const queryId = queryData.__knexQueryUid;
    queryStartTimeMap.set(queryId, startTime);

    const fullSql = compileFullSql(queryData.sql, queryData.bindings);
    console.log('\n[Knex SQL]', fullSql);
  });

  db.on('query-response', (_result, queryData) => {
    const queryId = queryData.__knexQueryUid;
    const startTime = queryStartTimeMap.get(queryId);
    if (startTime === undefined) return;

    const cost = Date.now() - startTime;
    queryStartTimeMap.delete(queryId);

    if (cost >= SLOW_SQL_THRESHOLD) {
      console.log(`\x1b[31m[慢SQL告警] 耗时：${cost}ms，阈值：${SLOW_SQL_THRESHOLD}ms\x1b[0m\n`);
    } else {
      console.log(`[SQL耗时] ${cost}ms\n`);
    }
  });

  db.on('query-error', (err, queryData) => {
    const queryId = queryData.__knexQueryUid;
    const startTime = queryStartTimeMap.get(queryId) ?? Date.now();
    queryStartTimeMap.delete(queryId);

    const fullSql = compileFullSql(queryData.sql, queryData.bindings);
    const cost = Date.now() - startTime;
    console.error('\x1b[31m[SQL执行失败]\x1b[0m');
    console.error('SQL:', fullSql);
    console.error(`耗时: ${cost}ms`);
    console.error('错误信息:', err.message, '\n');
  });
}

export function createKnex(env: Env): KnexInstance {
  const client = env.DB_TYPE || 'pg';
  const enableLog = env.ENABLE_LOG=== 'true';

  if (client === 'pg') {
    const connectionString = env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }

    const config = {
      client: 'pg',
      connection: {
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      },
      pool: {
        min: 2,
        max: 10,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 10000,
        afterCreate: (conn: any, done: Function) => {
          conn.query("SET TIME ZONE 'Asia/Shanghai'", (err: any) => {
            done(err, conn);
          });
        }
      },
      acquireConnectionTimeout: 10000,
      useNullAsDefault: true,
      debug: false,
    };

    const db = knex(config);  
    attachSqlLogger(db, enableLog);
    return db;
  }

  if (client === 'mysql2') {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }

    const config = {
      client: 'mysql2',
      connection: env.DATABASE_URL,
      pool: {
        min: 2,
        max: 10,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 10000,
      },
      acquireConnectionTimeout: 10000,
      useNullAsDefault: true,
      debug: false,
    };

    const db = knex(config);
    const mysqlClient = db.client as any;
    mysqlClient.driver = mysql2;

    attachSqlLogger(db, enableLog);
    return db;
  }

  throw new Error(`不支持的数据库客户端: ${client}`);
}

/**
 * 请求结束必须手动销毁连接池，释放当前请求内所有TCP套接字
 */
export async function destroyKnexInstance(db: KnexInstance) {
  await db.destroy();
}