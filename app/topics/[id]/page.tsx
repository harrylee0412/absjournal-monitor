'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';

type TopicDetail = {
    id: number;
    name: string;
    keywords: string[];
    enabled: boolean;
    translateMode: string;
    deliveryEnabled: boolean;
    matches: {
        id: number;
        matchedKeywords: string[];
        createdAt: string;
        article: {
            id: number;
            title: string;
            authors: string | null;
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
    summaryRuns: {
        id: number;
        createdAt: string;
        paperCount: number;
        status: string;
        deliveryStatus: string | null;
    }[];
};

export default function TopicDetailPage() {
    const params = useParams<{ id: string }>();
    const [topic, setTopic] = useState<TopicDetail | null>(null);
    const [topicId, setTopicId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [preview, setPreview] = useState('');

    useEffect(() => {
        setTopicId(Number.parseInt(params.id, 10));
    }, [params.id]);

    useEffect(() => {
        if (!topicId) return;
        axios.get(`/api/topics/${topicId}`)
            .then(res => setTopic(res.data.data))
            .finally(() => setLoading(false));
    }, [topicId]);

    async function save() {
        if (!topic) return;
        setSaving(true);
        setMessage('');
        try {
            const res = await axios.patch(`/api/topics/${topic.id}`, {
                name: topic.name,
                keywords: topic.keywords,
                enabled: topic.enabled,
                translateMode: topic.translateMode,
                deliveryEnabled: topic.deliveryEnabled
            });
            setTopic(prev => prev ? { ...prev, ...res.data.data } : prev);
            setMessage('已保存');
        } catch (error) {
            setMessage(axios.isAxiosError(error) ? error.response?.data?.error || '保存失败' : '保存失败');
        } finally {
            setSaving(false);
        }
    }

    async function previewSummary() {
        if (!topic) return;
        setPreview('生成中...');
        try {
            const res = await axios.post(`/api/topics/${topic.id}/preview`);
            setPreview(res.data.summaryMarkdown || '');
        } catch (error) {
            setPreview(axios.isAxiosError(error) ? error.response?.data?.error || '预览失败' : '预览失败');
        }
    }

    async function remove() {
        if (!topic || !confirm('确认删除这个话题订阅？')) return;
        await axios.delete(`/api/topics/${topic.id}`);
        window.location.href = '/topics';
    }

    if (loading) return <div className="panel p-5">加载中...</div>;
    if (!topic) return <div className="panel p-5">未找到话题。</div>;

    return (
        <div className="space-y-6">
            <header className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
                <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Topic Detail</p>
                    <h1 className="font-serif text-4xl font-semibold text-ink">{topic.name}</h1>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {topic.keywords.map(keyword => <span className="tag" key={keyword}>{keyword}</span>)}
                        <span className="tag">{topic.enabled ? '匹配已启用' : '匹配已暂停'}</span>
                        <span className="tag">{topic.deliveryEnabled ? '周报邮件已开启' : '周报邮件已关闭'}</span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link className="btn secondary" href={`/papers?topicId=${topic.id}`}>查看每日论文</Link>
                    <button className="btn secondary" type="button" onClick={previewSummary}>生成预览</button>
                </div>
            </header>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-6">
                    <section className="panel p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="font-serif text-2xl font-semibold">最近命中论文</h2>
                            <span className="tag">{topic.matches.length} 篇</span>
                        </div>
                        <div className="grid gap-3">
                            {topic.matches.length === 0 ? (
                                <p className="text-sm text-sage">暂无命中文章。新的每日抓取会继续按当前关键词匹配。</p>
                            ) : topic.matches.map(match => (
                                <article className="rounded-lg border border-line bg-white/70 p-4" key={match.id}>
                                    <div className="flex flex-wrap gap-1">
                                        <span className="tag">{match.article.journal.title}</span>
                                        {match.article.journal.ajgRanking ? <span className="tag">ABS {match.article.journal.ajgRanking}</span> : null}
                                        {match.matchedKeywords.map(keyword => <span className="tag" key={keyword}>{keyword}</span>)}
                                    </div>
                                    <a className="mt-2 block font-semibold text-oxford" href={match.article.url || `https://doi.org/${match.article.doi}`} target="_blank" rel="noreferrer">
                                        {match.article.title}
                                    </a>
                                    <p className="mt-1 text-sm text-sage">{match.article.authors || 'Unknown authors'}</p>
                                    <p className="mt-2 text-xs text-sage">命中时间：{match.createdAt.slice(0, 10)}</p>
                                </article>
                            ))}
                        </div>
                    </section>

                    <section className="panel p-5">
                        <h2 className="mb-4 font-serif text-2xl font-semibold">预览</h2>
                        {preview ? (
                            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 text-xs">{preview}</pre>
                        ) : (
                            <p className="text-sm text-sage">生成预览会读取最近 30 天的话题命中文章。</p>
                        )}
                    </section>
                </div>

                <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
                    <section className="panel grid gap-4 p-5">
                        <div>
                            <h2 className="font-serif text-2xl font-semibold">话题设置</h2>
                            <p className="mt-1 text-sm text-sage">修改名称、关键词、翻译和推送配置。</p>
                        </div>
                        <label className="grid gap-2">
                            <span className="label">名称</span>
                            <input className="input" value={topic.name} onChange={e => setTopic({ ...topic, name: e.target.value })} />
                        </label>
                        <label className="grid gap-2">
                            <span className="label">关键词</span>
                            <textarea
                                className="input min-h-28"
                                value={topic.keywords.join('\n')}
                                onChange={e => setTopic({ ...topic, keywords: e.target.value.split(/\n|,|，/).map(item => item.trim()).filter(Boolean) })}
                            />
                            <span className="text-xs text-sage">英文短词按完整词匹配，例如 AI 不会命中 quality。</span>
                        </label>
                        <label className="grid gap-2">
                            <span className="label">翻译</span>
                            <select className="input" value={topic.translateMode} onChange={e => setTopic({ ...topic, translateMode: e.target.value })}>
                                <option value="llm">用户 LLM，失败后百度</option>
                                <option value="baidu">百度翻译</option>
                                <option value="none">不翻译</option>
                            </select>
                        </label>
                        <div className="grid gap-2">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={topic.enabled} onChange={e => setTopic({ ...topic, enabled: e.target.checked })} />
                                启用话题匹配
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={topic.deliveryEnabled} onChange={e => setTopic({ ...topic, deliveryEnabled: e.target.checked })} />
                                每周邮件推送
                            </label>
                        </div>
                        {message ? <p className="text-sm font-semibold text-oxford">{message}</p> : null}
                        <div className="flex justify-end gap-2">
                            <button className="btn secondary" disabled={saving} type="button" onClick={save}>{saving ? '保存中...' : '保存设置'}</button>
                            <button className="btn danger" type="button" onClick={remove}>删除</button>
                        </div>
                    </section>

                    <section className="panel p-5">
                        <h2 className="mb-4 font-serif text-2xl font-semibold">历史周报</h2>
                        <p className="mb-4 text-sm leading-6 text-sage">默认每周一 08:00 UTC（北京时间 16:00）生成。</p>
                        <div className="grid gap-2">
                            {topic.summaryRuns.length === 0 ? (
                                <p className="text-sm text-sage">暂无周报。</p>
                            ) : topic.summaryRuns.map(run => (
                                <Link className="rounded-lg border border-line bg-white/70 p-3" href={`/reports/${run.id}`} key={run.id}>
                                    <div className="font-semibold text-ink">{run.createdAt.slice(0, 10)} · {run.paperCount} 篇</div>
                                    <div className="mt-1 text-sm text-sage">{run.status} · {run.deliveryStatus || 'SKIPPED'}</div>
                                </Link>
                            ))}
                        </div>
                    </section>
                </aside>
            </section>
        </div>
    );
}
