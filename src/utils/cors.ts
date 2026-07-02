export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Content-Type": "application/json;charset=utf-8",
};

/**
 * 处理 OPTIONS 预检请求跨域
 */
export function handleOptionsCors(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}