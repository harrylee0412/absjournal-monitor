import { Article, Journal, PrismaClient } from '@prisma/client';
import { subDays } from 'date-fns';
import { CrossRefWork, fetchNewArticlesForJournal } from '@/lib/crossref';
import { getEnvNumber } from '@/lib/jobs';
import { recordTopicMatchesForArticle } from '@/lib/topics';

type ArticleWithJournal = Article & { journal: Journal };

export type FetchProgress = {
    totalJournals: number;
    completedJournals: number;
    currentJournalId?: number;
    currentJournalTitle?: string;
    currentJournalItems?: number;
    totalItems: number;
    totalNewArticles: number;
    totalDistributedArticles: number;
    errorJournals: number;
};

export type FetchAndDistributeOptions = {
    userId?: string;
    journalIds?: number[];
    fetchWorks?: typeof fetchNewArticlesForJournal;
    onProgress?: (progress: FetchProgress) => Promise<void> | void;
};

export type FetchAndDistributeResult = FetchProgress & {
    newArticlesByUser: Map<string, ArticleWithJournal[]>;
};

const FIRST_FETCH_LOOKBACK_DAYS = 30;
const INCREMENTAL_OVERLAP_DAYS = 2;

let crossrefTurn = Promise.resolve();
let lastCrossrefStartedAt = 0;

export async function fetchAndDistributeArticles(
    prisma: PrismaClient,
    options: FetchAndDistributeOptions = {}
): Promise<FetchAndDistributeResult> {
    const journals = await resolveJournalsToFetch(prisma, options);
    const concurrency = getEnvNumber('CROSSREF_CONCURRENCY', 4, 1);
    const fetchWorks = options.fetchWorks || fetchNewArticlesForJournal;

    const progress: FetchProgress = {
        totalJournals: journals.length,
        completedJournals: 0,
        totalItems: 0,
        totalNewArticles: 0,
        totalDistributedArticles: 0,
        errorJournals: 0
    };
    const newArticlesByUser = new Map<string, ArticleWithJournal[]>();

    await options.onProgress?.(progress);

    await runWithConcurrency(journals, concurrency, async (journal) => {
        const issn = journal.printIssn || journal.eIssn;
        if (!issn) {
            progress.completedJournals++;
            await options.onProgress?.({ ...progress, currentJournalId: journal.id, currentJournalTitle: journal.title, currentJournalItems: 0 });
            return;
        }

        const state = await prisma.journalFetchState.findUnique({ where: { journalId: journal.id } });
        const fromDate = getFetchFromDate(state?.lastFetchedAt || null);
        const startedAt = new Date();

        try {
            await waitForCrossrefTurn();
            const works = await fetchWorks(issn, fromDate);
            progress.totalItems += works.length;

            const journalResult = await saveWorksAndDistribute(prisma, journal, works, options.userId);
            progress.totalNewArticles += journalResult.newArticleCount;
            progress.totalDistributedArticles += journalResult.distributedCount;
            mergeArticleMap(newArticlesByUser, journalResult.newArticlesByUser);

            await prisma.journalFetchState.upsert({
                where: { journalId: journal.id },
                create: {
                    journalId: journal.id,
                    lastFetchedAt: startedAt,
                    lastSuccessfulFromDate: fromDate,
                    lastItemCount: works.length,
                    lastError: null
                },
                update: {
                    lastFetchedAt: startedAt,
                    lastSuccessfulFromDate: fromDate,
                    lastItemCount: works.length,
                    lastError: null
                }
            });

            progress.completedJournals++;
            await options.onProgress?.({
                ...progress,
                currentJournalId: journal.id,
                currentJournalTitle: journal.title,
                currentJournalItems: works.length
            });
        } catch (error) {
            progress.completedJournals++;
            progress.errorJournals++;
            await prisma.journalFetchState.upsert({
                where: { journalId: journal.id },
                create: {
                    journalId: journal.id,
                    lastError: error instanceof Error ? error.message : String(error)
                },
                update: {
                    lastError: error instanceof Error ? error.message : String(error)
                }
            });
            await options.onProgress?.({
                ...progress,
                currentJournalId: journal.id,
                currentJournalTitle: journal.title,
                currentJournalItems: 0
            });
        }
    });

    return {
        ...progress,
        newArticlesByUser
    };
}

