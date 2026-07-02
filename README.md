Note 云笔记系统部署文档
项目介绍
本项目基于 Cloudflare Worker + PostgreSQL(Neon) + Upstash Redis + Supabase 技术栈开发，前后端分离云笔记系统，支持：
用户登录注册、Markdown 笔记编辑、分类标签管理、回收站、历史版本回滚、笔记公开分享、图片上传、批量导出全部笔记、接口限流、JWT 权限校验、定时清理过期回收站数据。
技术栈
后端（note-pg-redis-worker）
运行环境：Cloudflare Worker
语言：TypeScript
数据库：Neon PostgreSQL
缓存限流：Upstash Redis
对象存储：Supabase Storage
鉴权：JWT
加密：bcryptjs
定时任务：Wrangler Cron 定时触发器
前端（note-front）
框架：Vue3 + Vite + TypeScript
UI：Element Plus
状态管理：Pinia
路由：Vue Router4
Markdown 编辑器：Vditor
HTTP 请求：Axios
一、后端部署步骤
1. 环境准备
1.1 安装依赖工具
安装 Node.js 18+ 版本
全局安装 wrangler（可选，也可本地 npx 调用）
bash
运行
npm install -g wrangler
1.2 登录 Cloudflare
bash
运行
wrangler login
会自动跳转浏览器授权登录你的 Cloudflare 账号。
2. 后端项目初始化配置
2.1 安装依赖
进入 note-pg-redis-worker 文件夹执行：
bash
运行
npm install
2.2 本地环境变量配置
项目根目录新建 .dev.vars，填入如下配置：
env
# 数据库连接地址（Neon PostgreSQL）
DATABASE_URL="postgresql://用户名:密码@xxx.neon.tech:5432/数据库名?sslmode=require"

# Upstash Redis 配置
REDIS_URL="https://xxx.upstash.io"
REDIS_TOKEN="你的Redis Token"

# Supabase 配置
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_KEY="Supabase服务密钥"

# JWT 密钥（高强度随机字符串，请勿泄露）
JWT_ACCESS_SECRET="9sK7pR2tG5bN8dQ4vX1zF6cM3jL0aW5h"
JWT_REFRESH_SECRET="B2gT7nD4sP9mR6kF1cV5zX8jL3dQ0wH7"

# Token 过期时间
ACCESS_TOKEN_EXPIRE="1h"
REFRESH_TOKEN_EXPIRE="30d"

# 密码加密加盐次数
BCRYPT_SALT_ROUND="10"

# 接口限流配置
# 单个IP每分钟最大请求次数
RATE_LIMIT_IP_MAX="80"
# 单个用户每分钟最大请求次数
RATE_LIMIT_USER_MAX="200"
# 限流时间窗口：秒
RATE_LIMIT_WINDOW_SEC="60"
2.3 wrangler.toml 配置说明
toml
name = "note-pg-redis-worker"
main = "src/index.ts"
compatibility_date = "2026-06-01"
workers_dev = true

