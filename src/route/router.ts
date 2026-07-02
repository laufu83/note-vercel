// src/app.ts
import { UserController } from "../controller/user.controller";
import { AuthController } from "../controller/auth.controller";
import { NoteController } from "../controller/note.controller";
import { CategoryController } from "../controller/category.controller";
import { TagController } from "../controller/tag.controller";
import { FileController } from "../controller/file.controller";
import { ShareController } from "../controller/share.controller";
import { AIController } from "../controller/ai.controller";
import { HistoryController } from "../controller/history.controller";
import { authMiddleware } from "../middleware/middleware";
import { rateLimitCheck } from "../utils/rate-limit";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";
import type { UserJWTPayload } from "../types/model";
import { CaptchaController } from "../controller/captcha.controller";
import { ConfigController } from "../controller/config.controller";
// 顶部导入
import { withRequestLogger } from "../middleware/logger";
// ====================== 类型定义 ======================
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type RouteRule = {
  path: string | RegExp;
  method: HttpMethod;
  isPublic: boolean;
  requireAdmin?: boolean;
  desc?: string;
  handler: (
    env: Env,
    payload: UserJWTPayload | null,
    body?: any,
    search?: URLSearchParams,
    pathParam?: string,
  ) => Promise<Response>;
};

type RouteMatchResult = {
  matched: RouteRule | null;
  pathParam: string | undefined;
  hasOtherMethod: boolean;
};

