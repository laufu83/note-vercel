// src/utils/note-encrypt.ts
import crypto from 'node:crypto';

/**
 * 笔记安全加密工具
 *
 * 核心设计：
 * 1. 密码哈希：PBKDF2-SHA256 100000次迭代
 * 2. 正文加密：AES-256-GCM
 * 3. 盐复用：哈希和加密共用同一个16字节盐
 * 4. 常量时间比较：防御时序攻击
 * 5. 分片Base64：防止大文件栈溢出
 */

type PasswordHashResult = {
  salt: string;
  hash: string;
};

type EncryptResult = {
  cipherText: string;
  salt: string;
  iv: string;
};

type EncryptWithHashResult = EncryptResult & {
  hash: string;
};

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;
const HASH_ALG = 'sha256' as const;
const CHUNK_SIZE = 8192;

const ERRORS = {
  INVALID_SALT: 'INVALID_SALT',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
} as const;

export class NoteEncryptionService {
  private generateSalt(): Uint8Array {
    return crypto.randomBytes(SALT_BYTE_LENGTH);
  }

  private generateIV(): Uint8Array {
    return crypto.randomBytes(IV_BYTE_LENGTH);
  }

private bufferToBase64(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64');
}

private base64ToBuffer(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64');
}

  private isValidSalt(saltBase64: string): boolean {
    try {
      const salt = this.base64ToBuffer(saltBase64);
      return salt.byteLength === SALT_BYTE_LENGTH;
    } catch {
      return false;
    }
  }

  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * 新建加密笔记（一步完成）
   * 自动生成盐 → 生成密码哈希 → 加密正文
   */
  async encryptWithNewSalt(
    plainText: string,
    password: string
  ): Promise<EncryptWithHashResult> {
    const salt = this.generateSalt();
    const saltBase64 = this.bufferToBase64(salt);

    // PBKDF2 派生哈希
    const hashRaw = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
    const hashBase64 = this.bufferToBase64(hashRaw);

    // AES-GCM 加密
    const iv = this.generateIV();
    const keyRaw = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyRaw, iv);
    let encrypted = cipher.update(plainText, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    const cipherTextBuf = Buffer.concat([encrypted, authTag]);

    return {
      cipherText: this.bufferToBase64(cipherTextBuf),
      salt: saltBase64,
      iv: this.bufferToBase64(iv),
      hash: hashBase64
    };
  }

  /**
   * 复用盐加密（修改内容，密码不变）
   */
  async encryptWithExistingSalt(
    plainText: string,
    password: string,
    existingSaltBase64: string
  ): Promise<EncryptResult> {
    if (!this.isValidSalt(existingSaltBase64)) {
      throw new Error(ERRORS.INVALID_SALT);
    }

    const salt = this.base64ToBuffer(existingSaltBase64);
    const iv = this.generateIV();
    const keyRaw = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyRaw, iv);
    let encrypted = cipher.update(plainText, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    const cipherTextBuf = Buffer.concat([encrypted, authTag]);

    return {
      cipherText: this.bufferToBase64(cipherTextBuf),
      salt: existingSaltBase64,
      iv: this.bufferToBase64(iv)
    };
  }

  /**
   * 修改密码（重新加密 + 生成新哈希）
   */
  async changePassword(
    plainText: string,
    newPassword: string,
    existingSaltBase64: string
  ): Promise<EncryptWithHashResult> {
    if (!this.isValidSalt(existingSaltBase64)) {
      throw new Error(ERRORS.INVALID_SALT);
    }

    const salt = this.base64ToBuffer(existingSaltBase64);
    const saltBase64 = existingSaltBase64;

    // 新密码哈希
    const hashRaw = crypto.pbkdf2Sync(newPassword, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
    const hashBase64 = this.bufferToBase64(hashRaw);

    // 加密正文
    const iv = this.generateIV();
    const keyRaw = crypto.pbkdf2Sync(newPassword, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyRaw, iv);
    let encrypted = cipher.update(plainText, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    const cipherTextBuf = Buffer.concat([encrypted, authTag]);

    return {
      cipherText: this.bufferToBase64(cipherTextBuf),
      salt: saltBase64,
      iv: this.bufferToBase64(iv),
      hash: hashBase64
    };
  }

  /**
   * 解密笔记正文
   */
  async decrypt(
    cipherText: string,
    password: string,
    saltBase64: string,
    ivBase64: string
  ): Promise<string> {
    try {
      if (!this.isValidSalt(saltBase64)) {
        throw new Error(ERRORS.INVALID_SALT);
      }

      const salt = this.base64ToBuffer(saltBase64);
      const iv = this.base64ToBuffer(ivBase64);
      const encryptedBuf = this.base64ToBuffer(cipherText);
      // 最后16字节为 authTag
      const authTag = encryptedBuf.subarray(encryptedBuf.length - 16);
      const data = encryptedBuf.subarray(0, encryptedBuf.length - 16);

      const keyRaw = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyRaw, iv);
      decipher.setAuthTag(authTag);

      let plain = decipher.update(data);
      plain = Buffer.concat([plain, decipher.final()]);
      return plain.toString('utf8');
    } catch (err) {
      throw new Error(ERRORS.DECRYPT_FAILED);
    }
  }

  /**
   * 独立使用：生成密码哈希
   */
  async hashPassword(password: string): Promise<PasswordHashResult> {
    const salt = this.generateSalt();
    const hashRaw = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
    return {
      salt: this.bufferToBase64(salt),
      hash: this.bufferToBase64(hashRaw)
    };
  }

  /**
   * 验证密码（常量时间比较防时序攻击）
   */
  async verifyPassword(
    password: string,
    storedSaltBase64: string,
    storedHashBase64: string
  ): Promise<boolean> {
    try {
      if (!this.isValidSalt(storedSaltBase64)) return false;
      const salt = this.base64ToBuffer(storedSaltBase64);
      const calcHash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, HASH_ALG);
      const storedHash = this.base64ToBuffer(storedHashBase64);
      return this.constantTimeEqual(calcHash, storedHash);
    } catch {
      return false;
    }
  }

  /**
   * 密码格式校验：6位以上，必须同时包含字母+数字
   */
  validatePassword(password: string): { isValid: boolean; message: string } {
    if (!password || password.length < 6) {
      return { isValid: false, message: '密码至少6位' };
    }
    if (!/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
      return { isValid: false, message: '密码必须同时包含字母和数字' };
    }
    return { isValid: true, message: '' };
  }
}

export const noteEncryptService = new NoteEncryptionService();