'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';

type ReportDetail = {
    id: number;
    createdAt: string;
    windowStart: string;
    windowEnd: string;
    status: string;
    summaryMarkdown: string | null;
    paperCount: number;
    deliveryStatus: string | null;
    deliveryError: string | null;
    topic: {
        id: number;
        name: string;
    };
    articles: {
        id: number;
        matchedKeywords: string[];
        translatedTitle: string | null;
        translatedAbstract: string | null;
        article: {
            id: number;
            title: string;
            authors: string | null;
            abstract: string | null;
            doi: string;
            url: string | null;
            journal: {
                title: string;
                ajgRanking: string | null;
                isFt50: boolean;
                isUtd24: boolean;
            };
        };
    }[];
};

export default function ReportDetailPage() {
    const params = useParams<{ id: string }>();
    const [report, setReport] = useState<ReportDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get(`/api/reports/${params.id}`)
            .then(res => setReport(res.data.data))
            .finally(() => setLoading(false));
    }, [params.id]);

    if (loading) return <div className="panel p-5">Loading...</div>;
    if (!report) return <div className="panel p-5">Report not found.</div>;

    return (
        <div className="space-y-6">
            <header className="border-b border-line pb-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Report Detail</p>
                <h1 className="font-serif text-4xl font-semibold text-ink">{report.topic.name}</h1>
                <p className="mt-1 text-sage">
                    {report.windowStart.slice(0, 10)} - {report.windowEnd.slice(0, 10)} · {report.paperCount} 篇 · {report.status}
                </p>
            </header>

            <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
                <div className="space-y-4">
                    {report.articles.length === 0 ? (
                        <section className="panel p-5 text-sm text-sage">本期无匹配论文。</section>
                    ) : report.articles.map(item => (
                        <article className="panel p-5" key={item.id}>
                            <div className="mb-2 flex flex-wrap gap-1">
                                <span className="tag">{item.article.journal.title}</span>
                                {item.article.journal.ajgRanking ? <span className="tag">ABS {item.article.journal.ajgRanking}</span> : null}
                                {item.article.journal.isFt50 ? <span className="tag">FT50</span> : null}
                                {item.article.journal.isUtd24 ? <span className="tag">UTD24</span> : null}
                                {item.matchedKeywords.map(keyword => <span className="tag" key={keyword}>{keyword}</span>)}
                            </div>
                            <h2 className="font-serif text-2xl font-semibold text-ink">{item.translatedTitle || item.article.title}</h2>
                            <p className="mt-1 text-sm text-sage">Original: {item.article.title}</p>
                            <p className="mt-2 text-sm text-sage">{item.article.authors || 'Unknown authors'}</p>
                            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink">
                                {item.translatedAbstract || item.article.abstract || 'No abstract available.'}
                            </p>
                            <a className="mt-4 inline-flex text-sm font-semibold text-oxford" href={item.article.url || `https://doi.org/${item.article.doi}`} target="_blank" rel="noreferrer">
                                打开论文
                            </a>
                        </article>
                    ))}
                </div>

                <aside className="space-y-6">
                    <section className="panel p-5">
                        <h2 className="font-serif text-2xl font-semibold">发送记录</h2>
                        <div className="mt-4 grid gap-2 text-sm">
                            <div><span className="font-semibold">状态：</span>{report.deliveryStatus || 'SKIPPED'}</div>
                            {report.deliveryError ? <div className="text-red-700">{report.deliveryError}</div> : null}
                        </div>
                    </section>
                    <section className="panel p-5">
                        <h2 className="mb-3 font-serif text-2xl font-semibold">Markdown</h2>
                        <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 text-xs">
                            {report.summaryMarkdown || ''}
                        </pre>
                    </section>
                </aside>
            </section>
        </div>
    );
}
