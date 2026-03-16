import { auth } from '@/lib/auth/server';
import { Article, Journal, PrismaClient, UserSettings } from '@prisma/client';
import { fetchNewArticlesForJournal } from '@/lib/crossref';
import { sendNewArticlesEmailForUser } from '@/lib/monitor';
import { after } from 'next/server';

const prisma = new PrismaClient();

export const runtime = 'nodejs';
export const maxDuration = 60;

// Process 10 journals per request to stay well under timeout
const BATCH_SIZE = 10;

function getEnvNumber(name: string, fallback: number, min = 0) {
    const raw = process.env[name];
    if (!raw) return fallback;

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return parsed;
}

const JOURNAL_PROCESS_TIMEOUT_MS = getEnvNumber('JOURNAL_PROCESS_TIMEOUT_MS', 120000, 5000);
const UPDATE_HEARTBEAT_MS = getEnvNumber('UPDATE_HEARTBEAT_MS', 3000, 500);
const UPDATE_REQUEST_SOFT_TIMEOUT_MS = getEnvNumber('UPDATE_REQUEST_SOFT_TIMEOUT_MS', 55000, 10000);
const UPDATE_REQUEST_RESERVE_MS = getEnvNumber('UPDATE_REQUEST_RESERVE_MS', 4000, 1000);
const MIN_JOURNAL_BUDGET_MS = getEnvNumber('MIN_JOURNAL_BUDGET_MS', 7000, 1000);

class JournalTimeoutError extends Error {
    constructor(ms: number) {
        super(`Journal processing timed out after ${ms}ms`);
        this.name = 'JournalTimeoutError';
    }
}

type EmailArticle = Article & {
    journal: Journal;
};

function isJournalTimeoutError(error: unknown) {
    return error instanceof JournalTimeoutError;
}

