import type { Article, PrismaClient } from '@prisma/client';

export type TopicArticleInput = Pick<Article, 'id' | 'title' | 'authors' | 'abstract'>;

export function splitKeywords(value: string | string[] | null | undefined) {
    const raw = Array.isArray(value) ? value.join('\n') : (value || '');
    return Array.from(new Set(
        raw
            .split(/[\n,;，；]+/)
            .map(item => item.trim())
            .filter(Boolean)
    ));
}

export function findMatchedKeywords(article: Pick<Article, 'title' | 'authors' | 'abstract'>, keywords: string[]) {
    const haystack = normalizeSearchText([article.title, article.authors, article.abstract].filter(Boolean).join('\n'));
    return keywords.filter(keyword => {
        const normalizedKeyword = normalizeSearchText(keyword);
        return normalizedKeyword.length > 0 && haystack.includes(normalizedKeyword);
    });
}

export async function recordTopicMatchesForArticle(
    prisma: PrismaClient,
    userId: string,
    article: TopicArticleInput
) {
    const topics = await prisma.topicSubscription.findMany({
        where: { userId, enabled: true },
        orderBy: { createdAt: 'asc' }
    });

    const matches = [];
    for (const topic of topics) {
        const matchedKeywords = findMatchedKeywords(article, topic.keywords);
        if (matchedKeywords.length === 0) continue;

        const match = await prisma.topicArticleMatch.upsert({
            where: {
                topicId_articleId: {
                    topicId: topic.id,
                    articleId: article.id
                }
            },
            create: {
                userId,
                topicId: topic.id,
                articleId: article.id,
                matchedKeywords
            },
            update: {
                matchedKeywords
            },
            include: { topic: true }
        });
        matches.push(match);
    }

    return matches;
}

export async function backfillTopicMatchesForUser(
    prisma: PrismaClient,
    userId: string,
    topicId: number,
    limit = 500
) {
    const topic = await prisma.topicSubscription.findFirst({
        where: { id: topicId, userId }
    });
    if (!topic) return 0;

    const userArticles = await prisma.userArticle.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { article: true }
    });

    let matchedCount = 0;
    for (const userArticle of userArticles) {
        const matchedKeywords = findMatchedKeywords(userArticle.article, topic.keywords);
        if (matchedKeywords.length === 0) {
            await prisma.topicArticleMatch.deleteMany({
                where: {
                    userId,
                    topicId,
                    articleId: userArticle.articleId
                }
            });
            continue;
        }

        matchedCount++;
        await prisma.topicArticleMatch.upsert({
            where: {
                topicId_articleId: {
                    topicId,
                    articleId: userArticle.articleId
                }
            },
            create: {
                userId,
                topicId,
                articleId: userArticle.articleId,
                matchedKeywords
            },
            update: {
                matchedKeywords
            }
        });
    }

    return matchedCount;
}

function normalizeSearchText(value: string) {
    return value
        .toLowerCase()
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
}
