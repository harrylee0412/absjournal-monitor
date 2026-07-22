'use client';

import { useState, useEffect, useCallback } from 'react';
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
    ajgRanking?: string | null;
    isFt50?: boolean;
    isUtd24?: boolean;
  };
  topicMatches?: {
    id: number;
    matchedKeywords: string[];
    topic: {
      id: number;
      name: string;
    };
  }[];
}

interface Topic {
  id: number;
  name: string;
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
const JOB_POLL_INTERVAL_MS = 2000;
// The free-tier worker may sleep for up to 30 minutes between idle checks.
const JOB_POLL_TIMEOUT_MS = 45 * 60 * 1000;

type UpdateRunState = 'idle' | 'running' | 'completed' | 'interrupted' | 'failed';

type JobData = {
  id: number;
  status: 'PENDING' | 'RUNNING' | 'RETRYING' | 'SUCCESS' | 'FAILED';
  progress?: Record<string, unknown>;
  lastError?: string | null;
};

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
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState('');
  const [matchedOnly, setMatchedOnly] = useState(false);

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

  const toNumber = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTopicId = params.get('topicId');
    const initialQuery = params.get('q');
    if (initialTopicId) setTopicId(initialTopicId);
    if (initialQuery) setSearchQuery(initialQuery);
  }, []);

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
      if (topicId) params.topicId = topicId;
      if (matchedOnly) params.matchedOnly = true;

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
  }, [debouncedSearch, searchMode, sortMode, unreadOnly, topicId, matchedOnly]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  useEffect(() => {
    axios.get('/api/topics')
      .then(res => setTopics(res.data.data || []))
      .catch(() => setTopics([]));
  }, []);

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
    setCheckingUpdates(true);
    setUpdateRunState('running');
    setUpdateProgress(['Creating background update job...']);
    setUpdateMetrics(initialMetrics);
    setLastEventAt(Date.now());
    setStallSeconds(0);
    setIsStalled(false);

    try {
      const createRes = await axios.post('/api/check-updates');
      const jobId = Number(createRes.data.jobId);
      if (!Number.isFinite(jobId)) throw new Error('Update job was not created');

      appendProgress(`Job #${jobId} queued. Worker will process it in the background.`);
      const startedAt = Date.now();
      let lastLoggedStatus = '';
      let lastLoggedCompleted = -1;

      while (Date.now() - startedAt < JOB_POLL_TIMEOUT_MS) {
        const jobRes = await axios.get(`/api/jobs/${jobId}`);
        const job = jobRes.data.data as JobData;
        const progress = job.progress || {};
        setLastEventAt(Date.now());
        setIsStalled(false);
        applyJobProgress(progress);

        const completed = toNumber(progress.completedJournals);
        const total = toNumber(progress.totalJournals);
        const currentJournal = typeof progress.currentJournalTitle === 'string' ? progress.currentJournalTitle : '';
        const statusLine = `${job.status}:${completed}:${currentJournal}`;

        if (job.status !== lastLoggedStatus) {
          appendProgress(`Job status: ${job.status}`);
          lastLoggedStatus = job.status;
        }

        if (completed !== lastLoggedCompleted && total > 0) {
          appendProgress(`Progress: ${completed}/${total}${currentJournal ? ` · ${currentJournal}` : ''}`);
          lastLoggedCompleted = completed;
        }

        if (job.status === 'SUCCESS') {
          appendProgress(`All done. Found ${toNumber(progress.totalNewArticles)} new global articles, distributed ${toNumber(progress.totalDistributedArticles)} user articles.`);
          await fetchArticles();
          setUpdateRunState('completed');
          return;
        }

        if (job.status === 'FAILED') {
          throw new Error(job.lastError || 'Update job failed');
        }

        if (statusLine) {
          await sleep(JOB_POLL_INTERVAL_MS);
        }
      }

      throw new Error('Update job polling timed out');
    } catch (e) {
      setUpdateRunState('failed');
      appendProgress(e instanceof Error ? e.message : 'Failed to check for updates');
      console.error(e);
    } finally {
      setCheckingUpdates(false);
      setIsStalled(false);
      setStallSeconds(0);
    }
  };

  const applyJobProgress = (progress: Record<string, unknown>) => {
    const totalJournals = toNumber(progress.totalJournals);
    const completedJournals = toNumber(progress.completedJournals);
    const errorJournals = toNumber(progress.errorJournals);
    const currentJournalTitle = typeof progress.currentJournalTitle === 'string' ? progress.currentJournalTitle : null;
    const currentJournalItems = toNumber(progress.currentJournalItems);

    setUpdateMetrics(prev => ({
      ...prev,
      totalJournals: totalJournals || prev.totalJournals,
      completedJournals: Math.max(prev.completedJournals, completedJournals),
      doneJournals: Math.max(0, completedJournals - errorJournals),
      errorJournals,
      totalNewArticles: toNumber(progress.totalNewArticles),
      currentJournalIndex: null,
      currentJournalTitle,
      currentJournalProcessedWorks: currentJournalItems,
      currentJournalTotalWorks: currentJournalItems
    }));
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
      <div className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Papers Inbox</p>
          <h1 className="font-serif text-4xl font-semibold text-ink">论文收件箱</h1>
          <p className="mt-1 text-sage">来自你关注期刊的每日更新，可按话题命中过滤。</p>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={checkForUpdates}
            disabled={checkingUpdates}
            className="btn"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${checkingUpdates ? 'animate-spin' : ''}`} />
            {checkingUpdates ? '抓取中...' : '手动抓取'}
          </button>
          <button
            onClick={exportRis}
            disabled={selectedArticles.length === 0}
            className="btn secondary"
          >
            <Download className="mr-2 h-4 w-4" />
            导出 RIS ({selectedArticles.length})
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
            placeholder="搜索标题、作者、摘要、期刊或关键词..."
            className="input block w-full pl-10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={searchMode}
            onChange={e => setSearchMode(e.target.value as SearchMode)}
            className="input max-w-[220px] py-1.5 text-sm"
          >
            <option value="hybrid">搜索：综合匹配</option>
            <option value="fts">搜索：全文检索</option>
            <option value="trigram">搜索：模糊匹配</option>
          </select>

          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="input max-w-[180px] py-1.5 text-sm"
          >
            <option value="relevance">排序：相关度</option>
            <option value="date_desc">排序：最新优先</option>
          </select>

          <label className="flex items-center space-x-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={e => setUnreadOnly(e.target.checked)}
              className="rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>只看未读</span>
          </label>

          <select
            value={topicId}
            onChange={e => setTopicId(e.target.value)}
            className="input max-w-[220px] py-1.5 text-sm"
          >
            <option value="">全部话题</option>
            {topics.map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>

          <label className="flex items-center space-x-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={matchedOnly}
              onChange={e => setMatchedOnly(e.target.checked)}
              className="rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>只看话题命中</span>
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

      <div className="panel overflow-hidden">
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
                      <div className="mt-2 flex flex-wrap gap-1">
                        {article.journal.ajgRanking ? <span className="tag">ABS {article.journal.ajgRanking}</span> : null}
                        {article.journal.isFt50 ? <span className="tag">FT50</span> : null}
                        {article.journal.isUtd24 ? <span className="tag">UTD24</span> : null}
                        {(article.topicMatches || []).map(match => (
                          <span key={match.id} className="tag">
                            {match.topic.name}: {match.matchedKeywords.join(', ')}
                          </span>
                        ))}
                      </div>
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
