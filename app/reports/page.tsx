'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import axios from 'axios';

type Report = {
    id: number;
    createdAt: string;
    windowStart: string;
    windowEnd: string;
    status: string;
    paperCount: number;
    deliveryStatus: string | null;
    topic: {
        id: number;
        name: string;
    };
};

export default function ReportsPage() {
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get('/api/reports')
            .then(res => setReports(res.data.data || []))
            .catch(() => setReports([]))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="space-y-6">
            <header className="border-b border-line pb-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Weekly Reports</p>
                <h1 className="font-serif text-4xl font-semibold text-ink">周报历史</h1>
                <p className="mt-1 text-sage">每周话题摘要和邮件发送记录。</p>
            </header>

            <section className="panel overflow-hidden p-5">
                <div className="overflow-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>话题</th>
                                <th>周期</th>
                                <th>论文数</th>
                                <th>状态</th>
                                <th>推送</th>
                                <th>创建时间</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6}>Loading...</td></tr>
                            ) : reports.length === 0 ? (
                                <tr><td colSpan={6}>暂无周报。</td></tr>
                            ) : reports.map(report => (
                                <tr key={report.id}>
                                    <td><Link className="font-semibold text-oxford" href={`/reports/${report.id}`}>{report.topic.name}</Link></td>
                                    <td>{report.windowStart.slice(0, 10)} - {report.windowEnd.slice(0, 10)}</td>
                                    <td>{report.paperCount}</td>
                                    <td><span className="tag">{report.status}</span></td>
                                    <td>{report.deliveryStatus || 'SKIPPED'}</td>
                                    <td>{report.createdAt.slice(0, 10)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
