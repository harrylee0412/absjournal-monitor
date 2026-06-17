# Journal Monitor

基于 Next.js、Prisma、Neon Postgres 和 Neon Auth 的个人学术期刊监控工具。

核心链路：

- 用户最多关注 30 本期刊。
- 系统按关注期刊从 CrossRef 每日抓取新文章。
- 用户可以在已关注期刊内创建话题订阅，按关键词匹配论文。
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

## Environment Variables

必需：

- `DATABASE_URL`
- `DIRECT_URL`

推荐：

- `CROSSREF_CONTACT_EMAIL`
- `CRON_SECRET`
- `ENCRYPTION_SECRET`

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

- `/api/cron/check-updates`：每日抓取关注期刊文章。
- `/api/cron/weekly-summaries`：每周一生成话题摘要。

如果设置了 `CRON_SECRET`，调用方需要发送：

```text
Authorization: Bearer <CRON_SECRET>
```

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
- 邮件发送复用用户当前 SMTP 设置和 `targetEmail`。

## Data Import

AJG / ABS 期刊数据导入脚本：

```bash
npx tsx scripts/import-journals.ts
```

脚本默认读取项目上级目录的 `AJG2024.xlsx`。如部署环境不同，请按实际路径调整脚本或导入流程。
