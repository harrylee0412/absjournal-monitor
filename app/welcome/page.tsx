import type { ReactNode } from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    Bell,
    BookOpen,
    CalendarClock,
    Database,
    Download,
    FileText,
    KeyRound,
    Languages,
    List,
    Mail,
    Rss,
    Search,
    Settings,
} from 'lucide-react';

const modules = [
    {
        icon: BookOpen,
        title: '每日论文',
        description: '每天从 CrossRef 抓取你关注期刊的新文章，支持搜索、未读筛选、RIS 导出。',
    },
    {
        icon: Rss,
        title: '话题订阅',
        description: '在已关注的 30 本以内期刊中，用关键词追踪具体研究主题和命中文章。',
    },
    {
        icon: FileText,
        title: '每周周报',
        description: '默认每周一 08:00 UTC（北京时间 16:00）生成话题摘要，并记录发送状态。',
    },
    {
        icon: List,
        title: '关注期刊',
        description: '用 ABS、FT50、UTD24 等标签筛选期刊，第一版保持最多关注 30 本。',
    },
    {
        icon: Settings,
        title: '账户设置',
        description: '配置接收邮箱、Zotero、LLM API；用户密钥在服务端加密保存。',
    },
    {
        icon: Download,
        title: '文献流转',
        description: '从论文列表导出 RIS，或连接 Zotero，把监控结果接入现有阅读流程。',
    },
];

const workflow = [
    {
        step: '01',
        title: '选择关注期刊',
        body: '从 ABS / FT50 / UTD24 列表里筛选，关注最多 30 本真正需要每日监控的期刊。',
    },
    {
        step: '02',
        title: '每日抓取新论文',
        body: '系统按你的关注范围从 CrossRef 获取新文章，保留标题、作者、DOI、期刊标签。',
    },
    {
        step: '03',
        title: '匹配话题关键词',
        body: '话题订阅只在已关注期刊内生效，避免扩大抓取范围，也降低误报和成本。',
    },
    {
        step: '04',
        title: '周一生成摘要',
        body: '每周一汇总过去 7 天命中文章，可用用户 LLM 或百度翻译生成中文摘要。',
    },
];

