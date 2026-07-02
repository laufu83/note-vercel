import { Resend } from 'resend'
import type { Env } from "../types/env";

// 发送注册激活邮件
export async function sendActivateEmail(env: Env, to: string, activateUrl: string) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('邮件服务配置缺失：RESEND_API_KEY 或 EMAIL_FROM 未配置');
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [to],
    subject: '请激活你的账号',
    html: `
      <div style="padding:24px;max-width:600px;margin:0 auto;font-family:system-ui">
        <h2>账号注册激活</h2>
        <p>点击下方链接激活账号，激活后即可登录系统：</p>
        <a href="${activateUrl}" style="display:inline-block;padding:12px 24px;background:#409EFF;color:#fff;border-radius:6px;text-decoration:none">立即激活账号</a>
        <p style="margin-top:20px;color:#666">链接24小时内有效，过期请重新注册。</p>
      </div>
    `
  })
  if (error) throw new Error(error.message)
}

export async function sendChangeEmail(env: Env, to: string, activateUrl: string) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('邮件服务配置缺失：RESEND_API_KEY 或 EMAIL_FROM 未配置');
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [to],
    subject: '立即激活新邮箱',
    html: `
  <div class="container">
    <div class="title">请确认绑定您的新邮箱</div>
    <div class="content">
      <p>您好：</p>
      <p>我们收到了您在【智慧笔记】账号下的<strong>更换绑定邮箱</strong>申请，请点击下方按钮完成新邮箱激活，激活后您的账号绑定邮箱将更新为此邮箱。</p>
      <p>本次激活链接有效期为 <strong>24 小时</strong>，超时需要重新提交邮箱修改申请。</p>
    </div>
    <a href="${activateUrl}" class="btn">立即激活新邮箱</a>
    <div class="tip">
      <p>如果您本人没有操作本次邮箱更换，请忽略本邮件，您的账号安全不会受到影响。</p>
      <p>请勿将激活链接转发给他人，避免账号信息泄露。</p>
      <p>© 2026 智慧笔记</p>
    </div>
  </div>
    `
  })
  if (error) throw new Error(error.message)
}

export async function sendResetPasswordEmail(env: Env, to: string, resetUrl: string) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('邮件服务配置缺失：RESEND_API_KEY 或 EMAIL_FROM 未配置');
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [to],
    subject: "智慧笔记 - 密码重置请求",
    html: `
    <div style="padding:32px;max-width:600px;margin:0 auto;font-family:system-ui">
      <h2>密码重置通知</h2>
      <p>收到您的密码重置申请，该链接 <strong>15 分钟内有效</strong>，过期需要重新申请。</p>
      <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#409EFF;color:#fff;border-radius:6px;text-decoration:none;margin:20px 0">立即重置密码</a>
      <p style="color:#888;font-size:13px;">若不是您本人操作，请忽略该邮件，账号不会被修改。</p>
    </div>
    `
  });
  if (error) throw new Error(`重置邮件发送失败：${error.message}`);
}