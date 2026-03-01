'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Clock, Copy, Check, RefreshCw, Wifi, BookOpen } from 'lucide-react';

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [emailEnabled, setEmailEnabled] = useState(false);
    const [targetEmail, setTargetEmail] = useState('');
    const [preferredHour, setPreferredHour] = useState(0);

    // SMTP Fields
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState('587');
    const [smtpUser, setSmtpUser] = useState('');
    const [smtpPass, setSmtpPass] = useState('');
    const [fromEmail, setFromEmail] = useState('');

    // Zotero plugin fields
    const [userId, setUserId] = useState('');
    const [cronApiKey, setCronApiKey] = useState('');
    const [copied, setCopied] = useState('');

    // Zotero Web API fields
    const [zoteroUserId, setZoteroUserId] = useState('');
    const [zoteroApiKey, setZoteroApiKey] = useState('');
    const [zoteroTestResult, setZoteroTestResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [zoteroTesting, setZoteroTesting] = useState(false);
    const [zoteroSyncing, setZoteroSyncing] = useState(false);
    const [zoteroSyncResult, setZoteroSyncResult] = useState<string | null>(null);

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopied(field);
        setTimeout(() => setCopied(''), 2000);
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await axios.get('/api/settings');
            const data = res.data;
            if (data) {
                setUserId(data.userId || '');
                setCronApiKey(data.cronApiKey || '');
                setZoteroUserId(data.zoteroUserId || '');
                setZoteroApiKey(data.zoteroApiKey || '');
                setEmailEnabled(data.emailEnabled || false);
                setTargetEmail(data.targetEmail || '');
                setPreferredHour(data.preferredHour ?? 0);
                if (data.smtpConfig) {
                    try {
                        const config: any = JSON.parse(data.smtpConfig);
                        setSmtpHost(config.host || '');
                        setSmtpPort(config.port || '587');
                        setSmtpUser(config.auth?.user || '');
                        setSmtpPass(config.auth?.pass || '');
                        setFromEmail(config.from || '');
                    } catch (e) {
                        console.error("Error parsing SMTP config", e);
                    }
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const saveSettings = async () => {
        const smtpConfig = JSON.stringify({
            host: smtpHost,
            port: parseInt(smtpPort),
            auth: {
                user: smtpUser,
                pass: smtpPass
            },
            from: fromEmail
        });

        try {
            await axios.post('/api/settings', {
                emailEnabled,
                targetEmail,
                smtpConfig,
                preferredHour,
                zoteroUserId: zoteroUserId || undefined,
                zoteroApiKey: zoteroApiKey || undefined,
            });
            alert('Settings saved!');
        } catch (e) {
            alert('Failed to save settings');
        }
    };

    // Generate hour options with Beijing time display
    const hourOptions = Array.from({ length: 24 }, (_, i) => {
        const beijingHour = (i + 8) % 24;
        return {
            value: i,
            label: `${String(beijingHour).padStart(2, '0')}:00 Beijing (${String(i).padStart(2, '0')}:00 UTC)`
        };
    });

    if (loading) return <div>Loading...</div>;

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
                <p className="text-muted-foreground mt-1">Configure email notifications and update schedule.</p>
            </div>

            <div className="bg-white shadow sm:rounded-lg p-6 space-y-6">
                {/* Daily Update Time */}
                <div>
                    <h3 className="text-lg font-medium leading-6 text-gray-900 mb-2 flex items-center gap-2">
                        <Clock className="w-5 h-5" />
                        Daily Update Schedule
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                        Choose when you'd like to receive daily article updates. Our server will check for new articles at this time every day.
                    </p>
                    <select
                        value={preferredHour}
                        onChange={e => setPreferredHour(parseInt(e.target.value))}
                        className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm rounded-md bg-white text-black border"
                    >
                        {hourOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center justify-between border-t border-gray-200 pt-6">
                    <span className="flex-grow flex flex-col">
                        <span className="text-sm font-medium text-gray-900">Enable Email Notifications</span>
                        <span className="text-sm text-gray-500">Receive daily digests of new articles at your scheduled time.</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => setEmailEnabled(!emailEnabled)}
                        className={`${emailEnabled ? 'bg-primary' : 'bg-gray-200'
                            } relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary`}
                        role="switch"
                        aria-checked={emailEnabled}
                    >
                        <span
                            aria-hidden="true"
                            className={`${emailEnabled ? 'translate-x-5' : 'translate-x-0'
                                } pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200`}
                        />
                    </button>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Target Email</label>
                    <input
                        type="email"
                        value={targetEmail}
                        onChange={e => setTargetEmail(e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                        placeholder="you@example.com"
                    />
                </div>

                <div className="border-t border-gray-200 pt-6">
                    <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">SMTP Configuration</h3>
                    <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                        <div className="sm:col-span-4">
                            <label className="block text-sm font-medium text-gray-700">SMTP Host</label>
                            <input
                                type="text"
                                value={smtpHost}
                                onChange={e => setSmtpHost(e.target.value)}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                                placeholder="smtp.gmail.com"
                            />
                        </div>

                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Port</label>
                            <input
                                type="number"
                                value={smtpPort}
                                onChange={e => setSmtpPort(e.target.value)}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                            />
                        </div>

                        <div className="sm:col-span-3">
                            <label className="block text-sm font-medium text-gray-700">Username</label>
                            <input
                                type="text"
                                value={smtpUser}
                                onChange={e => setSmtpUser(e.target.value)}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                            />
                        </div>

                        <div className="sm:col-span-3">
                            <label className="block text-sm font-medium text-gray-700">Password</label>
                            <input
                                type="password"
                                value={smtpPass}
                                onChange={e => setSmtpPass(e.target.value)}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                            />
                        </div>
                        <div className="sm:col-span-6">
                            <label className="block text-sm font-medium text-gray-700">From Email</label>
                            <input
                                type="text"
                                value={fromEmail}
                                onChange={e => setFromEmail(e.target.value)}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={saveSettings}
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                        <Save className="mr-2 h-4 w-4" />
                        Save Settings
                    </button>
                </div>
            </div>

            {/* Zotero Sync Section */}
            <div className="bg-white shadow sm:rounded-lg p-6 space-y-4">
                <div>
                    <h3 className="text-lg font-medium leading-6 text-gray-900 mb-1 flex items-center gap-2">
                        <BookOpen className="w-5 h-5" />
                        Zotero Sync
                    </h3>
                    <p className="text-sm text-gray-500">
                        通过 Zotero Web API 将关注的期刊文章同步到你的 Zotero 云端库。
                        请前往 <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">zotero.org/settings/keys</a> 获取 User ID 和创建 API Key（需要读写权限）。
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Zotero User ID</label>
                    <input
                        type="text"
                        value={zoteroUserId}
                        onChange={e => setZoteroUserId(e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                        placeholder="例如: 12345678"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Zotero API Key</label>
                    <input
                        type="password"
                        value={zoteroApiKey}
                        onChange={e => setZoteroApiKey(e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                        placeholder="以字母数字组成的 API Key"
                    />
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={async () => {
                            setZoteroTesting(true);
                            setZoteroTestResult(null);
                            try {
                                // Save credentials first
                                const smtpConfig = JSON.stringify({
                                    host: smtpHost, port: parseInt(smtpPort),
                                    auth: { user: smtpUser, pass: smtpPass }, from: fromEmail
                                });
                                await axios.post('/api/settings', {
                                    emailEnabled, targetEmail, smtpConfig, preferredHour,
                                    zoteroUserId: zoteroUserId || undefined,
                                    zoteroApiKey: zoteroApiKey || undefined,
                                });
                                const res = await axios.post('/api/zotero/test');
                                setZoteroTestResult(res.data);
                            } catch (e: any) {
                                setZoteroTestResult({ ok: false, message: e.response?.data?.message || '测试失败' });
                            } finally {
                                setZoteroTesting(false);
                            }
                        }}
                        disabled={zoteroTesting || !zoteroUserId || !zoteroApiKey}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
                    >
                        <Wifi className="mr-2 h-4 w-4" />
                        {zoteroTesting ? '测试中...' : '测试连接'}
                    </button>

                    <button
                        onClick={async () => {
                            setZoteroSyncing(true);
                            setZoteroSyncResult(null);
                            try {
                                // Save credentials first
                                const smtpConfig = JSON.stringify({
                                    host: smtpHost, port: parseInt(smtpPort),
                                    auth: { user: smtpUser, pass: smtpPass }, from: fromEmail
                                });
                                await axios.post('/api/settings', {
                                    emailEnabled, targetEmail, smtpConfig, preferredHour,
                                    zoteroUserId: zoteroUserId || undefined,
                                    zoteroApiKey: zoteroApiKey || undefined,
                                });
                                const res = await axios.post('/api/zotero/sync');
                                const d = res.data;
                                setZoteroSyncResult(
                                    `同步完成！创建了 ${d.collectionsCreated} 个分类，${d.itemsCreated} 篇文章条目（共 ${d.totalJournals} 本期刊，${d.totalArticles} 篇文章）。`
                                );
                            } catch (e: any) {
                                setZoteroSyncResult(e.response?.data?.error || '同步失败');
                            } finally {
                                setZoteroSyncing(false);
                            }
                        }}
                        disabled={zoteroSyncing || !zoteroUserId || !zoteroApiKey}
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
                    >
                        <RefreshCw className={`mr-2 h-4 w-4 ${zoteroSyncing ? 'animate-spin' : ''}`} />
                        {zoteroSyncing ? '同步中...' : '同步到 Zotero'}
                    </button>
                </div>

                {zoteroTestResult && (
                    <div className={`p-3 rounded-md text-sm ${zoteroTestResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                        {zoteroTestResult.message}
                    </div>
                )}

                {zoteroSyncResult && (
                    <div className="p-3 rounded-md text-sm bg-blue-50 text-blue-800">
                        {zoteroSyncResult}
                    </div>
                )}
            </div>
        </div>
    );
}
