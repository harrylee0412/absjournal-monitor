'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

type Journal = {
    id: number;
    title: string;
    printIssn: string | null;
    eIssn: string | null;
    ajgRanking: string | null;
    isFt50: boolean;
    isUtd24: boolean;
};

export default function NewTopicPage() {
    const [name, setName] = useState('');
    const [keywords, setKeywords] = useState('');
    const [translateMode, setTranslateMode] = useState('llm');
    const [deliveryEnabled, setDeliveryEnabled] = useState(true);
    const [journals, setJournals] = useState<Journal[]>([]);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        axios.get('/api/journals', { params: { isFollowed: 'true', limit: 100 } })
            .then(res => setJournals(res.data || []))
            .catch(() => setJournals([]));
    }, []);

    async function submit() {
        setSaving(true);
        setMessage('');
        try {
            const res = await axios.post('/api/topics', {
                name,
                keywords,
                translateMode,
                deliveryEnabled
            });
            window.location.href = `/topics/${res.data.data.id}`;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                setMessage(error.response?.data?.error || '保存失败');
            } else {
                setMessage('保存失败');
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-6">
            <header className="border-b border-line pb-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Topic Setup</p>
                <h1 className="font-serif text-4xl font-semibold text-ink">新建话题订阅</h1>
                <p className="mt-1 text-sage">
                    第一版话题订阅作用于当前已关注的期刊；系统默认每周一 08:00 UTC（北京时间 16:00）生成周报。
                </p>
            </header>

            <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
                <div className="panel grid gap-5 p-5">
                    <label className="grid gap-2">
                        <span className="label">话题名称</span>
                        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="AI agents in management journals" />
                    </label>
                    <label className="grid gap-2">
                        <span className="label">关键词</span>
                        <textarea
                            className="input min-h-36"
                            value={keywords}
                            onChange={e => setKeywords(e.target.value)}
                            placeholder="AI agents, RAG, digital transformation"
                        />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-2">
                            <span className="label">翻译方式</span>
                            <select className="input" value={translateMode} onChange={e => setTranslateMode(e.target.value)}>
                                <option value="llm">用户 LLM，失败后百度</option>
                                <option value="baidu">百度翻译</option>
                                <option value="none">不翻译</option>
                            </select>
                        </label>
                        <label className="grid gap-2">
                            <span className="label">每周邮件推送</span>
                            <select className="input" value={deliveryEnabled ? 'on' : 'off'} onChange={e => setDeliveryEnabled(e.target.value === 'on')}>
                                <option value="on">开启</option>
                                <option value="off">关闭</option>
                            </select>
                        </label>
                    </div>
                    {message ? <p className="text-sm font-semibold text-red-700">{message}</p> : null}
                    <div className="flex justify-end gap-2">
                        <button className="btn secondary" type="button" onClick={() => window.location.href = '/topics'}>取消</button>
                        <button className="btn" disabled={saving || !name || !keywords} type="button" onClick={submit}>
                            {saving ? '保存中...' : '保存话题'}
                        </button>
                    </div>
                </div>

                <aside className="panel p-5">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="font-serif text-2xl font-semibold">期刊范围</h2>
                        <span className="tag">{journals.length}/30</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-sage">
                        该话题会在你当前关注的期刊中新文章里匹配关键词。需要调整期刊范围时，请到关注期刊页面关注或取消关注。
                    </p>
                    <div className="mt-4 max-h-[460px] overflow-auto">
                        {journals.length === 0 ? (
                            <p className="text-sm text-sage">还没有关注期刊。</p>
                        ) : (
                            <div className="grid gap-2">
                                {journals.map(journal => (
                                    <div className="rounded-lg border border-line bg-white/70 p-3" key={journal.id}>
                                        <div className="text-sm font-semibold text-ink">{journal.title}</div>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            <span className="tag">{journal.printIssn || journal.eIssn || 'No ISSN'}</span>
                                            {journal.ajgRanking ? <span className="tag">ABS {journal.ajgRanking}</span> : null}
                                            {journal.isFt50 ? <span className="tag">FT50</span> : null}
                                            {journal.isUtd24 ? <span className="tag">UTD24</span> : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </aside>
            </section>
        </div>
    );
}
