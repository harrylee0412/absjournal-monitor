'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, BookOpen, FileText, List, Rss, Settings } from 'lucide-react';
import { UserButton } from '@neondatabase/auth/react';

const navItems = [
    { href: '/', label: '研究概览', description: '新增、待读、运行状态', icon: BarChart3 },
    { href: '/papers', label: '每日论文', description: '查看抓取结果和导出 RIS', icon: BookOpen },
    { href: '/topics', label: '话题订阅', description: '关键词追踪和命中记录', icon: Rss },
    { href: '/journals', label: '关注期刊', description: '管理 30 本以内期刊', icon: List },
    { href: '/reports', label: '每周周报', description: '周一摘要和发送记录', icon: FileText },
    { href: '/settings', label: '账户设置', description: '邮箱、LLM、Zotero 配置', icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isPublic = pathname?.startsWith('/welcome') || pathname?.startsWith('/auth') || pathname?.startsWith('/account');

    if (isPublic) {
        return <main className="min-h-screen bg-background">{children}</main>;
    }

    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[284px_1fr]">
            <aside className="border-b border-line bg-ink px-5 py-5 text-white lg:min-h-screen lg:border-b-0 lg:border-r">
                <Link href="/" className="block">
                    <div className="font-serif text-2xl font-semibold">Journal Monitor</div>
                    <div className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                        每日论文 · 每周话题
                    </div>
                </Link>
                <nav className="mt-7 grid gap-1">
                    {navItems.map(item => {
                        const Icon = item.icon;
                        const isActive = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`shell-link ${isActive ? 'shell-link-active' : ''}`}
                            >
                                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                                <span className="min-w-0">
                                    <span className="shell-link-title">{item.label}</span>
                                    <span className="shell-link-desc">{item.description}</span>
                                </span>
                            </Link>
                        );
                    })}
                </nav>
                <div className="mt-8 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="font-semibold text-white">个人研究者版</div>
                    <p className="mt-1 leading-6">
                        每日抓取你关注的期刊；话题周报默认每周一 08:00 UTC（北京时间 16:00）生成。
                    </p>
                </div>
            </aside>
            <div className="min-w-0">
                <header className="sticky top-0 z-20 border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <form action="/papers" className="flex min-w-0 flex-1 gap-2">
                            <input className="input min-w-0" name="q" placeholder="搜索论文、关键词、期刊、作者" />
                            <button className="btn secondary shrink-0" type="submit">搜索</button>
                        </form>
                        <div className="flex items-center gap-2">
                            <Link className="btn" href="/topics/new">新建话题订阅</Link>
                            <UserButton />
                        </div>
                    </div>
                </header>
                <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
            </div>
        </div>
    );
}