// ====================== 路由规则列表 ======================
const routeList: RouteRule[] = [
  // 1. 认证模块
  {
    path: "/api/user/register",
    method: "POST",
    isPublic: true,
    desc: "用户注册",
    handler: (e, _, b) => AuthController.register(e, b),
  },
  {
    path: "/api/user/login",
    method: "POST",
    isPublic: true,
    desc: "用户登录",
    handler: (e, _, b) => AuthController.login(e, b),
  },
  {
    path: "/api/user/refresh-token",
    method: "POST",
    isPublic: true,
    desc: "刷新令牌",
    handler: (e, _, b) => AuthController.refreshToken(e, b),
  },
  {
    path: "/api/user/activate",
    method: "GET",
    isPublic: true,
    desc: "邮箱激活账号",
    handler: (e, _, __, s) => AuthController.activateUser(e, s?.get("token")),
  },
  {
    path: "/api/user/reset-pwd-send",
    method: "POST",
    isPublic: true,
    desc: "发送重置密码邮件",
    handler: (e, _, b) => AuthController.resetPwdSend(e, b),
  },
  {
    path: "/api/user/reset-pwd",
    method: "POST",
    isPublic: true,
    desc: "重置密码",
    handler: (e, _, b) => AuthController.resetPwd(e, b),
  },
  {
    path: "/api/user/resend-activate",
    method: "POST",
    isPublic: true,
    desc: "重发激活邮件",
    handler: (e, _, b) => AuthController.resendActivateMail(e, b),
  },
  {
    path: "/api/user/change-email",
    method: "GET",
    isPublic: true,
    desc: "邮箱更换激活",
    handler: (e, _, __, s) => AuthController.activateChangeEmail(e, s),
  },

  // 2. 用户模块
  {
    path: "/api/user/info",
    method: "GET",
    isPublic: false,
    desc: "获取当前用户信息",
    handler: (e, payload) => UserController.getCurrentUserInfo(e, payload!.uid),
  },
  {
    path: "/api/user/list",
    method: "GET",
    isPublic: false,
    requireAdmin: true,
    desc: "管理员获取用户列表",
    handler: (e, _p, _b, s) => UserController.getUserList(e, s),
  },
  {
    path: "/api/user/update",
    method: "POST",
    isPublic: false,
    requireAdmin: true,
    desc: "管理员更新用户信息",
    handler: (e, _, b) => UserController.updateUserInfo(e, b),
  },
  {
    path: "/api/user/profile",
    method: "POST",
    isPublic: false,
    desc: "更新用户资料",
    handler: (e, payload, b) => UserController.updateProfile(e, payload!.uid, b),
  },
  {
    path: "/api/user/change-pwd",
    method: "POST",
    isPublic: false,
    desc: "修改密码",
    handler: (e, payload, b) => UserController.changePwd(e, payload!.uid, b),
  },
  {
    path: "/api/user/admin-reset-pwd",
    method: "POST",
    isPublic: false,
    requireAdmin: true,
    desc: "管理员重置用户密码",
    handler: (e, _, b) => UserController.adminResetUserPwd(e, b),
  },
  {
    path: "/api/user/destroy",
    method: "DELETE",
    isPublic: false,
    desc: "注销账号",
    handler: (e, payload) => UserController.destroyAccount(e, payload!.uid),
  },

  // 3. 笔记模块
  {
    path: "/api/note",
    method: "POST",
    isPublic: false,
    desc: "创建笔记",
    handler: (e, payload, b) => NoteController.create(e, payload!.uid, b),
  },
  {
    path: "/api/note",
    method: "GET",
    isPublic: false,
    desc: "笔记列表",
    handler: (e, payload, _, s) => NoteController.list(e, payload!.uid, s!),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "GET",
    isPublic: false,
    desc: "笔记详情",
    handler: (e, payload, _b, s, p) => NoteController.detail(e, payload!.uid, p!, s),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "PUT",
    isPublic: false,
    desc: "更新笔记",
    handler: (e, payload, b, _, p) => NoteController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "移入回收站",
    handler: (e, payload, _, __, p) => NoteController.moveRecycle(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/restore$/,
    method: "PUT",
    isPublic: false,
    desc: "恢复笔记",
    handler: (e, payload, _, __, p) => NoteController.restore(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/destroy$/,
    method: "DELETE",
    isPublic: false,
    desc: "永久删除笔记",
    handler: (e, payload, _, __, p) => NoteController.permanentDelete(e, payload!.uid, p!),
  },
  {
    path: "/api/note/trash/clear",
    method: "DELETE",
    isPublic: false,
    desc: "清空回收站",
    handler: (e, payload) => NoteController.clearTrash(e, payload!.uid),
  },
  {
    path: "/api/note/rollback",
    method: "POST",
    isPublic: false,
    desc: "版本回滚",
    handler: (e, payload, b) => NoteController.rollback(e, payload!.uid, b.noteId, b.historyId),
  },
  {
    path: "/api/note/export",
    method: "GET",
    isPublic: false,
    desc: "导出笔记",
    handler: (e, payload, _b, s) => NoteController.exportAllNote(e, payload!.uid, s!),
  },

  // 4. 分类模块
  {
    path: "/api/category",
    method: "POST",
    isPublic: false,
    desc: "创建分类",
    handler: (e, payload, b) => CategoryController.create(e, payload!.uid, b),
  },
  {
    path: "/api/category",
    method: "GET",
    isPublic: false,
    desc: "分类列表",
    handler: (e, payload) => CategoryController.list(e, payload!.uid),
  },
  {
    path: /^\/api\/category\/(\d+)$/,
    method: "PUT",
    isPublic: false,
    desc: "更新分类",
    handler: (e, payload, b, _, p) => CategoryController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/category\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除分类",
    handler: (e, payload, _, __, p) => CategoryController.del(e, payload!.uid, p!),
  },

  // 5. 标签模块
  {
    path: "/api/tag",
    method: "POST",
    isPublic: false,
    desc: "创建标签",
    handler: (e, payload, b) => TagController.create(e, payload!.uid, b),
  },
  {
    path: "/api/tag",
    method: "GET",
    isPublic: false,
    desc: "标签列表",
    handler: (e, payload) => TagController.list(e, payload!.uid),
  },
  {
    path: /^\/api\/tag\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除标签",
    handler: (e, payload, _, __, p) => TagController.del(e, payload!.uid, p!),
  },

  // 6. 文件模块
  {
    path: "/api/file/upload",
    method: "POST",
    isPublic: false,
    desc: "文件上传",
    handler: (e, payload, b) => FileController.upload(e, payload!.uid, b.file),
  },
  {
    path: "/api/file",
    method: "GET",
    isPublic: false,
    desc: "文件列表",
    handler: (e, payload, _b, s) => FileController.list(e, payload!.uid, s!),
  },
  {
    path: "/api/file/delete",
    method: "POST",
    isPublic: false,
    desc: "删除文件",
    handler: (e, payload, b) => FileController.delete(e, payload!.uid, b.path),
  },

  // 7. 分享模块
  {
    path: "/api/share/create",
    method: "POST",
    isPublic: false,
    desc: "创建分享",
    handler: (e, payload, b) => ShareController.create(e, payload!.uid, b),
  },
  {
    path: "/api/share/list",
    method: "GET",
    isPublic: false,
    desc: "分享列表",
    handler: (e, payload) => ShareController.myShareList(e, payload!.uid),
  },
  {
    path: /^\/api\/share\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除分享",
    handler: (e, payload, _, __, p) => ShareController.deleteShare(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/share\/([\da-fA-F]{16,32})$/,
    method: "GET",
    isPublic: true,
    desc: "公开访问分享",
    handler: (e, _, __, s, p) => ShareController.getPublicShare(e, p!, s?.get("pwd")),
  },

  // 8. 图形验证码模块
  {
    path: "/api/captcha/img",
    method: "GET",
    isPublic: true,
    desc: "获取SVG图形验证码",
    handler: (env) => CaptchaController.getImageCaptcha(env),
  },
  {
    path: "/api/captcha/verify",
    method: "POST",
    isPublic: true,
    desc: "校验图形验证码",
    handler: (env, _, body) => CaptchaController.verifyImageCaptcha(env, body.key, body.code),
  },

  // 9. AI模块
  {
    path: "/api/ai/chat",
    method: "POST",
    isPublic: true,
    desc: "AI对话",
    handler: (e, _, b) => AIController.chat(e, b),
  },
  {
    path: "/api/ai/summarize",
    method: "POST",
    isPublic: true,
    desc: "AI内容总结",
    handler: (e, _, b) => AIController.summarize(e, b),
  },
  {
    path: "/api/ai/polish",
    method: "POST",
    isPublic: true,
    desc: "AI文本润色",
    handler: (e, _, b) => AIController.polish(e, b),
  },
  {
    path: "/api/ai/continue",
    method: "POST",
    isPublic: true,
    desc: "AI内容续写",
    handler: (e, _, b) => AIController.continueWrite(e, b),
  },
  {
    path: "/api/ai/translate",
    method: "POST",
    isPublic: true,
    desc: "AI翻译",
    handler: (e, _, b) => AIController.translate(e, b),
  },
  {
    path: "/api/ai/batch",
    method: "POST",
    isPublic: true,
    desc: "AI批量处理",
    handler: (e, _, b) => AIController.batchProcess(e, b),
  },
  {
    path: "/api/ai/clear-cache",
    method: "POST",
    isPublic: false,
    requireAdmin: true,
    desc: "清空AI缓存",
    handler: () => AIController.clearCache(),
  },
  {
    path: "/api/ai/status",
    method: "GET",
    isPublic: true,
    desc: "获取AI服务状态",
    handler: () => AIController.getStatus(),
  },

  // 10. 笔记历史版本模块
  {
    path: /^\/api\/note\/(\d+)\/history$/,
    method: "GET",
    isPublic: false,
    desc: "获取笔记所有历史版本",
    handler: (e, payload, _, __, p) => HistoryController.getNoteHistory(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/history\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除单条历史记录",
    handler: (e, payload, _, __, p) => HistoryController.deleteHistory(e, payload!.uid, p!),
  },

  // 11. 系统配置模块
  {
    path: "/api/system/config",
    method: "GET",
    isPublic: true,
    desc: "前端获取公开系统配置",
    handler: (env) => ConfigController.getPublicConfig(env),
  },
  {
    path: "/api/system/config/list",
    method: "GET",
    isPublic: false,
    requireAdmin: true,
    desc: "管理员获取全部配置列表",
    handler: (env) => ConfigController.getConfigList(env),
  },
  {
    path: "/api/system/config/page",
    method: "GET",
    isPublic: false,
    requireAdmin: true,
    desc: "配置分页查询",
    handler: (env, _p, _b, search) => ConfigController.getConfigPageList(env, search),
  },
  {
    path: "/api/system/config/batch",
    method: "PUT",
    isPublic: false,
    requireAdmin: true,
    desc: "批量更新系统配置",
    handler: (env, _p, body) => ConfigController.batchUpdateSystemConfig(env, body),
  },
  {
    path: "/api/system/config/add",
    method: "POST",
    isPublic: false,
    requireAdmin: true,
    desc: "新增配置项",
    handler: (env, _p, body) => ConfigController.addConfigItem(env, body),
  },
  {
    path: "/api/system/config/delete",
    method: "DELETE",
    isPublic: false,
    requireAdmin: true,
    desc: "删除配置项",
    handler: (env, _p, _b, search) => ConfigController.deleteConfigItem(env, search),
  },
];

// ====================== 工具函数 ======================
/**
 * 解析请求体：支持JSON / FormData / x-www-form-urlencoded / text
 */
async function parseRequestBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const data: Record<string, unknown> = {};
    for (const [key, val] of form.entries()) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        data[key] = Array.isArray(data[key])
          ? [...(data[key] as unknown[]), val]
          : [data[key], val];
      } else {
        data[key] = val;
      }
    }
    return data;
  }

  if (contentType.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      return undefined;
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const data: Record<string, string | string[]> = {};
      for (const [k, v] of params.entries()) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          data[k] = Array.isArray(data[k])
            ? [...(data[k] as string[]), v]
            : [data[k] as string, v];
        } else {
          data[k] = v;
        }
      }
      return data;
    } catch {
      return undefined;
    }
  }

  if (contentType.includes("text/plain")) {
    try {
      return await req.text();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * 路由匹配（正则优先、字符串次之）
 */
function matchRoute(path: string, method: HttpMethod): RouteMatchResult {
  let matched: RouteRule | null = null;
  let pathParam: string | undefined;
  let hasOtherMethod = false;

  // 正则路由匹配
  for (const route of routeList) {
    if (typeof route.path === "string") continue;
    const res = path.match(route.path);
    if (!res) continue;
    if (route.method === method) {
      matched = route;
      pathParam = res[1];
    } else {
      hasOtherMethod = true;
    }
  }
  if (matched) return { matched, pathParam, hasOtherMethod };

  // 字符串精确路由匹配
  for (const route of routeList) {
    if (typeof route.path !== "string") continue;
    if (route.path === path) {
      if (route.method === method) {
        matched = route;
      } else {
        hasOtherMethod = true;
      }
    }
  }

  return { matched, pathParam, hasOtherMethod };
}

// ====================== 主请求分发入口 ======================
export async function dispatch(req: Request, env: Env): Promise<Response> {
    // 包裹一层请求日志
  return withRequestLogger(req, env, async () => {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method as HttpMethod;
  const search = url.searchParams;

  // 全局限流校验
 //const globalLimitResp = await rateLimitCheck(req, null, env);
 // if (globalLimitResp) return globalLimitResp;

  // 路由匹配
  const { matched, pathParam, hasOtherMethod } = matchRoute(path, method);
  if (!matched) {
    if (hasOtherMethod) return jsonResp(null, CODE.METHOD_NOT_ALLOWED, "请求方法不支持");
    return jsonResp(null, CODE.NOT_FOUND, "接口不存在");
  }

  // 解析请求体
  let body: unknown;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    body = await parseRequestBody(req);
  }

  // 公开路由直接执行
  if (matched.isPublic) {
    return await matched.handler(env, null, body, search, pathParam);
  }

  // JWT鉴权中间件
  const { error, payload } = await authMiddleware(req, env);
  if (error) return error;
  if (!payload) return jsonResp(null, CODE.UNAUTH, "身份验证失败，请重新登录");

  // 管理员权限校验
  if (matched.requireAdmin && payload.role !== "admin") {
    return jsonResp(null, CODE.FORBIDDEN, "权限不足，仅管理员可执行该操作");
  }

  // 用户维度限流
 // const userLimitResp = await rateLimitCheck(req, payload.uid, env);
 // if (userLimitResp) return userLimitResp;

  // 执行控制器
  return await matched.handler(env, payload, body, search, pathParam);
 });
}