'use client';

import { useState, useEffect } from 'react';
import { Search, Loader2, Info } from 'lucide-react';
import axios from 'axios';

interface Journal {
    id: number;
    title: string;
    printIssn: string | null;
    eIssn: string | null;
    ajgRanking: string | null;
    isFt50: boolean;
    isUtd24: boolean;
    isFollowed: boolean;
}

export default function JournalsPage() {
    const [journals, setJournals] = useState<Journal[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [ajgFilter, setAjgFilter] = useState('');
    const [isFt50, setIsFt50] = useState(false);
    const [isUtd24, setIsUtd24] = useState(false);
    const [onlyFollowed, setOnlyFollowed] = useState(false);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchJournals();
        }, 500);
        return () => clearTimeout(timer);
    }, [search, ajgFilter, isFt50, isUtd24, onlyFollowed]);

    const fetchJournals = async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (search) params.search = search;
            if (ajgFilter) params.ranking = ajgFilter;
            if (isFt50) params.isFt50 = 'true';
            if (isUtd24) params.isUtd24 = 'true';
            if (onlyFollowed) params.isFollowed = 'true';

            const res = await axios.get('/api/journals', { params });
            setJournals(res.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const toggleFollow = async (id: number, currentStatus: boolean) => {
        // Optimistic update
        setJournals(prev => prev.map(j => j.id === id ? { ...j, isFollowed: !currentStatus } : j));

        try {
            await axios.post(`/api/journals/${id}/follow`, { isFollowed: !currentStatus });
        } catch (e) {
            console.error("Failed to toggle follow", e);
            if (axios.isAxiosError(e) && e.response?.data?.error) {
                alert(e.response.data.error);
            } else {
                alert("Operation failed. Please try again.");
            }
            // Revert
            setJournals(prev => prev.map(j => j.id === id ? { ...j, isFollowed: currentStatus } : j));
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Journals</h1>
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        <Info className="w-4 h-4" />
                        You can follow up to 30 journals.
                    </p>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center space-x-2 text-sm">
                        <input
                            type="checkbox"
                            checked={isFt50}
                            onChange={e => setIsFt50(e.target.checked)}
                            className="rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span>FT50</span>
                    </label>
                    <label className="flex items-center space-x-2 text-sm">
                        <input
                            type="checkbox"
                            checked={isUtd24}
                            onChange={e => setIsUtd24(e.target.checked)}
                            className="rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span>UTD24</span>
                    </label>
                    <label className="flex items-center space-x-2 text-sm">
                        <input
                            type="checkbox"
                            checked={onlyFollowed}
                            onChange={e => setOnlyFollowed(e.target.checked)}
                            className="rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span>Only Followed</span>
                    </label>

                    <select
                        value={ajgFilter}
                        onChange={e => setAjgFilter(e.target.value)}
                        className="block pl-3 pr-10 py-1.5 text-base border-gray-300 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm rounded-md bg-white text-black border"
                    >
                        <option value="">All Rankings</option>
                        <option value="4*">4*</option>
                        <option value="4">4</option>
                        <option value="3">3</option>
                        <option value="2">2</option>
                        <option value="1">1</option>
                    </select>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm"
                    placeholder="Search by title..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            {/* List */}
            {loading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {journals.map(journal => (
                        <div key={journal.id} className="relative rounded-lg border border-border bg-card p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start">
                                    <h3 className="text-lg font-semibold text-foreground leading-6 mb-2">
                                        {journal.title}
                                    </h3>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {journal.ajgRanking && (
                                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${journal.ajgRanking === '4*' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                                            ABS {journal.ajgRanking}
                                        </span>
                                    )}
                                    {journal.isFt50 && (
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">
                                            FT50
                                        </span>
                                    )}
                                    {journal.isUtd24 && (
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                            UTD24
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-muted-foreground truncate">
                                    ISSN: {journal.printIssn || journal.eIssn || 'N/A'}
                                </p>
                            </div>

                            <div className="mt-4">
                                <button
                                    onClick={() => toggleFollow(journal.id, journal.isFollowed)}
                                    className={`w-full inline-flex justify-center items-center px-4 py-2 border text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${journal.isFollowed
                                        ? 'border-transparent text-white bg-red-600 hover:bg-red-700 focus:ring-red-500'
                                        : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50 focus:ring-primary'
                                        }`}
                                >
                                    {journal.isFollowed ? 'Unfollow' : 'Follow'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