async function withTimeout<T>(task: () => Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            onTimeout();
            reject(new JournalTimeoutError(timeoutMs));
        }, timeoutMs);
    });

    try {
        return await Promise.race([task(), timeoutPromise]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

export async function POST(request: Request) {
    // 1. Verify user session
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    const userId = session.user.id;

    // 2. Get startIndex from request body
    let startIndex = 0;
    try {
        const body = await request.json() as { startIndex?: number };
        startIndex = typeof body.startIndex === 'number' ? body.startIndex : 0;
    } catch {
        // No body or invalid JSON, start from 0
    }

    // 3. Get followed journals
    const followedJournals = await prisma.userJournalFollow.findMany({
        where: { userId },
        include: { journal: true },
        orderBy: { journalId: 'asc' }
    });

    const totalJournals = followedJournals.length;
    const endIndex = Math.min(startIndex + BATCH_SIZE, totalJournals);
    const batch = followedJournals.slice(startIndex, endIndex);

    // 4. Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const requestStartedAt = Date.now();

            const sendMessage = (msg: object) => {
                controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'));
            };

            const batchNewArticles: EmailArticle[] = [];
            let completedJournals = startIndex;
            let doneJournals = 0;
            let skippedJournals = 0;
            let errorJournals = 0;
            let timeoutJournals = 0;
            let totalNewArticles = 0;
            let currentJournalIndex: number | null = null;
            let currentJournalTitle: string | null = null;
            let lastActivityAt = Date.now();
            let nextIndexOverride: number | null = null;
            let stoppedByBudget = false;

            const emit = (msg: object) => {
                lastActivityAt = Date.now();
                sendMessage(msg);
            };

            const getRemainingBudgetMs = () => {
                const elapsed = Date.now() - requestStartedAt;
                return Math.max(0, UPDATE_REQUEST_SOFT_TIMEOUT_MS - elapsed);
            };

            emit({
                type: 'task_start',
                startIndex,
                endIndex,
                totalJournals,
                batchSize: batch.length,
                message: startIndex === 0
                    ? `Starting update for ${totalJournals} journals...`
                    : `Continuing from journal ${startIndex + 1}...`
            });

            const heartbeat = setInterval(() => {
                const idleMs = Date.now() - lastActivityAt;
                sendMessage({
                    type: 'heartbeat',
                    ts: new Date().toISOString(),
                    idleMs,
                    currentJournalIndex,
                    currentJournalTitle
                });
            }, UPDATE_HEARTBEAT_MS);

            let emailPayload: { articles: EmailArticle[]; settings: UserSettings } | null = null;

            try {
                for (let i = 0; i < batch.length; i++) {
                    const remainingBudgetMs = getRemainingBudgetMs();
                    const budgetForJournalMs = remainingBudgetMs - UPDATE_REQUEST_RESERVE_MS;
                    if (budgetForJournalMs < MIN_JOURNAL_BUDGET_MS) {
                        stoppedByBudget = true;
                        nextIndexOverride = startIndex + i;
                        emit({
                            type: 'task_budget_exhausted',
                            index: startIndex + i + 1,
                            remainingBudgetMs,
                            reserveMs: UPDATE_REQUEST_RESERVE_MS,
                            message: 'Pausing this batch to avoid platform timeout'
                        });
                        break;
                    }

                    const globalIndex = startIndex + i + 1;
                    const follow = batch[i];
                    const journal = follow.journal;
                    const issn = journal.printIssn || journal.eIssn;
                    const journalTimeoutMs = Math.min(JOURNAL_PROCESS_TIMEOUT_MS, budgetForJournalMs);

                    currentJournalIndex = globalIndex;
                    currentJournalTitle = journal.title;

                    if (!issn) {
                        completedJournals++;
                        skippedJournals++;
                        emit({
                            type: 'journal_done',
                            status: 'skip',
                            index: globalIndex,
                            journal: journal.title,
                            reason: 'No ISSN',
                            completedJournals,
                            totalJournals
                        });
                        continue;
                    }

                    emit({
                        type: 'journal_start',
                        index: globalIndex,
                        journal: journal.title
                    });

                    const abortController = new AbortController();
                    const journalStartedAt = Date.now();

                    try {
                        const result = await withTimeout(async () => {
                            const works = await fetchNewArticlesForJournal(issn, undefined, {
                                signal: abortController.signal
                            });

                            const totalWorks = works.length;
                            let processedWorks = 0;
                            let newCount = 0;

                            emit({
                                type: 'journal_progress',
                                index: globalIndex,
                                journal: journal.title,
                                processedWorks,
                                totalWorks,
                                newArticles: newCount
                            });

                            for (const work of works) {
                                if (abortController.signal.aborted) {
                                    throw new Error('Journal processing aborted');
                                }

                                try {
                                    const doi = work.DOI;
                                    const title = work.title?.[0] || 'No Title';
                                    const authors = work.author?.map((a: { given?: string; family?: string }) => `${a.given || ''} ${a.family || ''}`).join(', ') || '';
                                    const abstract = work.abstract || '';
                                    const pubDate = work.created?.['date-time'] ? new Date(work.created['date-time']) : null;
                                    const url = work.URL;

                                    let article = await prisma.article.findUnique({ where: { doi } });

                                    if (!article) {
                                        article = await prisma.article.create({
                                            data: {
                                                doi,
                                                title,
                                                authors,
                                                abstract,
                                                publicationDate: pubDate,
                                                url,
                                                journalId: journal.id
                                            }
                                        });
                                    }

                                    const userArticle = await prisma.userArticle.findUnique({
                                        where: { userId_articleId: { userId, articleId: article.id } }
                                    });

                                    if (!userArticle) {
                                        await prisma.userArticle.create({
                                            data: { userId, articleId: article.id, isRead: false }
                                        });
                                        batchNewArticles.push({ ...article, journal });
                                        newCount++;
                                    }
                                } catch (articleError) {
                                    console.error(`Failed to save article ${work.DOI}`, articleError);
                                } finally {
                                    processedWorks++;
                                    emit({
                                        type: 'journal_progress',
                                        index: globalIndex,
                                        journal: journal.title,
                                        processedWorks,
                                        totalWorks,
                                        newArticles: newCount
                                    });
                                }
                            }

                            return {
                                newCount,
                                processedWorks,
                                totalWorks
                            };
                        }, journalTimeoutMs, () => abortController.abort());

                        completedJournals++;
                        doneJournals++;
                        totalNewArticles += result.newCount;

                        emit({
                            type: 'journal_done',
                            status: 'done',
                            index: globalIndex,
                            journal: journal.title,
                            newArticles: result.newCount,
                            processedWorks: result.processedWorks,
                            totalWorks: result.totalWorks,
                            durationMs: Date.now() - journalStartedAt,
                            completedJournals,
                            totalJournals
                        });
                    } catch (journalError) {
                        completedJournals++;

                        if (isJournalTimeoutError(journalError)) {
                            timeoutJournals++;
                            emit({
                                type: 'journal_timeout',
                                index: globalIndex,
                                journal: journal.title,
                                timeoutMs: journalTimeoutMs,
                                completedJournals,
                                totalJournals
                            });
                            emit({
                                type: 'journal_done',
                                status: 'timeout',
                                index: globalIndex,
                                journal: journal.title,
                                timeoutMs: journalTimeoutMs,
                                durationMs: Date.now() - journalStartedAt,
                                completedJournals,
                                totalJournals
                            });
                        } else {
                            errorJournals++;
                            emit({
                                type: 'journal_done',
                                status: 'error',
                                index: globalIndex,
                                journal: journal.title,
                                error: 'Failed to fetch or save journal articles',
                                durationMs: Date.now() - journalStartedAt,
                                completedJournals,
                                totalJournals
                            });
                            console.error(`Failed to update journal ${journal.title}`, journalError);
                        }
                    }
                }

                const computedNextIndex = nextIndexOverride ?? endIndex;
                const hasMore = computedNextIndex < totalJournals;
                const isComplete = !hasMore;

                // Update last check time only when fully complete
                if (isComplete) {
                    await prisma.userSettings.update({
                        where: { userId },
                        data: { lastCheckTime: new Date() }
                    }).catch(() => { });
                }

                emit({
                    type: 'task_complete',
                    nextIndex: hasMore ? computedNextIndex : null,
                    hasMore,
                    stoppedByBudget,
                    totalJournals,
                    batchSize: batch.length,
                    completedJournals,
                    doneJournals,
                    skippedJournals,
                    errorJournals,
                    timeoutJournals,
                    totalNewArticles,
                    message: hasMore
                        ? (stoppedByBudget
                            ? `Batch paused before timeout (${totalNewArticles} new). Continuing...`
                            : `Batch complete (${totalNewArticles} new). Continuing...`)
                        : `Update complete. Found ${totalNewArticles} new articles.`
                });

                if (isComplete && batchNewArticles.length > 0) {
                    const settings = await prisma.userSettings.findUnique({ where: { userId } });
                    if (settings?.emailEnabled && settings?.targetEmail) {
                        emailPayload = { articles: batchNewArticles, settings };
                    }
                }
            } finally {
                clearInterval(heartbeat);
                controller.close();
            }

            if (emailPayload) {
                const sendPromise = sendNewArticlesEmailForUser(emailPayload.articles, emailPayload.settings)
                    .catch((emailError) => {
                        console.error('Failed to send update email', emailError);
                    });

                try {
                    after(async () => {
                        await sendPromise;
                    });
                } catch {
                    void sendPromise;
                }
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
