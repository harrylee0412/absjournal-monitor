'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Clock, Copy, Check } from 'lucide-react';

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
                preferredHour
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

            {/* Zotero Plugin Section */}
            <div className="bg-white shadow sm:rounded-lg p-6 space-y-4">
                <div>
                    <h3 className="text-lg font-medium leading-6 text-gray-900 mb-1">Zotero Plugin</h3>
                    <p className="text-sm text-gray-500">
                        Copy these values into the Zotero Journal Monitor Sync plugin settings.
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">User ID</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <input type="text" readOnly value={userId}
                            className="flex-1 block w-full border border-gray-300 rounded-l-md py-2 px-3 bg-gray-50 text-sm font-mono text-gray-700" />
                        <button onClick={() => copyToClipboard(userId, 'userId')}
                            className="inline-flex items-center px-3 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 hover:bg-gray-100 text-sm text-gray-600">
                            {copied === 'userId' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">API Key</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <input type="text" readOnly value={cronApiKey}
                            className="flex-1 block w-full border border-gray-300 rounded-l-md py-2 px-3 bg-gray-50 text-sm font-mono text-gray-700" />
                        <button onClick={() => copyToClipboard(cronApiKey, 'apiKey')}
                            className="inline-flex items-center px-3 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 hover:bg-gray-100 text-sm text-gray-600">
                            {copied === 'apiKey' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
