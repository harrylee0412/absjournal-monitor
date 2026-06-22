# Journal Monitor

基于 Next.js、Prisma、Neon Postgres 和 Neon Auth 的个人学术期刊监控工具。

核心链路：

- 用户最多关注 30 本期刊。
- 系统按全局关注期刊从 CrossRef 每日抓取新文章，并分发给关注用户。
- 用户可以在已关注期刊内创建话题订阅，按关键词匹配论文。
- Vercel 只负责入队；Docker Worker 负责抓取、匹配、翻译和发信。
- 每周自动生成话题摘要，可用用户 LLM 或百度翻译生成中文内容。
- 保留邮件推送、RIS 导出、Zotero 同步和外部 API。

## Local Setup

```bash
cp .env.example .env
npm install
npm run db:generate
npm run dev
```

打开 <http://localhost:3000>。

数据库迁移：

```bash
npx prisma migrate deploy
```

本地跑一次 worker：

```bash
npm run worker:once
```

常驻 worker：

```bash
npm run worker
```

## Environment Variables

必需：

- `DATABASE_URL`
- `DIRECT_URL`

推荐：

- `CROSSREF_CONTACT_EMAIL`
- `CRON_SECRET`
- `ENCRYPTION_SECRET`
- `WORKER_CONCURRENCY`
- `CROSSREF_CONCURRENCY`
- `CROSSREF_MIN_INTERVAL_MS`
- `JOB_LOCK_TTL_SECONDS`
- `JOB_MAX_ATTEMPTS`

翻译 fallback：

- `BAIDU_TRANSLATE_APP_ID`
- `BAIDU_TRANSLATE_SECRET`

不要把真实 API key 写进代码、README、测试快照或提交历史。用户 LLM key 会使用 `ENCRYPTION_SECRET` 加密保存。

## Main Routes

- `/`：研究监控 Dashboard。
- `/papers`：每日文章 Feed，支持搜索、未读筛选、话题筛选、RIS 导出和手动抓取。
- `/topics`：话题订阅列表。
- `/topics/new`：创建话题订阅。话题范围固定为当前已关注期刊。
- `/journals`：关注/取消关注期刊，最多 30 本。
- `/reports`：话题周报历史。
- `/settings`：每日更新时间、SMTP、LLM 翻译、Zotero。

## Cron

`vercel.json` 配置了两个任务：

- `/api/cron/check-updates`：每日创建全局期刊抓取任务。
- `/api/cron/weekly-summaries`：每周一创建话题摘要任务。

如果设置了 `CRON_SECRET`，调用方需要发送：

```text
Authorization: Bearer <CRON_SECRET>
```

Cron route 不再执行重任务，只写入 `Job` 表。真正执行由 worker 完成。

## Background Worker

第一版 worker 使用 Neon `Job` 表作为轻量队列，不依赖 Redis。

任务类型：

- `USER_CHECK_UPDATE`：用户手动抓取。API 立即返回 `jobId`，前端轮询 `/api/jobs/:id`。
- `DAILY_JOURNAL_FETCH`：每日全局期刊抓取。同一期刊只抓一次，再分发给所有关注用户。
- `WEEKLY_TOPIC_SUMMARY`：生成每周话题周报，并创建邮件发送任务。
- `EMAIL_DELIVERY`：发送普通订阅邮件或话题周报邮件。

Worker 部署：

```bash
docker compose -f docker-compose.worker.yml up -d --build
```

推荐服务器起步配置：

- 2 vCPU
- 4GB RAM
- 40GB SSD

接近 1000 活跃用户或翻译任务明显增加时，升级到 4 vCPU / 8GB RAM。

## Topic Subscriptions

第一版话题订阅不单独选择期刊范围。所有话题都运行在用户当前关注的期刊集合上，因此不会扩大 CrossRef 抓取范围，也不会绕过 30 本期刊上限。

话题匹配逻辑：

- 匹配字段：标题、作者、摘要。
- 关键词支持换行、英文逗号、中文逗号、分号分隔。
- 保存新文章后会写入 `TopicArticleMatch`。
- 创建或更新话题时会对用户已有文章做一次轻量 backfill。

每周摘要逻辑：

- 来源为最近 7 天的 `TopicArticleMatch`。
- 翻译优先级：用户 LLM、百度翻译、原文。
- 邮件发送复用用户当前 SMTP 设置和 `targetEmail`，通过 `EMAIL_DELIVERY` 后台任务异步完成。

## CrossRef Fetching

- 所有请求带 `mailto` 参数和 `User-Agent`，进入 CrossRef polite pool。
- 首次抓取默认最近 30 天。
- 增量抓取基于 `JournalFetchState.lastFetchedAt` 向前重叠 2 天，降低漏抓风险。
- 请求 `rows=100`，按 `created desc` 排序。
- DOI 全局唯一，重复文章不会重复写入 `Article`。
- 同一期刊每天由 worker 全局抓一次，再分发给关注该期刊的用户。

## Data Import

AJG / ABS 期刊数据导入脚本：

```bash
npx tsx scripts/import-journals.ts
```

脚本默认读取项目上级目录的 `AJG2024.xlsx`。如部署环境不同，请按实际路径调整脚本或导入流程。
