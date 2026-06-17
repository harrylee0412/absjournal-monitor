import { addDays, subDays } from 'date-fns';
import { PrismaClient, TopicSubscription, UserSettings } from '@prisma/client';
import { markdownToHtml, renderTopicSummaryMarkdown, SummaryArticle } from '@/lib/topic-summary';
import { normalizeTranslateMode, translateText } from '@/lib/translator';

const prisma = new PrismaClient();

export type TopicRunOptions = {
    userId?: string;
    topicId?: number;
    windowStart?: Date;
    windowEnd?: Date;
};

export async function runWeeklyTopicSummaries(options: TopicRunOptions = {}) {
    const windowEnd = options.windowEnd || addDays(new Date(), 1);
    const windowStart = options.windowStart || subDays(windowEnd, 7);

    const topics = await prisma.topicSubscription.findMany({
        where: {
            enabled: true,
            ...(options.userId ? { userId: options.userId } : {}),
            ...(options.topicId ? { id: options.topicId } : {})
        },
        orderBy: { createdAt: 'asc' }
    });

    const results = [];
    for (const topic of topics) {
        results.push(await runTopicSummary(topic, windowStart, windowEnd));
    }
    return results;
}

export async function previewTopicSummary(userId: string, topicId: number) {
    const topic = await prisma.topicSubscription.findFirst({
        where: { id: topicId, userId }
    });
    if (!topic) throw new Error('Topic not found');

    const windowEnd = addDays(new Date(), 1);
    const windowStart = subDays(windowEnd, 30);
    const articles = await collectTopicSummaryArticles(topic, windowStart, windowEnd);
    return {
        topicId: topic.id,
        paperCount: articles.length,
        summaryMarkdown: renderTopicSummaryMarkdown({
            topicName: topic.name,
            windowStart,
            windowEnd,
            articles
        }),
        articles
    };
}

async function runTopicSummary(topic: TopicSubscription, windowStart: Date, windowEnd: Date) {
    const run = await prisma.topicSummaryRun.create({
        data: {
            userId: topic.userId,
            topicId: topic.id,
            windowStart,
            windowEnd
        }
    });

    try {
        const articles = await collectTopicSummaryArticles(topic, windowStart, windowEnd);
        const summaryMarkdown = renderTopicSummaryMarkdown({
            topicName: topic.name,
            windowStart,
            windowEnd,
            articles
        });

        for (const item of articles) {
            await prisma.topicSummaryRunArticle.create({
                data: {
                    runId: run.id,
                    articleId: item.article.id,
                    matchedKeywords: item.matchedKeywords,
                    translatedTitle: item.translatedTitle,
                    translatedAbstract: item.translatedAbstract
                }
            });
        }

        let deliveryStatus: string | null = 'SKIPPED';
        let deliveryError: string | null = null;
        if (topic.deliveryEnabled) {
            const settings = await prisma.userSettings.findUnique({ where: { userId: topic.userId } });
            const sent = settings ? await sendTopicSummaryEmail(settings, topic.name, summaryMarkdown, articles.length) : { ok: false, skipped: true };
            deliveryStatus = sent.ok ? 'SENT' : sent.skipped ? 'SKIPPED' : 'FAILED';
            deliveryError = sent.error || null;
        }

        await prisma.topicSummaryRun.update({
            where: { id: run.id },
            data: {
                status: 'SUCCESS',
                paperCount: articles.length,
                summaryMarkdown,
                deliveryStatus,
                deliveryError
            }
        });

        return {
            runId: run.id,
            topicId: topic.id,
            paperCount: articles.length,
            deliveryStatus
        };
    } catch (error) {
        await prisma.topicSummaryRun.update({
            where: { id: run.id },
            data: {
                status: 'FAILED',
                deliveryError: error instanceof Error ? error.message : String(error)
            }
        });
        throw error;
    }
}

async function collectTopicSummaryArticles(topic: TopicSubscription, windowStart: Date, windowEnd: Date) {
    const [matches, llmConfig] = await Promise.all([
        prisma.topicArticleMatch.findMany({
            where: {
                userId: topic.userId,
                topicId: topic.id,
                createdAt: {
                    gte: windowStart,
                    lt: windowEnd
                }
            },
            include: {
                article: {
                    include: {
                        journal: true
                    }
                }
            },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' }
            ]
        }),
        prisma.userLlmConfig.findUnique({ where: { userId: topic.userId } })
    ]);

    const mode = normalizeTranslateMode(topic.translateMode);
    const articles: SummaryArticle[] = [];
    for (const match of matches) {
        const translatedTitle = await translateText(match.article.title, mode, llmConfig);
        const translatedAbstract = match.article.abstract
            ? await translateText(match.article.abstract.slice(0, 4500), mode, llmConfig)
            : null;

        articles.push({
            article: match.article,
            matchedKeywords: match.matchedKeywords,
            translatedTitle,
            translatedAbstract
        });
    }

    return articles;
}

async function sendTopicSummaryEmail(settings: UserSettings, topicName: string, markdown: string, paperCount: number) {
    if (!settings.emailEnabled || !settings.smtpConfig || !settings.targetEmail) {
        return { ok: false, skipped: true };
    }

    try {
        const nodemailer = await import('nodemailer');
        const config = JSON.parse(settings.smtpConfig);
        const transporter = nodemailer.createTransport(config);
        await transporter.sendMail({
            from: config.from || settings.targetEmail,
            to: settings.targetEmail,
            subject: `[Journal Monitor] ${topicName} 周报：${paperCount} 篇匹配论文`,
            text: markdown,
            html: markdownToHtml(markdown)
        });
        return { ok: true };
    } catch (error) {
        console.error('Failed to send topic summary email', error);
        return {
            ok: false,
            skipped: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
