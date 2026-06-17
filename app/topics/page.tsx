'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import axios from 'axios';

type Topic = {
    id: number;
    name: string;
    keywords: string[];
    enabled: boolean;
    translateMode: string;
    deliveryEnabled: boolean;
    createdAt: string;
    _count?: {
        matches: number;
        summaryRuns: number;
    };
    summaryRuns?: {
        id: number;
        createdAt: string;
        paperCount: number;
        status: string;
    }[];
};

export default function TopicsPage() {
    const [topics, setTopics] = useState<Topic[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get('/api/topics')
            .then(res => setTopics(res.data.data || []))
            .catch(() => setTopics([]))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="space-y-6">
            <header className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
                <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Saved Topics</p>
                    <h1 className="font-serif text-4xl font-semibold text-ink">话题订阅</h1>
                    <p className="mt-1 text-sage">在已关注期刊内追踪具体研究话题，并生成每周摘要。</p>
                </div>
                <Link className="btn" href="/topics/new">新建话题</Link>
            </header>

            <section className="panel overflow-hidden p-5">
                <div className="overflow-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>名称</th>
                                <th>关键词</th>
                                <th>命中</th>
                                <th>翻译</th>
                                <th>推送</th>
                                <th>最近周报</th>
                                <th>状态</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={7}>Loading...</td></tr>
                            ) : topics.length === 0 ? (
                                <tr><td colSpan={7}>暂无话题订阅。</td></tr>
                            ) : topics.map(topic => (
                                <tr key={topic.id}>
                                    <td>
                                        <Link className="font-semibold text-oxford" href={`/topics/${topic.id}`}>{topic.name}</Link>
                                        <div className="mt-1 text-xs text-sage">{topic.createdAt.slice(0, 10)} 创建</div>
                                    </td>
                                    <td>
                                        <div className="flex flex-wrap gap-1">
                                            {topic.keywords.map(keyword => <span className="tag" key={keyword}>{keyword}</span>)}
                                        </div>
                                    </td>
                                    <td>{topic._count?.matches ?? 0}</td>
                                    <td>{topic.translateMode}</td>
                                    <td>{topic.deliveryEnabled ? 'ON' : 'OFF'}</td>
                                    <td>
                                        {topic.summaryRuns?.[0]
                                            ? `${topic.summaryRuns[0].createdAt.slice(0, 10)} · ${topic.summaryRuns[0].paperCount} 篇`
                                            : '尚未运行'}
                                    </td>
                                    <td><span className="tag">{topic.enabled ? 'ON' : 'OFF'}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
