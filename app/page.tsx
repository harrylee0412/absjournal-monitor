'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { RefreshCw, Download, CheckCircle, Circle, ExternalLink, Search, AlertCircle } from 'lucide-react';

interface Article {
  id: number;
  title: string;
  authors: string | null;
  abstract: string | null;
  doi: string;
  url: string | null;
  publicationDate: string | null;
  isRead: boolean;
  score?: number;
  journal: {
    title: string;
  };
}

type SearchMode = 'hybrid' | 'fts' | 'trigram';
type SortMode = 'relevance' | 'date_desc';

interface UpdateMetrics {
  totalJournals: number;
  completedJournals: number;
  doneJournals: number;
  skippedJournals: number;
  errorJournals: number;
  timeoutJournals: number;
  totalNewArticles: number;
  currentJournalIndex: number | null;
  currentJournalTitle: string | null;
  currentJournalProcessedWorks: number;
  currentJournalTotalWorks: number;
}

const initialMetrics: UpdateMetrics = {
  totalJournals: 0,
  completedJournals: 0,
  doneJournals: 0,
  skippedJournals: 0,
  errorJournals: 0,
  timeoutJournals: 0,
  totalNewArticles: 0,
  currentJournalIndex: null,
  currentJournalTitle: null,
  currentJournalProcessedWorks: 0,
  currentJournalTotalWorks: 0
};

const STALL_THRESHOLD_MS = 10000;
const UPDATE_CHECKPOINT_KEY = 'journal-monitor:update-checkpoint:v1';
const MAX_AUTO_RETRIES = 1;
const AUTO_RETRY_DELAY_MS = 1500;

type StreamMessage = {
  type: string;
  [key: string]: unknown;
};

type UpdateRunState = 'idle' | 'running' | 'completed' | 'interrupted' | 'failed';