# 定时任务：每天凌晨2点清理回收站过期笔记、过期刷新令牌
[
triggers
]
crons = [ "0 2 * * *" ]
注意：本地变量统一放在 .dev.vars，不要在 wrangler.toml 中填写 [vars] 明文密钥。
3. 数据库初始化（Neon PostgreSQL）
3.1 执行建表 SQL
登录 Neon 控制台，打开 SQL 编辑器，执行以下建表语句：
sql
-- 用户表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100),
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 刷新令牌表
CREATE TABLE user_refresh_token (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token VARCHAR(255) NOT NULL,
    expired_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 分类表
CREATE TABLE note_category (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    sort INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- 标签表
CREATE TABLE note_tag (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- 笔记主表
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    is_draft BOOLEAN DEFAULT FALSE,
    is_top BOOLEAN DEFAULT FALSE,
    is_star BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    delete_expired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    note_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED
);

-- 笔记-分类关联表
CREATE TABLE note_category_rel (
    note_id INT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    category_id INT NOT NULL REFERENCES note_category(id) ON DELETE CASCADE,
    PRIMARY KEY(note_id, category_id)
);

-- 笔记-标签关联表
CREATE TABLE note_tag_rel (
    note_id INT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id INT NOT NULL REFERENCES note_tag(id) ON DELETE CASCADE,
    PRIMARY KEY(note_id, tag_id)
);

-- 笔记历史版本表
CREATE TABLE note_history (
    id SERIAL PRIMARY KEY,
    note_id INT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title VARCHAR(200),
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 文件资源表
CREATE TABLE user_file (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(200),
    mime_type VARCHAR(100),
    size BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 笔记分享表
CREATE TABLE note_share (
    id SERIAL PRIMARY KEY,
    note_id INT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    share_code VARCHAR(16) NOT NULL UNIQUE,
    access_password VARCHAR(50),
    permission VARCHAR(20) NOT NULL DEFAULT 'read',
    expire_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
4. Supabase 配置
进入 Supabase 控制台 → Storage → 创建存储桶 note-upload
打开存储桶权限设置，将桶设置为 公开（Public），否则前端无法访问图片。
5. 本地调试后端
bash
运行
npx wrangler dev
启动成功后，默认地址：http://127.0.0.1:8787
6. 线上部署 Worker
6.1 逐个配置线上环境变量
本地 .dev.vars 仅用于调试，线上需要手动配置密钥：
bash
运行
wrangler secret put DATABASE_URL
wrangler secret put REDIS_URL
wrangler secret put REDIS_TOKEN
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put JWT_ACCESS_SECRET
wrangler secret put JWT_REFRESH_SECRET
wrangler secret put ACCESS_TOKEN_EXPIRE
wrangler secret put REFRESH_TOKEN_EXPIRE
wrangler secret put BCRYPT_SALT_ROUND
wrangler secret put RATE_LIMIT_IP_MAX
wrangler secret put RATE_LIMIT_USER_MAX
wrangler secret put RATE_LIMIT_WINDOW_SEC
每条命令执行后粘贴对应值回车。
6.2 部署上线
bash
运行
npx wrangler deploy
部署完成会返回 Worker 线上访问地址，例如：xxx.workers.dev，前端需要配置该地址作为接口根路径。
二、前端部署步骤
1. 安装依赖
进入 note-front 目录：
bash
运行
npm install
2. 环境变量配置
修改 .env.development：
env
# 后端Worker线上地址
VITE_API_BASE_URL=https://xxx.workers.dev
# Supabase地址
VITE_SUPABASE_URL=https://xxx.supabase.co
3. 本地开发调试
bash
运行
npm run dev
4. 打包构建
bash
运行
npm run build
打包产物输出在 dist 文件夹。
5. 前端部署（推荐 Cloudflare Pages）
登录 Cloudflare Pages → 创建项目
选择上传静态资源，直接上传 dist 文件夹内所有文件
绑定自定义域名即可访问前端笔记系统。
三、项目接口说明
1. 用户模块
POST /api/user/register 用户注册
POST /api/user/login 用户登录
POST /api/user/refresh-token 刷新 JWT 令牌
POST /api/user/change-pwd 修改密码
DELETE /api/user/destroy 永久注销账号
2. 分类模块
POST /api/category 新增分类
GET /api/category 获取分类列表
PUT /api/category/{id} 编辑分类
DELETE /api/category/{id} 删除分类
3. 标签模块
POST /api/tag 新增标签
GET /api/tag 获取标签列表
DELETE /api/tag/{id} 删除标签
4. 笔记模块
POST /api/note 新建笔记
GET /api/note 笔记列表（支持搜索、草稿、星标、回收站筛选）
GET /api/note/{id} 笔记详情
PUT /api/note/{id} 编辑笔记（自动保存历史版本）
DELETE /api/note/{id} 移入回收站
PUT /api/note/{id}/restore 恢复笔记
DELETE /api/note/{id}/destroy 永久删除笔记
GET /api/note/{id}/history 获取笔记所有历史版本
POST /api/note/rollback 笔记版本回滚
5. 文件上传模块
POST /api/file/upload 图片上传
GET /api/file 获取用户上传文件列表
POST /api/file/delete 删除文件
6. 笔记分享模块
POST /api/share/create 创建笔记公开分享
GET /api/share/{code} 公开笔记访问（支持密码校验）
GET /api/share/list 我的分享列表
DELETE /api/share/{id} 销毁分享链接
四、常见问题排查
Redis 方法报错 zremrangebyscore 不存在
原因：Upstash Redis SDK 方法全小写，不可使用驼峰写法。
bcryptjs 类型缺失报错
执行：npm install --save-dev @types/bcryptjs
wrangler4 定时任务配置报错
必须使用 [triggers] + crons = ["0 2 * * *"] 数组格式，不能嵌套 [triggers.crons]。
图片无法访问
Supabase 存储桶未开启公开权限，需要在 Storage 安全设置中开启公开读取。
401 Token 失效
JWT 密钥前后环境必须一致
刷新令牌过期会自动跳转登录页
接口请求被限流 429
短时间请求过于频繁，等待 1 分钟后重试，可在环境变量调整限流阈值。
五、安全建议
.dev.vars、.env 禁止提交 Git，已配置 .gitignore 忽略；
JWT 密钥使用高强度随机字符串，定期轮换；
Supabase Service Key、数据库密码、Redis Token 禁止明文泄露；
线上关闭 PostgreSQL 外网弱密码访问，开启 SSL 强制连接；
不要随意放大接口限流阈值，防止恶意 CC 攻击。