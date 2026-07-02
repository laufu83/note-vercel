import type { Env } from "../types/env";

/**
 * 格式化当前时间
 */
function formatTime(): string {
  const now = new Date();
  return now.toLocaleString("zh-CN", {
    hour12: false,
  });
}

/**
 * 获取客户端真实IP
 */
function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  return realIp || "unknown";
}

/**
 * 截断长字符串，避免日志刷屏
 */
function truncateStr(str: unknown, maxLen = 300): string {
  if (!str) return "";
  const s = typeof str === "string" ? str : JSON.stringify(str);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + `...[已截断，总长度${s.length}]`;
}

/**
 * 请求日志包装器
 * @param req 请求对象
 * @param env 环境变量
 * @param handler 原路由处理函数
 * @returns 包装后的Response
 */
export async function withRequestLogger(
  req: Request,
  env: Env,
  handler: () => Promise<Response>
): Promise<Response> {

// 日志开关：环境变量为 0 / false 时关闭，其余默认开启
  const enableLog = env.ENABLE_LOG === "true";

  // 关闭日志时直接执行业务，不做日志解析
  if (!enableLog) {
    return await handler();
  }

  const startTime = performance.now();
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;
  const ip = getClientIp(req);

  // 复制请求用于读取body，避免原请求body被消费
  const reqClone = req.clone();
  let requestBody: unknown;
  try {
    if (["POST", "PUT", "PATCH"].includes(method)) {
      const contentType = reqClone.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        requestBody = await reqClone.json();
      } else if (contentType.includes("x-www-form-urlencoded")) {
        requestBody = await reqClone.text();
      } else if (contentType.includes("multipart/form-data")) {
        requestBody = "[FormData 文件上传，不打印表单内容]";
      } else {
        requestBody = await reqClone.text();
      }
    }
  } catch {
    requestBody = "解析请求体失败";
  }

  let response: Response;
  try {
    response = await handler();
  } catch (err) {
    console.error(`[${formatTime()}] [${method}] ${path} 异常`, err);
    throw err;
  }

  // 读取响应返回内容
  const resClone = response.clone();
  let resBody: unknown = "";
  try {
    const resText = await resClone.text();
    resBody = truncateStr(resText);
  } catch {
    resBody = "响应内容解析失败";
  }

  const cost = (performance.now() - startTime).toFixed(2);
  const status = response.status;

  // 彩色日志：2xx正常绿色，4xx黄色，5xx红色
  const color =
    status >= 500
      ? "\x1b[31m"
      : status >= 400
      ? "\x1b[33m"
      : "\x1b[32m";
  const reset = "\x1b[0m";

  console.log(
    `${color}[${formatTime()}] [${method}] ${path} | IP:${ip} | 状态:${status} | 耗时:${cost}ms${reset}`
  );
  if (requestBody) {
    console.log("  请求体:", truncateStr(requestBody));
  }
  console.log("  响应内容:", resBody);
  console.log("-".repeat(100));

  return response;
}