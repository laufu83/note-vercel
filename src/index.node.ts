import 'dotenv/config'
import type { Env } from "./types/env";
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { handleOptionsCors } from "./utils/cors";
import { dispatch } from "./route/router";
import { createKnex, destroyKnexInstance } from "./config/knex";

// 全局只初始化一次环境变量 + Knex连接池（单例复用）
const env = process.env as unknown as Env;
const knex = createKnex(env);
const app = new Hono()

// 全局OPTIONS跨域预检
app.options('*', (c) => {
  return handleOptionsCors()
})

// 健康测试接口：增加数据库连通性检测
app.get('/api/health', async (c) => {
  let dbStatus = "ok";
  try {
    await knex.raw("SELECT 1");
  } catch (err) {
    dbStatus = "fail";
    console.error("数据库连通异常", err);
  }
  return c.json({
    code: 0,
    msg: '服务运行正常',
    timestamp: Date.now(),
    env: process.env.NODE_ENV || 'development',
    database: dbStatus
  })
})

// 所有业务路由转发
app.all('*', async (c) => {
  const res = await dispatch(c.req.raw, env);
  return res;
});

// 仅本地开发启动端口监听
if (process.env.NODE_ENV !== 'production') {
  const PORT = Number(process.env.PORT) || 3000
  serve({
    fetch: app.fetch,
    port: PORT
  })
  console.log(`服务已启动，监听端口: ${PORT}`)
}

// 定时清理任务：复用全局knex，不再重复创建连接池
export async function runScheduleCleanTask() {
  // 直接使用全局已初始化的knex实例
  await knex("notes")
    .where("is_deleted", true)
    .where("delete_expired_at", "<", knex.fn.now(6))
    .del()

  await knex("user_refresh_token")
    .where("expired_at", "<", knex.fn.now(6))
    .del()
  console.log('定时清理任务执行完成')
}

// 进程退出时销毁数据库连接池，释放TCP连接
process.on('SIGTERM', async () => {
  await destroyKnexInstance();
  process.exit(0);
})

process.on('SIGINT', async () => {
  await destroyKnexInstance();
  process.exit(0);
})

// CommonJS 导出适配Vercel
module.exports = app;

// 禁止在函数内常驻定时任务，Vercel冷启动会不断新建实例打爆连接
// import schedule from 'node-schedule'
// schedule.scheduleJob('0 2 * * *', runScheduleCleanTask)