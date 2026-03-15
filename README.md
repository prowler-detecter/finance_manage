# 财务与库存系统（React + Vite + Fastify + PostgreSQL）

这是从原 `localStorage` 版本重做的工程骨架，使用：

- 前端：React + Vite + JSX
- 后端：Node.js + Fastify
- ORM：Prisma
- 数据库：PostgreSQL（Docker）

## 目录结构

```text
apps/
  web/   # React 前端
  api/   # Fastify 后端 + Prisma
infra/
  docker-compose.prod.yml
  nginx/default.conf
docker-compose.yml        # 本地数据库
```

## 1. 环境准备

1. 安装 Node.js 22+
2. 安装 Docker Desktop
3. 根目录复制环境变量：

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
```

## 2. 安装依赖

```bash
npm install
```

## 3. 启动数据库（Docker）

```bash
npm run db:up
```

## 4. 初始化数据库

```bash
npm run db:migrate
npm run db:seed
```

默认会创建管理员账号：

- 用户名：`admin`
- 密码：`admin123456`

请在首次登录后自行修改（当前版本未提供修改密码页面，可通过数据库更新）。

## 5. 本地开发

```bash
npm run dev
```

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`
- 健康检查：`http://localhost:3001/health`

## 6. 生产部署（Docker Compose 单机）

在服务器准备好 `.env` 后执行：

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```

然后在 `api` 容器中执行 Prisma 迁移与种子（首次部署）：

```bash
docker compose -f infra/docker-compose.prod.yml exec api npx prisma migrate deploy
docker compose -f infra/docker-compose.prod.yml exec api node prisma/seed.js
```

## 7. 当前已实现 API（首版）

- `POST /auth/login`
- `GET /auth/me`
- `GET/POST /partners`
- `GET/POST /products`
- `PATCH /products/:id/active`
- `GET/POST /transactions`
- `GET /inventory/overview`
- `POST /stock-adjustments`

## 8. 说明

- 采用“交易日期 + 记账日期 + 录入时间”模型。
- 库存按“业务日期 + 同日录入先后”计算。
- 单据号支持乱序，重复仅警告确认，不做硬拦截。
- 当前版本选择“空库起步”，不自动迁移旧 localStorage 数据。
