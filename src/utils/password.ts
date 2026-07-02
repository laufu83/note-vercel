import bcrypt from "bcryptjs";

/**
 * 密码加密哈希
 * @param raw 原始明文密码
 * @param saltRound 加盐迭代次数
 * @returns bcrypt哈希字符串
 */
export async function hashPassword(raw: string, saltRound: number): Promise<string> {
  return bcrypt.hash(raw, saltRound);
}

/**
 * 密码比对校验
 * @param raw 原始明文密码
 * @param hash 数据库存储的加密哈希
 * @returns 密码是否匹配
 */
export async function comparePassword(raw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(raw, hash);
}