export default function WelcomePage() {
    return (
        <div className="min-h-screen bg-paper text-ink">
            <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
                    <Link href="/welcome" className="min-w-0">
                        <div className="font-serif text-2xl font-semibold">Journal Monitor</div>
                        <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-sage">
                            每日论文 · 每周话题
                        </div>
                    </Link>
                    <nav className="hidden items-center gap-5 text-sm font-semibold text-sage md:flex">
                        <Link className="hover:text-oxford" href="#workflow">工作流</Link>
                        <Link className="hover:text-oxford" href="#modules">功能模块</Link>
                        <Link className="hover:text-oxford" href="#integrations">集成</Link>
                    </nav>
                    <div className="flex shrink-0 items-center gap-2">
                        <Link className="btn secondary" href="/auth/sign-in">登录</Link>
                        <Link className="btn" href="/auth/sign-up">开始使用</Link>
                    </div>
                </div>
            </header>

            <main>
                <section className="mx-auto grid max-w-7xl gap-8 px-5 py-12 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:py-16">
                    <div>
                        <div className="mb-5 flex flex-wrap gap-2">
                            <span className="tag">个人研究者版</span>
                            <span className="tag">30 本期刊上限</span>
                            <span className="tag">周一话题摘要</span>
                        </div>
                        <h1 className="font-serif text-5xl font-semibold leading-tight text-ink md:text-6xl">
                            Journal Monitor
                        </h1>
                        <p className="mt-5 max-w-2xl text-lg leading-8 text-sage">
                            一个面向个人研究者的期刊监控工作台：先关注核心期刊，每天查看新论文；
                            再用话题订阅追踪具体研究问题，每周一收到结构化摘要。
                        </p>
                        <div className="mt-7 flex flex-wrap gap-3">
                            <Link className="btn" href="/auth/sign-up">
                                创建账号 <ArrowRight className="h-4 w-4" />
                            </Link>
                            <Link className="btn secondary" href="/auth/sign-in">已有账号登录</Link>
                        </div>
                        <div className="mt-8 grid gap-3 sm:grid-cols-3">
                            <Stat label="期刊范围" value="30 本内" />
                            <Stat label="论文来源" value="CrossRef" />
                            <Stat label="周报时间" value="周一 16:00" />
                        </div>
                    </div>

                    <ProductPreview />
                </section>

                <section id="workflow" className="border-y border-line bg-card/70">
                    <div className="mx-auto max-w-7xl px-5 py-12">
                        <SectionHeader
                            eyebrow="Workflow"
                            title="先缩小期刊范围，再追踪具体话题"
                            description="第一版不会为每个话题单独扩大抓取池。话题订阅只作用于你当前关注的期刊，主功能仍然是每日更新关注期刊的新文章。"
                        />
                        <div className="mt-8 grid gap-4 lg:grid-cols-4">
                            {workflow.map(item => (
                                <article className="panel p-5" key={item.step}>
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-oxford">{item.step}</div>
                                    <h3 className="mt-4 font-serif text-2xl font-semibold">{item.title}</h3>
                                    <p className="mt-3 text-sm leading-6 text-sage">{item.body}</p>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="modules" className="mx-auto max-w-7xl px-5 py-12">
                    <SectionHeader
                        eyebrow="Modules"
                        title="登录后的信息结构"
                        description="页面不是简单列表，而是围绕研究监控拆成六个稳定模块：概览、论文、话题、期刊、周报、设置。"
                    />
                    <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {modules.map(item => {
                            const Icon = item.icon;
                            return (
                                <article className="panel p-5" key={item.title}>
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white">
                                            <Icon className="h-5 w-5 text-oxford" />
                                        </div>
                                        <div>
                                            <h3 className="font-serif text-xl font-semibold">{item.title}</h3>
                                            <p className="mt-2 text-sm leading-6 text-sage">{item.description}</p>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>

                <section id="integrations" className="border-y border-line bg-card/70">
                    <div className="mx-auto grid max-w-7xl gap-6 px-5 py-12 lg:grid-cols-[0.92fr_1.08fr]">
                        <div>
                            <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Integrations</p>
                            <h2 className="font-serif text-4xl font-semibold">把摘要送到你的研究流程里</h2>
                            <p className="mt-4 max-w-2xl leading-7 text-sage">
                                系统保留轻量个人 SaaS 方向：不做团队空间和机构版，重点解决个人研究者的自动抓取、话题命中、摘要翻译和文献管理。
                            </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Integration icon={<Mail className="h-5 w-5" />} title="邮件推送" body="平台统一邮箱发送每日/每周结果；用户只需要填写接收邮箱。" />
                            <Integration icon={<Languages className="h-5 w-5" />} title="摘要翻译" body="优先使用用户 LLM；失败后可降级到百度翻译；也可以选择不翻译。" />
                            <Integration icon={<KeyRound className="h-5 w-5" />} title="密钥保护" body="LLM API key 使用 ENCRYPTION_SECRET 加密保存，不写入代码和日志。" />
                            <Integration icon={<Database className="h-5 w-5" />} title="Neon 数据库" body="用户、期刊关注、话题命中、周报记录统一存储在 PostgreSQL。" />
                        </div>
                    </div>
                </section>

                <section className="mx-auto max-w-7xl px-5 py-12">
                    <div className="panel grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-oxford">Start</p>
                            <h2 className="mt-2 font-serif text-3xl font-semibold">从关注 20-30 本核心期刊开始</h2>
                            <p className="mt-3 max-w-3xl leading-7 text-sage">
                                先把每日论文流跑稳，再逐步增加话题订阅、LLM 摘要和 Zotero 流转。这样不会影响现有主功能，也便于后续接入 Vercel cron。
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link className="btn secondary" href="/auth/sign-in">登录</Link>
                            <Link className="btn" href="/auth/sign-up">创建账号</Link>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="border-t border-line px-5 py-8 text-center text-sm text-sage">
                Journal Monitor · Designed for personal academic monitoring
            </footer>
        </div>
    );
}

function ProductPreview() {
    return (
        <div className="panel overflow-hidden">
            <div className="border-b border-line bg-ink px-5 py-4 text-white">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <div className="font-serif text-xl font-semibold">研究概览</div>
                        <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-white/55">Dashboard Preview</div>
                    </div>
                    <span className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-white/70">周一 16:00 周报</span>
                </div>
            </div>
            <div className="grid gap-5 p-5">
                <div className="grid gap-3 sm:grid-cols-4">
                    <PreviewMetric label="本周新增" value="18" />
                    <PreviewMetric label="待处理" value="7" />
                    <PreviewMetric label="话题命中" value="4" />
                    <PreviewMetric label="关注期刊" value="20/30" />
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-lg border border-line bg-white/70 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="font-serif text-xl font-semibold">最近论文</h3>
                            <Search className="h-4 w-4 text-sage" />
                        </div>
                        <PreviewPaper
                            journal="Management Science"
                            tags={['ABS 4*', 'FT50', 'AI']}
                            title="Generative AI Models as Wicked Resources"
                        />
                        <PreviewPaper
                            journal="Research Policy"
                            tags={['ABS 4*', 'Topic Match']}
                            title="AI in science: When and where it makes a difference"
                        />
                        <PreviewPaper
                            journal="Strategic Management Journal"
                            tags={['ABS 4*', 'UTD24']}
                            title="Human-AI collaboration and organizational design"
                        />
                    </div>

                    <div className="rounded-lg border border-line bg-white/70 p-4">
                        <h3 className="font-serif text-xl font-semibold">话题订阅</h3>
                        <div className="mt-4 grid gap-3 text-sm">
                            <PreviewRow icon={<Rss className="h-4 w-4" />} label="AI" value="4 篇命中" />
                            <PreviewRow icon={<Bell className="h-4 w-4" />} label="每周邮件" value="已开启" />
                            <PreviewRow icon={<CalendarClock className="h-4 w-4" />} label="生成时间" value="周一 16:00" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
    return (
        <div className="max-w-3xl">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">{eyebrow}</p>
            <h2 className="font-serif text-4xl font-semibold">{title}</h2>
            <p className="mt-4 leading-7 text-sage">{description}</p>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-line bg-white/70 px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-sage">{label}</div>
            <div className="mt-1 font-serif text-2xl font-semibold text-ink">{value}</div>
        </div>
    );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-line bg-paper px-3 py-3">
            <div className="text-xs font-bold text-sage">{label}</div>
            <div className="mt-1 font-serif text-2xl font-semibold">{value}</div>
        </div>
    );
}

function PreviewPaper({ journal, tags, title }: { journal: string; tags: string[]; title: string }) {
    return (
        <div className="border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
            <div className="flex flex-wrap gap-1">
                <span className="tag">{journal}</span>
                {tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}
            </div>
            <div className="mt-2 text-sm font-semibold text-ink">{title}</div>
        </div>
    );
}

function PreviewRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 font-semibold text-ink">
                <span className="text-oxford">{icon}</span>
                {label}
            </div>
            <span className="text-sage">{value}</span>
        </div>
    );
}

function Integration({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
    return (
        <article className="rounded-lg border border-line bg-white/70 p-4">
            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-paper text-oxford">
                    {icon}
                </div>
                <div>
                    <h3 className="font-serif text-xl font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-sage">{body}</p>
                </div>
            </div>
        </article>
    );
}
