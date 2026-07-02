// 声明 bcryptjs 模块类型
declare module 'bcryptjs';

// Node 环境下全局没有浏览器原生 Crypto、OffscreenCanvas，删除这两个全局声明
// declare var crypto: Crypto
// declare var OffscreenCanvas: typeof globalThis.OffscreenCanvas

// src/types/knex.d.ts
import 'knex';

declare module 'knex' {
  interface Config {
    driver?: {
      Client: any;
      Pool: any;
    };
  }
}