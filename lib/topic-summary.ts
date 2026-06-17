import { format } from 'date-fns';
import type { Article, Journal } from '@prisma/client';

export type SummaryArticle = {
    article: Article & { journal: Pick<Journal, 'title' | 'ajgRanking' | 'isFt50' | 'isUtd24'> };
    matchedKeywords: string[];
    translatedTitle?: string | null;
    translatedAbstract?: string | null;
};

export function renderTopicSummaryMarkdown(input: {
    topicName: string;
    windowStart: Date;
    windowEnd: Date;
    articles: SummaryArticle[];
}) {
    const range = `${format(input.windowStart, 'yyyy-MM-dd')} - ${format(input.windowEnd, 'yyyy-MM-dd')}`;
    if (input.articles.length === 0) {
        return [
            `# ${input.topicName} 周报`,
            '',
            `周期：${range}`,
            '',
            '本周无新增匹配论文。'
        ].join('\n');
    }

    const grouped = groupBy(input.articles, item => item.article.journal.title || 'Unknown Journal');
    const lines = [
        `# ${input.topicName} 周报`,
        '',
        `周期：${range}`,
        '',
        `共发现 ${input.articles.length} 篇匹配论文。`
    ];

    for (const [journal, articles] of Object.entries(grouped)) {
        lines.push('', `## ${journal}`);
        for (const item of articles) {
            const article = item.article;
            const labels = journalLabels(article.journal).join(', ') || 'Journal';
            lines.push(
                '',
                `- **${item.translatedTitle || article.title}**`,
                `  - Original: ${article.title}`,
                `  - Authors: ${article.authors || 'Unknown'}`,
                `  - Date: ${article.publicationDate ? format(article.publicationDate, 'yyyy-MM-dd') : 'Unknown'}`,
                `  - Matched: ${item.matchedKeywords.join(', ')}`,
                `  - Labels: ${labels}`,
                `  - Link: ${article.url || `https://doi.org/${article.doi}`}`,
                `  - Abstract: ${item.translatedAbstract || clampWords(article.abstract || 'No abstract available.', 90)}`
            );
        }
    }

    return lines.join('\n');
}

export function markdownToHtml(markdown: string) {
    return markdown
        .split('\n')
        .map(line => {
            if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
            if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
            if (line.startsWith('- ')) return `<p>${escapeHtml(line)}</p>`;
            if (line.trim() === '') return '<br />';
            return `<p>${escapeHtml(line)}</p>`;
        })
        .join('\n');
}

function journalLabels(journal: Pick<Journal, 'ajgRanking' | 'isFt50' | 'isUtd24'>) {
    const labels = [];
    if (journal.ajgRanking) labels.push(`ABS ${journal.ajgRanking}`);
    if (journal.isFt50) labels.push('FT50');
    if (journal.isUtd24) labels.push('UTD24');
    return labels;
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
    return items.reduce<Record<string, T[]>>((acc, item) => {
        const key = getKey(item);
        acc[key] ||= [];
        acc[key].push(item);
        return acc;
    }, {});
}

function clampWords(value: string, maxWords: number) {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return value;
    return `${words.slice(0, maxWords).join(' ')}...`;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
