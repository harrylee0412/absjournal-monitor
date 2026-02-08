'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { RefreshCw, Download, CheckCircle, Circle, ExternalLink } from 'lucide-react';

interface Article {
  id: number;
  title: string;
  authors: string | null;
  abstract: string | null;
  doi: string;
  url: string | null;
  publicationDate: string | null;
  isRead: boolean;
  journal: {
    title: string;
  };
}

export default function Dashboard() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [selectedArticles, setSelectedArticles] = useState<number[]>([]);

  useEffect(() => {
    fetchArticles();
  }, [unreadOnly]);

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/articles', {
        params: { unread: unreadOnly, limit: 100 }
      });
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
  };

  const checkForUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await axios.post('/api/check-updates');
      if (res.data.success) {
        alert(`Checked for updates! Found ${res.data.newArticles} new articles.`);
        fetchArticles();
      }
    } catch (e) {
      alert('Failed to check for updates.');
      console.error(e);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const toggleReadStatus = async (id: number, current: boolean) => {
    // Optimistic
    setArticles(prev => prev.map(a => a.id === id ? { ...a, isRead: !current } : a));
    try {
      await axios.put('/api/articles', { ids: [id], isRead: !current });
    } catch (e) {
      console.error(e);
      // revert could go here
    }
  };

  const handleSelect = (id: number) => {
    setSelectedArticles(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const exportRis = () => {
    const subset = articles.filter(a => selectedArticles.includes(a.id));
    if (subset.length === 0) return alert("Select articles to export");

    let risContent = "";
    subset.forEach(a => {
      risContent += "TY  - JOUR\n";
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
      risContent += "ER  - \n\n";
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

      <div className="flex items-center space-x-4">
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

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {articles.length === 0 && !loading && (
            <li className="p-12 text-center text-gray-500">No articles found. Try following more journals or checking updates.</li>
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
                      title={article.isRead ? "Mark as Unread" : "Mark as Read"}
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
                      {/* <span className="truncate max-w-xs">{article.abstract}</span> */}
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
