import 'dotenv/config'
import type { Env } from "./types/env";
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { handleOptionsCors } from "./utils/cors";
import { dispatch } from "./route/router";
import { createKnex } from "./config/knex";

// 统一做一次类型断言，全局复用，不要多处重复断言
const env = process.env as unknown as Env;

const app = new Hono()

// 全局OPTIONS跨域预检
app.options('*', (c) => {
  return handleOptionsCors()
})

// 所有业务路由转发，复用原有dispatch逻辑
app.all('*', async (c) => {
  const res = await dispatch(c.req.raw, env);
  return res;
});

// 前端静态资源托管
//app.use('/*', serveStatic({ root: './dist' }))

const PORT = Number(process.env.PORT) || 3000
serve({
  fetch: app.fetch,
  port: PORT
})
console.log(`服务已启动，监听端口: ${PORT}`)

// 封装原定时清理任务函数
export async function runScheduleCleanTask() {
  // 直接使用已经断言好的 env，不再传原生 process.env
  const knex = createKnex(env)
  // 回收站过期笔记清理
  await knex("notes")
    .where("is_deleted", true)
    .where("delete_expired_at", "<", knex.fn.now(6))
    .del()

  // 过期刷新令牌清理
  await knex("user_refresh_token")
    .where("expired_at", "<", knex.fn.now(6))
    .del()
  console.log('定时清理任务执行完成')
}

// 如需服务内定时执行，安装 node-schedule 开启下面代码
// import schedule from 'node-schedule'
// // 每天凌晨2点执行清理
// schedule.scheduleJob('0 2 * * *', runScheduleCleanTask)