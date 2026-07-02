import { corsHeaders } from "./cors";
import { CODE, Resp, CodeType } from "../types/response";

export function jsonResp<T>(
  data?: T,
  code: CodeType = CODE.SUCCESS,
  msg: string = "ok",
  status = 200
): Response {
  const body: Resp<T> = { code, msg, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}