async function resolveJournalsToFetch(prisma: PrismaClient, options: FetchAndDistributeOptions) {
    if (options.journalIds?.length) {
        return prisma.journal.findMany({
            where: { id: { in: Array.from(new Set(options.journalIds)) } },
            orderBy: { id: 'asc' }
        });
    }

    const follows = await prisma.userJournalFollow.findMany({
        where: options.userId ? { userId: options.userId } : undefined,
        select: { journalId: true },
        distinct: ['journalId'],
        orderBy: { journalId: 'asc' }
    });

    const journalIds = follows.map(follow => follow.journalId);
    if (journalIds.length === 0) return [];

    return prisma.journal.findMany({
        where: { id: { in: journalIds } },
        orderBy: { id: 'asc' }
    });
}

function getFetchFromDate(lastFetchedAt: Date | null) {
    if (!lastFetchedAt) return subDays(new Date(), FIRST_FETCH_LOOKBACK_DAYS);
    return subDays(lastFetchedAt, INCREMENTAL_OVERLAP_DAYS);
}

async function saveWorksAndDistribute(
    prisma: PrismaClient,
    journal: Journal,
    works: CrossRefWork[],
    requestedUserId?: string
) {
    const followers = await prisma.userJournalFollow.findMany({
        where: { journalId: journal.id },
        select: { userId: true }
    });
    const followerIds = followers.map(follower => follower.userId);
    const newArticlesByUser = new Map<string, ArticleWithJournal[]>();
    let newArticleCount = 0;
    let distributedCount = 0;

    for (const work of works) {
        const doi = normalizeDoi(work.DOI);
        if (!doi) continue;

        const title = work.title?.[0] || 'No Title';
        const authors = work.author?.map((a: { given?: string; family?: string }) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean).join(', ') || '';
        const abstract = work.abstract || '';
        const publicationDate = work.created?.['date-time'] ? new Date(work.created['date-time']) : null;
        const url = work.URL;

        const existing = await prisma.article.findUnique({ where: { doi } });
        const article = existing
            ? await prisma.article.update({
                where: { doi },
                data: { title, authors, abstract, publicationDate, url }
            })
            : await prisma.article.create({
                data: { doi, title, authors, abstract, publicationDate, url, journalId: journal.id }
            });

        if (!existing) newArticleCount++;

        for (const userId of followerIds) {
            const userArticle = await prisma.userArticle.findUnique({
                where: { userId_articleId: { userId, articleId: article.id } }
            });

            if (!userArticle) {
                await prisma.userArticle.create({
                    data: { userId, articleId: article.id, isRead: false }
                });
                distributedCount++;

                const list = newArticlesByUser.get(userId) || [];
                list.push({ ...article, journal });
                newArticlesByUser.set(userId, list);
            }

            await recordTopicMatchesForArticle(prisma, userId, article);
        }
    }

    if (requestedUserId && !newArticlesByUser.has(requestedUserId)) {
        newArticlesByUser.set(requestedUserId, []);
    }

    return { newArticleCount, distributedCount, newArticlesByUser };
}

function normalizeDoi(value: string | undefined) {
    return (value || '').trim().toLowerCase();
}

function mergeArticleMap(target: Map<string, ArticleWithJournal[]>, source: Map<string, ArticleWithJournal[]>) {
    for (const [userId, articles] of source.entries()) {
        const list = target.get(userId) || [];
        list.push(...articles);
        target.set(userId, list);
    }
}

async function waitForCrossrefTurn() {
    const minIntervalMs = getEnvNumber('CROSSREF_MIN_INTERVAL_MS', 200, 0);
    const previous = crossrefTurn;
    let release!: () => void;
    crossrefTurn = new Promise<void>((resolve) => {
        release = resolve;
    });

    await previous;
    const waitMs = Math.max(0, lastCrossrefStartedAt + minIntervalMs - Date.now());
    if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    lastCrossrefStartedAt = Date.now();
    release();
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) {
            const current = items[index++];
            await worker(current);
        }
    });

    await Promise.all(workers);
}
