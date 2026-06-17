import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PrismaClient } from '@prisma/client';
import { subDays } from 'date-fns';
import { auth } from '@/lib/auth/server';

const prisma = new PrismaClient();

export default async function DashboardPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect('/welcome');

  const userId = session.user.id;
  const weekStart = subDays(new Date(), 7);

  const [
    followedCount,
    unreadCount,
    recentUserArticles,
    activeTopics,
    recentMatches,
    settings,
    recentRuns,
    recentArticles
  ] = await Promise.all([
    prisma.userJournalFollow.count({ where: { userId } }),
    prisma.userArticle.count({ where: { userId, isRead: false } }),
    prisma.userArticle.count({ where: { userId, createdAt: { gte: weekStart } } }),
    prisma.topicSubscription.count({ where: { userId, enabled: true } }),
    prisma.topicArticleMatch.count({ where: { userId, createdAt: { gte: weekStart } } }),
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.topicSummaryRun.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { topic: true }
    }),
    prisma.userArticle.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: {
        article: {
          include: {
            journal: true,
            topicMatches: {
              where: { userId },
              include: { topic: { select: { id: true, name: true } } }
            }
          }
        }
      }
    })
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Research Monitor</p>
          <h1 className="font-serif text-4xl font-semibold text-ink">研究监控概览</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn secondary" href="/papers">查看论文</Link>
          <Link className="btn" href="/topics/new">新建话题</Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <Metric label="本周新增" value={recentUserArticles} />
        <Metric label="待处理论文" value={unreadCount} />
        <Metric label="话题命中" value={recentMatches} />
        <Metric label="活跃话题" value={activeTopics} />
        <Metric label="关注期刊" value={`${followedCount}/30`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <section className="panel p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-serif text-2xl font-semibold">最近论文</h2>
              <Link className="btn secondary" href="/papers">进入 Papers</Link>
            </div>
            <div className="grid gap-3">
              {recentArticles.length === 0 ? (
                <p className="text-sm text-sage">暂无论文。先关注期刊，然后运行每日更新。</p>
              ) : (
                recentArticles.map(item => (
                  <article key={item.id} className="rounded-lg border border-line bg-white/70 p-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="tag">{item.article.journal.title}</span>
                      {item.article.journal.ajgRanking ? <span className="tag">ABS {item.article.journal.ajgRanking}</span> : null}
                      {item.article.topicMatches.map(match => <span className="tag" key={match.id}>{match.topic.name}</span>)}
                    </div>
                    <a className="mt-2 block font-semibold text-oxford" href={item.article.url || `https://doi.org/${item.article.doi}`} target="_blank" rel="noreferrer">
                      {item.article.title}
                    </a>
                    <p className="mt-1 line-clamp-2 text-sm text-sage">{item.article.authors || 'Unknown authors'}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="panel p-5">
            <h2 className="font-serif text-2xl font-semibold">运行状态</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="rounded-lg border border-line bg-white/70 p-3">
                <div className="label">最近每日抓取</div>
                <div className="mt-1 font-semibold text-ink">
                  {settings?.lastCheckTime ? settings.lastCheckTime.toISOString().slice(0, 10) : '尚未完成'}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-white/70 p-3">
                <div className="label">邮件推送</div>
                <div className="mt-1 font-semibold text-ink">{settings?.emailEnabled ? '已启用' : '未启用'}</div>
              </div>
            </div>
          </section>

          <section className="panel p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-serif text-2xl font-semibold">最近周报</h2>
              <Link className="btn secondary" href="/reports">全部</Link>
            </div>
            <div className="grid gap-3">
              {recentRuns.length === 0 ? (
                <p className="text-sm text-sage">暂无周报运行记录。</p>
              ) : (
                recentRuns.map(run => (
                  <Link key={run.id} href={`/reports/${run.id}`} className="rounded-lg border border-line bg-white/70 p-3">
                    <div className="font-semibold text-ink">{run.topic.name}</div>
                    <div className="mt-1 text-sm text-sage">
                      {run.createdAt.toISOString().slice(0, 10)} · {run.paperCount} 篇 · {run.status}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-sage">{label}</div>
      <div className="mt-1 font-serif text-3xl font-semibold text-ink">{value}</div>
    </div>
  );
}