export default function Dashboard() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<string[]>([]);
  const [updateMetrics, setUpdateMetrics] = useState<UpdateMetrics>(initialMetrics);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [stallSeconds, setStallSeconds] = useState(0);
  const [isStalled, setIsStalled] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [selectedArticles, setSelectedArticles] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('hybrid');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [updateRunState, setUpdateRunState] = useState<UpdateRunState>('idle');
  const resumeIndexRef = useRef(0);

  const readCheckpoint = () => {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(UPDATE_CHECKPOINT_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  };

  const writeCheckpoint = (nextIndex: number | null) => {
    if (typeof window === 'undefined') return;
    if (nextIndex === null || nextIndex <= 0) {
      window.localStorage.removeItem(UPDATE_CHECKPOINT_KEY);
      return;
    }
    window.localStorage.setItem(UPDATE_CHECKPOINT_KEY, String(nextIndex));
  };

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean> = {
        unread: unreadOnly,
        limit: 100
      };

      if (debouncedSearch) {
        params.q = debouncedSearch;
        params.searchMode = searchMode;
        params.sort = sortMode;
      }

      const res = await axios.get('/api/articles', { params });
      setArticles(res.data.data);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        window.location.href = '/welcome';
        return;
      }
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, searchMode, sortMode, unreadOnly]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  useEffect(() => {
    if (!checkingUpdates) {
      setIsStalled(false);
      setStallSeconds(0);
      return;
    }

    const timer = setInterval(() => {
      if (!lastEventAt) return;
      const idleMs = Date.now() - lastEventAt;
      setStallSeconds(Math.floor(idleMs / 1000));
      setIsStalled(idleMs > STALL_THRESHOLD_MS);
    }, 1000);

    return () => clearInterval(timer);
  }, [checkingUpdates, lastEventAt]);

  const appendProgress = (message: string) => {
    setUpdateProgress(prev => [...prev, message]);
  };

  const checkForUpdates = async () => {
    const savedCheckpoint = readCheckpoint();
    let runStartIndex = savedCheckpoint > 0 ? savedCheckpoint : 0;

    setCheckingUpdates(true);
    setUpdateRunState('running');
    setUpdateProgress([]);
    setUpdateMetrics({
      ...initialMetrics,
      completedJournals: runStartIndex
    });
    setLastEventAt(Date.now());
    setStallSeconds(0);
    setIsStalled(false);
    resumeIndexRef.current = runStartIndex;

    if (runStartIndex > 0) {
      appendProgress(`Detected unfinished update. Resuming from journal ${runStartIndex + 1}...`);
    }

    const processBatch = async (startIndex: number): Promise<void> => {
      const response = await fetch('/api/check-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startIndex })
      });

      if (!response.ok) {
        throw new Error('Failed to check updates');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let nextIndex: number | null = null;
      let hasMore = false;
      let gotTaskComplete = false;

      const handleMessage = (msg: StreamMessage) => {
        setLastEventAt(Date.now());
        setIsStalled(false);

        if (msg.type === 'task_start') {
          const totalJournals = Number(msg.totalJournals || 0);
          const startIndex = Number(msg.startIndex || 0);
          const clampedStart = totalJournals > 0
            ? Math.min(startIndex, totalJournals)
            : startIndex;

          setUpdateMetrics(prev => ({
            ...prev,
            totalJournals: totalJournals || prev.totalJournals,
            completedJournals: Math.max(prev.completedJournals, clampedStart)
          }));
          resumeIndexRef.current = clampedStart;
          writeCheckpoint(clampedStart > 0 ? clampedStart : null);
          appendProgress(`Starting update for ${totalJournals} journals...`);
          return;
        }

        if (msg.type === 'journal_start') {
          const index = Number(msg.index || 0);
          const journal = String(msg.journal || 'Unknown Journal');

          setUpdateMetrics(prev => ({
            ...prev,
            currentJournalIndex: index,
            currentJournalTitle: journal,
            currentJournalProcessedWorks: 0,
            currentJournalTotalWorks: 0
          }));
          appendProgress(`[${index}] Checking ${journal}...`);
          return;
        }

        if (msg.type === 'journal_progress') {
          const processedWorks = Number(msg.processedWorks || 0);
          const totalWorks = Number(msg.totalWorks || 0);
          setUpdateMetrics(prev => ({
            ...prev,
            currentJournalProcessedWorks: processedWorks,
            currentJournalTotalWorks: totalWorks
          }));
          return;
        }

        if (msg.type === 'journal_timeout') {
          const index = Number(msg.index || 0);
          const journal = String(msg.journal || 'Unknown Journal');
          appendProgress(`[${index}] ${journal}: timeout, skipped`);
          return;
        }

        if (msg.type === 'task_budget_exhausted') {
          const index = Number(msg.index || 0);
          appendProgress(`Approaching request timeout, pausing before journal ${index}...`);
          return;
        }

        if (msg.type === 'journal_done') {
          const index = Number(msg.index || 0);
          const journal = String(msg.journal || 'Unknown Journal');
          const status = String(msg.status || 'done');
          const newArticles = Number(msg.newArticles || 0);
          const completedJournals = Number(msg.completedJournals || 0);
          const totalJournals = Number(msg.totalJournals || updateMetrics.totalJournals);
          const processedWorks = Number(msg.processedWorks || 0);
          const totalWorks = Number(msg.totalWorks || 0);

          setUpdateMetrics(prev => {
            const next = { ...prev };
            next.completedJournals = Math.max(prev.completedJournals, completedJournals);
            if (totalJournals > 0) next.totalJournals = totalJournals;
            next.totalNewArticles = prev.totalNewArticles + (status === 'done' ? newArticles : 0);
            next.currentJournalProcessedWorks = Math.max(prev.currentJournalProcessedWorks, processedWorks);
            next.currentJournalTotalWorks = Math.max(prev.currentJournalTotalWorks, totalWorks);

            if (status === 'done') next.doneJournals += 1;
            if (status === 'skip') next.skippedJournals += 1;
            if (status === 'error') next.errorJournals += 1;
            if (status === 'timeout') next.timeoutJournals += 1;

            return next;
          });

          const checkpoint = Math.max(0, completedJournals);
          resumeIndexRef.current = checkpoint;
          writeCheckpoint(checkpoint > 0 ? checkpoint : null);

          if (status === 'done') appendProgress(`[${index}] ${journal}: ${newArticles} new`);
          if (status === 'skip') appendProgress(`[${index}] ${journal}: skipped`);
          if (status === 'error') appendProgress(`[${index}] ${journal}: failed`);
          if (status === 'timeout') appendProgress(`[${index}] ${journal}: timeout`);
          return;
        }

        if (msg.type === 'task_complete') {
          gotTaskComplete = true;
          const doneJournals = Number(msg.doneJournals || 0);
          const skippedJournals = Number(msg.skippedJournals || 0);
          const errorJournals = Number(msg.errorJournals || 0);
          const timeoutJournals = Number(msg.timeoutJournals || 0);
          const completedJournals = Number(msg.completedJournals || 0);
          const totalNewArticles = Number(msg.totalNewArticles || 0);
          const totalJournals = Number(msg.totalJournals || updateMetrics.totalJournals);

          setUpdateMetrics(prev => ({
            ...prev,
            totalJournals: totalJournals || prev.totalJournals,
            completedJournals: Math.max(prev.completedJournals, completedJournals),
            doneJournals: Math.max(prev.doneJournals, doneJournals),
            skippedJournals: Math.max(prev.skippedJournals, skippedJournals),
            errorJournals: Math.max(prev.errorJournals, errorJournals),
            timeoutJournals: Math.max(prev.timeoutJournals, timeoutJournals),
            totalNewArticles: Math.max(prev.totalNewArticles, totalNewArticles)
          }));

          hasMore = Boolean(msg.hasMore);
          nextIndex = typeof msg.nextIndex === 'number' ? msg.nextIndex : null;
          const checkpoint = hasMore && nextIndex !== null ? nextIndex : null;
          resumeIndexRef.current = checkpoint ?? 0;
          writeCheckpoint(checkpoint);

          if (!hasMore) {
            appendProgress(`All done. Found ${totalNewArticles} new articles.`);
          } else {
            appendProgress(`Batch done. Continuing from journal ${Number(nextIndex || 0) + 1}...`);
          }
          return;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const msg = JSON.parse(trimmed) as StreamMessage;
            handleMessage(msg);
          } catch {
            // Ignore malformed line and continue processing stream.
          }
        }
      }

      const flushText = decoder.decode();
      if (flushText) buffer += flushText;
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim()) as StreamMessage;
          handleMessage(msg);
        } catch {
          // Ignore malformed tail.
        }
      }

      if (!gotTaskComplete) {
        throw new Error('Update stream interrupted before completion');
      }

      if (hasMore && nextIndex === null) {
        throw new Error('Stream requested continuation but nextIndex is missing');
      }

      if (hasMore && nextIndex !== null) {
        await processBatch(nextIndex);
      }
    };

    try {
      let retryCount = 0;
      while (true) {
        try {
          await processBatch(runStartIndex);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          const interrupted = message.toLowerCase().includes('interrupted');

          if (interrupted && retryCount < MAX_AUTO_RETRIES) {
            retryCount += 1;
            runStartIndex = Math.max(0, resumeIndexRef.current);
            appendProgress(`Stream interrupted. Auto-retrying (${retryCount}/${MAX_AUTO_RETRIES}) from journal ${runStartIndex + 1}...`);
            await sleep(AUTO_RETRY_DELAY_MS);
            continue;
          }

          throw error;
        }
      }

      await fetchArticles();
      setUpdateRunState('completed');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      const interrupted = message.toLowerCase().includes('interrupted');
      setUpdateRunState(interrupted ? 'interrupted' : 'failed');
      appendProgress(interrupted
        ? 'Update stream was interrupted unexpectedly. Please retry.'
        : 'Failed to check for updates');
      console.error(e);
    } finally {
      setCheckingUpdates(false);
      setIsStalled(false);
      setStallSeconds(0);
    }
  };

  const toggleReadStatus = async (id: number, current: boolean) => {
    setArticles(prev => prev.map(a => a.id === id ? { ...a, isRead: !current } : a));
    try {
      await axios.put('/api/articles', { ids: [id], isRead: !current });
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelect = (id: number) => {
    setSelectedArticles(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const exportRis = () => {
    const subset = articles.filter(a => selectedArticles.includes(a.id));
    if (subset.length === 0) return alert('Select articles to export');

    let risContent = '';
    subset.forEach(a => {
      risContent += 'TY  - JOUR\n';
      risContent += `TI  - ${a.title}\n`;
      if (a.authors) {
        a.authors.split(', ').forEach(au => {
          risContent += `AU  - ${au}\n`;
        });
      }
      risContent += `JO  - ${a.journal.title}\n`;
      risContent += `DO  - ${a.doi}\n`;
      if (a.abstract) risContent += `AB  - ${a.abstract}\n`;
      if (a.url) risContent += `UR  - ${a.url}\n`;
      if (a.publicationDate) {
        const d = new Date(a.publicationDate);
        risContent += `PY  - ${d.getFullYear()}\n`;
      }
      risContent += 'ER  - \n\n';
    });

    const blob = new Blob([risContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'articles.ris';
    link.click();
  };

  const mainProgressPercent = updateMetrics.totalJournals > 0
    ? Math.min(100, Math.round((updateMetrics.completedJournals / updateMetrics.totalJournals) * 100))
    : 0;

  const subProgressPercent = updateMetrics.currentJournalTotalWorks > 0
    ? Math.min(100, Math.round((updateMetrics.currentJournalProcessedWorks / updateMetrics.currentJournalTotalWorks) * 100))
    : 0;

  const statusText = checkingUpdates
    ? 'Running'
    : (updateRunState === 'completed'
      ? 'Completed'
      : updateRunState === 'interrupted'
        ? 'Interrupted'
        : updateRunState === 'failed'
          ? 'Failed'
          : 'Idle');

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Feed</h1>
          <p className="text-muted-foreground mt-1">Latest articles from your followed journals.</p>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={checkForUpdates}
            disabled={checkingUpdates}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${checkingUpdates ? 'animate-spin' : ''}`} />
            {checkingUpdates ? 'Checking...' : 'Check Updates'}
          </button>
          <button
            onClick={exportRis}
            disabled={selectedArticles.length === 0}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none disabled:opacity-50"
          >
            <Download className="mr-2 h-4 w-4" />
            Export RIS ({selectedArticles.length})
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search existing articles by keyword..."
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={searchMode}
            onChange={e => setSearchMode(e.target.value as SearchMode)}
            className="block pl-3 pr-8 py-1.5 text-sm border-gray-300 focus:outline-none focus:ring-primary focus:border-primary rounded-md bg-white text-black border"
          >
            <option value="hybrid">Search: Hybrid (FTS + fuzzy)</option>
            <option value="fts">Search: FTS only</option>
            <option value="trigram">Search: Fuzzy only</option>
          </select>

          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="block pl-3 pr-8 py-1.5 text-sm border-gray-300 focus:outline-none focus:ring-primary focus:border-primary rounded-md bg-white text-black border"
          >
            <option value="relevance">Sort: Relevance</option>
            <option value="date_desc">Sort: Newest first</option>
          </select>

          <label className="flex items-center space-x-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={e => setUnreadOnly(e.target.checked)}
              className="rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>Show Unread Only</span>
          </label>
        </div>
      </div>

      {updateProgress.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto shadow-inner">
          <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-300">Update status</span>
              <span
                className={
                  updateRunState === 'failed' || updateRunState === 'interrupted'
                    ? 'text-red-300'
                    : updateRunState === 'completed'
                      ? 'text-emerald-300'
                      : 'text-cyan-300'
                }
              >
                {statusText}
              </span>
            </div>

            <div>
              <div className="flex justify-between text-xs text-gray-300 mb-1">
                <span>Journal progress</span>
                <span>{updateMetrics.completedJournals}/{Math.max(updateMetrics.totalJournals, 1)}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-green-500 to-emerald-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${mainProgressPercent}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-gray-300 mb-1">
                <span>
                  Current journal: {updateMetrics.currentJournalIndex ? `[${updateMetrics.currentJournalIndex}] ` : ''}
                  {updateMetrics.currentJournalTitle || 'Waiting...'}
                </span>
                <span>{updateMetrics.currentJournalProcessedWorks}/{updateMetrics.currentJournalTotalWorks}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-blue-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${subProgressPercent}%` }}
                />
              </div>
            </div>

            <div className="text-xs text-gray-400">
              done: {updateMetrics.doneJournals} | skipped: {updateMetrics.skippedJournals} | errors: {updateMetrics.errorJournals} | timeouts: {updateMetrics.timeoutJournals}
            </div>

            {isStalled && checkingUpdates && (
              <div className="flex items-center text-amber-300 text-xs gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>No new update events for {stallSeconds}s. Still running and waiting for backend work.</span>
              </div>
            )}
          </div>

          <div className="space-y-1 font-mono text-sm">
            {updateProgress.map((msg, idx) => (
              <div key={idx} className="text-green-400">{msg}</div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {articles.length === 0 && !loading && (
            <li className="p-12 text-center text-gray-500">No articles found. Try adjusting filters, keywords, or checking updates.</li>
          )}
          {articles.map((article) => (
            <li key={article.id} className={`hover:bg-gray-50 transition-colors ${article.isRead ? 'opacity-60 bg-gray-50' : 'bg-white'}`}>
              <div className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center min-w-0 gap-3">
                    <input
                      type="checkbox"
                      checked={selectedArticles.includes(article.id)}
                      onChange={() => handleSelect(article.id)}
                      className="rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary">
                        <a href={`http://doi.org/${article.doi}`} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1">
                          {article.title}
                          <ExternalLink className="w-3 h-3 text-gray-400" />
                        </a>
                      </p>
                      <p className="mt-1 flex items-center text-xs text-gray-500">
                        <span className="truncate">{article.journal.title}</span>
                        <span className="mx-2">&bull;</span>
                        <span>{article.publicationDate ? format(new Date(article.publicationDate), 'MMM d, yyyy') : 'Unknown Date'}</span>
                      </p>
                    </div>
                  </div>
                  <div className="ml-2 flex-shrink-0 flex">
                    <button
                      onClick={() => toggleReadStatus(article.id, article.isRead)}
                      className="p-1 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                      title={article.isRead ? 'Mark as Unread' : 'Mark as Read'}
                    >
                      {article.isRead ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                <div className="mt-2 sm:flex sm:justify-between">
                  <div className="sm:flex">
                    <p className="text-sm text-gray-500 line-clamp-2">
                      {article.authors}
                    </p>
                  </div>
                  {article.abstract && (
                    <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                      {/* Reserved for future abstract preview toggle. */}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
