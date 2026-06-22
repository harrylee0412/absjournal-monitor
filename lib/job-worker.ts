import { Job, JobType, PrismaClient } from '@prisma/client';
import { fetchAndDistributeArticles } from '@/lib/article-fetcher';
import { deliverEmailJob, EmailDeliveryPayload } from '@/lib/email-delivery';
import { completeJob, enqueueJob, updateJobProgress } from '@/lib/jobs';
import { runWeeklyTopicSummaries } from '@/lib/topic-runs';

export async function processJob(prisma: PrismaClient, job: Job) {
    if (job.type === JobType.USER_CHECK_UPDATE) {
        return processUserCheckUpdate(prisma, job);
    }

    if (job.type === JobType.DAILY_JOURNAL_FETCH) {
        return processDailyJournalFetch(prisma, job);
    }

    if (job.type === JobType.WEEKLY_TOPIC_SUMMARY) {
        return processWeeklyTopicSummary(prisma, job);
    }

    if (job.type === JobType.EMAIL_DELIVERY) {
        return processEmailDelivery(prisma, job);
    }

    throw new Error(`Unsupported job type: ${job.type}`);
}

async function processUserCheckUpdate(prisma: PrismaClient, job: Job) {
    const payload = asRecord(job.payload);
    const userId = job.userId || asString(payload.userId);
    if (!userId) throw new Error('USER_CHECK_UPDATE requires userId');

    const result = await fetchAndDistributeArticles(prisma, {
        userId,
        onProgress: async progress => {
            await updateJobProgress(job.id, {
                stage: 'FETCHING',
                ...progress
            }, prisma);
        }
    });

    const articles = result.newArticlesByUser.get(userId) || [];
    if (articles.length > 0) {
        await enqueueJob({
            type: JobType.EMAIL_DELIVERY,
            userId,
            payload: {
                kind: 'NEW_ARTICLES',
                userId,
                articleIds: articles.map(article => article.id)
            }
        }, prisma);
    }

    return completeJob(job.id, {
        stage: 'DONE',
        totalJournals: result.totalJournals,
        completedJournals: result.completedJournals,
        totalItems: result.totalItems,
        totalNewArticles: result.totalNewArticles,
        totalDistributedArticles: result.totalDistributedArticles,
        errorJournals: result.errorJournals,
        emailQueued: articles.length > 0
    }, prisma);
}

async function processDailyJournalFetch(prisma: PrismaClient, job: Job) {
    const result = await fetchAndDistributeArticles(prisma, {
        onProgress: async progress => {
            await updateJobProgress(job.id, {
                stage: 'FETCHING',
                ...progress
            }, prisma);
        }
    });

    let emailJobsQueued = 0;
    for (const [userId, articles] of result.newArticlesByUser.entries()) {
        if (articles.length === 0) continue;
        await enqueueJob({
            type: JobType.EMAIL_DELIVERY,
            userId,
            payload: {
                kind: 'NEW_ARTICLES',
                userId,
                articleIds: articles.map(article => article.id)
            }
        }, prisma);
        emailJobsQueued++;
    }

    return completeJob(job.id, {
        stage: 'DONE',
        totalJournals: result.totalJournals,
        completedJournals: result.completedJournals,
        totalItems: result.totalItems,
        totalNewArticles: result.totalNewArticles,
        totalDistributedArticles: result.totalDistributedArticles,
        errorJournals: result.errorJournals,
        emailJobsQueued
    }, prisma);
}

async function processWeeklyTopicSummary(prisma: PrismaClient, job: Job) {
    await updateJobProgress(job.id, { stage: 'GENERATING_SUMMARIES' }, prisma);
    const results = await runWeeklyTopicSummaries({ enqueueEmails: true });
    return completeJob(job.id, {
        stage: 'DONE',
        topicsProcessed: results.length,
        results
    }, prisma);
}

async function processEmailDelivery(prisma: PrismaClient, job: Job) {
    await updateJobProgress(job.id, { stage: 'SENDING_EMAIL' }, prisma);
    const result = await deliverEmailJob(prisma, job.payload as EmailDeliveryPayload);
    return completeJob(job.id, {
        stage: 'DONE',
        result
    }, prisma);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asString(value: unknown) {
    return typeof value === 'string' ? value : null;
}
