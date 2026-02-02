import Link from 'next/link';
import { BookOpen, Bell, Download, Search, CheckCircle, ArrowRight, Zap, Globe, Database } from 'lucide-react';

export default function WelcomePage() {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            {/* Navbar */}
            <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-blue-700">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-md shadow-blue-200">
                            <BookOpen className="w-5 h-5 text-white" />
                        </div>
                        <span>JournalMonitor</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/auth/sign-in" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
                            登录
                        </Link>
                        <Link href="/auth/sign-up">
                            <button className="h-9 px-5 py-2 bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center justify-center rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md">
                                免费注册
                            </button>
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="pt-24 pb-32 overflow-hidden relative">
                {/* Background Decorative Elements */}
                <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                    <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob"></div>
                    <div className="absolute top-[10%] left-[-10%] w-[500px] h-[500px] bg-purple-100 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000"></div>
                </div>

                <div className="container mx-auto px-4 text-center relative z-10">
                    <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 mb-8 shadow-sm">
                        <span className="flex h-2 w-2 rounded-full bg-blue-500 mr-2 animate-pulse"></span>
                        自动同步 CrossRef 最新数据
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 text-slate-900 leading-[1.15]">
                        科研路上的<br />
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">最佳文献助手</span>
                    </h1>

                    <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
                        专为研究人员打造。一站式追踪 ABS、FT50、UTD24 顶级期刊，
                        第一时间获取最新发表动态，让文献调研不再繁琐。
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link href="/auth/sign-up">
                            <button className="h-14 px-8 text-lg bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30 inline-flex items-center justify-center rounded-full font-semibold transition-all hover:scale-105">
                                立即开始使用 <ArrowRight className="ml-2 w-5 h-5" />
                            </button>
                        </Link>
                        <Link href="#features">
                            <button className="h-14 px-8 text-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm inline-flex items-center justify-center rounded-full font-medium transition-all">
                                了解更多
                            </button>
                        </Link>
                    </div>

                    {/* Feature Highlight Pill */}
                    <div className="mt-16 inline-flex items-center gap-8 py-4 px-8 bg-white/60 backdrop-blur-md rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <span className="font-semibold text-slate-700">1,800+ 期刊</span>
                        </div>
                        <div className="w-px h-6 bg-slate-300"></div>
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <span className="font-semibold text-slate-700">每日更新</span>
                        </div>
                        <div className="w-px h-6 bg-slate-300"></div>
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <span className="font-semibold text-slate-700">Zotero 支持</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section id="features" className="py-24 bg-white">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-16 max-w-2xl mx-auto">
                        <h2 className="text-3xl font-bold text-slate-900 mb-4">为什么选择 JournalMonitor？</h2>
                        <p className="text-lg text-slate-600">我们解决了文献抓取的痛点，让您专注于阅读与思考。</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        <FeatureCard
                            icon={<Search className="w-6 h-6 text-blue-600" />}
                            title="权威期刊索引"
                            description="内置 ABS 2024、FT50、UTD24 等权威列表。无需手动收集期刊主页，一键关注整个领域的顶级刊物。"
                        />
                        <FeatureCard
                            icon={<Bell className="w-6 h-6 text-indigo-600" />}
                            title="每日智能推送"
                            description="基于 Serverless 的云端定时任务，每日自动拉取最新发表文章，并通过邮件摘要准时发送给您。"
                        />
                        <FeatureCard
                            icon={<Download className="w-6 h-6 text-emerald-600" />}
                            title="无缝导出引用"
                            description="支持导出标准 RIS 格式文件，完美兼容 Zotero、EndNote 等文献管理软件，引文管理一步到位。"
                        />
                    </div>
                </div>
            </section>

            {/* Architecture/How it works */}
            <section className="py-24 bg-slate-50 border-t border-slate-200">
                <div className="container mx-auto px-4">
                    <div className="flex flex-col md:flex-row items-center gap-16 max-w-6xl mx-auto">
                        <div className="flex-1">
                            <h2 className="text-3xl font-bold text-slate-900 mb-6">不只是简单的网页</h2>
                            <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                                JournalMonitor 运行在高性能云端架构上，为您提供稳定可靠的服务。
                            </p>
                            <div className="space-y-6">
                                <TechItem
                                    icon={<Zap className="w-5 h-5 text-amber-500" />}
                                    title="云端 Serverless 运行"
                                    desc="即使您关闭电脑，云端服务也会按时为您自动抓取数据。"
                                />
                                <TechItem
                                    icon={<Database className="w-5 h-5 text-blue-500" />}
                                    title="Neon PostgreSQL 数据库"
                                    desc="企业级云数据库，确保存储数万条文献数据依然流畅快速。"
                                />
                                <TechItem
                                    icon={<Globe className="w-5 h-5 text-purple-500" />}
                                    title="Crossref 官方源"
                                    desc="直接对接出版商官方数据源，确保信息准确无误、更新及时。"
                                />
                            </div>
                        </div>
                        <div className="flex-1 bg-white p-8 rounded-2xl shadow-xl border border-slate-100 relative">
                            {/* Abstract Visual Representation of the Sync Process */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                                    <span className="font-semibold text-slate-700">16:00 PM</span>
                                    <span className="text-sm bg-green-100 text-green-700 px-2 py-1 rounded">System Trigger</span>
                                </div>
                                <div className="flex justify-center"><ArrowRight className="w-5 h-5 text-slate-400 rotate-90" /></div>
                                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-100">
                                    <span className="font-semibold text-blue-700">Sync with Crossref</span>
                                    <span className="text-xs text-blue-600">Scanning 1,800+ Journals...</span>
                                </div>
                                <div className="flex justify-center"><ArrowRight className="w-5 h-5 text-slate-400 rotate-90" /></div>
                                <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                                    <span className="font-semibold text-indigo-700">Email Notification</span>
                                    <span className="text-xs text-indigo-600">Sent to your inbox</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Bottom */}
            <section className="py-24 relative overflow-hidden bg-blue-600">
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-20"></div>
                <div className="container mx-auto px-4 text-center relative z-10">
                    <h2 className="text-4xl font-bold text-white mb-6">准备好提升研究效率了吗？</h2>
                    <p className="text-xl text-blue-100 mb-10 max-w-2xl mx-auto">完全免费开源。加入 JournalMonitor，把时间花在阅读而不是寻找上。</p>
                    <Link href="/auth/sign-up">
                        <button className="h-14 px-10 text-lg bg-white text-blue-600 hover:bg-blue-50 shadow-xl inline-flex items-center justify-center rounded-full font-bold transition-all hover:scale-105">
                            立即免费注册
                        </button>
                    </Link>
                </div>
            </section>

            <footer className="py-8 bg-slate-50 border-t border-slate-200 text-center text-slate-500 text-sm">
                <p>© 2026 Journal Monitor. Designed for Academics.</p>
            </footer>
        </div>
    );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
    return (
        <div className="p-8 rounded-2xl bg-white border border-slate-100 hover:border-blue-200 hover:shadow-lg transition-all group">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-6 group-hover:bg-blue-600 group-hover:text-white transition-colors text-blue-600">
                {icon}
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-3">{title}</h3>
            <p className="text-slate-600 leading-relaxed">{description}</p>
        </div>
    );
}

function TechItem({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
    return (
        <div className="flex gap-4 items-start">
            <div className="mt-1 p-2 bg-slate-50 rounded-lg border border-slate-100 shadow-sm">{icon}</div>
            <div>
                <h4 className="font-bold text-slate-900">{title}</h4>
                <p className="text-sm text-slate-500 mt-1">{desc}</p>
            </div>
        </div>
    );
}
