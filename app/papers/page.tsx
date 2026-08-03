'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { Download, CheckCircle, Circle, ExternalLink, Search } from 'lucide-react';

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

export default function Dashboard() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [selectedArticles, setSelectedArticles] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('hybrid');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState('');
  const [matchedOnly, setMatchedOnly] = useState(false);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-oxford">Papers Inbox</p>
          <h1 className="font-serif text-4xl font-semibold text-ink">论文收件箱</h1>
          <p className="mt-1 text-sage">系统每天北京时间16:00检查关注期刊，有新文献时会推送到你的邮箱。</p>
        </div>

        <div className="flex space-x-2">
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

      <div className="panel overflow-hidden">
        <ul className="divide-y divide-gray-200">
          {articles.length === 0 && !loading && (
            <li className="p-12 text-center text-gray-500">暂无文献，请调整筛选条件或关键词。</li>
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
