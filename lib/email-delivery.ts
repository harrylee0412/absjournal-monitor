import { PrismaClient } from '@prisma/client';
import { format } from 'date-fns';
import { sendEmail } from '@/lib/email-provider';
import { markdownToHtml } from '@/lib/topic-summary';

export type EmailDeliveryPayload =
    | {
        kind: 'NEW_ARTICLES';
        userId: string;
        articleIds: number[];
    }
    | {
        kind: 'TOPIC_SUMMARY';
        userId: string;
        runId: number;
        topicName: string;
        markdown: string;
        paperCount: number;
    };

export async function deliverEmailJob(prisma: PrismaClient, payload: EmailDeliveryPayload) {
    if (payload.kind === 'NEW_ARTICLES') {
        return deliverNewArticlesEmail(prisma, payload.userId, payload.articleIds);
    }

    return deliverTopicSummaryEmail(prisma, payload);
}

async function deliverNewArticlesEmail(prisma: PrismaClient, userId: string, articleIds: number[]) {
    if (articleIds.length === 0) return { skipped: true, reason: 'No articles' };

    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings?.emailEnabled || !settings.targetEmail) {
        return { skipped: true, reason: 'Email disabled or missing target email' };
    }

    const articles = await prisma.article.findMany({
        where: { id: { in: articleIds } },
        include: { journal: true },
        orderBy: [
            { publicationDate: 'desc' },
            { createdAt: 'desc' }
        ]
    });

    if (articles.length === 0) return { skipped: true, reason: 'Articles not found' };

    const htmlContent = `
    <h1>Journal Monitor Update</h1>
    <p>Found ${articles.length} new articles for you:</p>
    <ul>
      ${articles.map(a => `
        <li style="margin-bottom: 15px;">
          <strong><a href="${escapeHtml(a.url || `https://doi.org/${a.doi}`)}">${escapeHtml(a.title)}</a></strong><br/>
          <em style="color: #666;">${escapeHtml(a.authors || 'Unknown Authors')}</em><br/>
          <span style="font-size: 0.9em; color: #888;">${escapeHtml(a.journal?.title || 'Journal')}</span><br/>
          <span style="font-size: 0.85em; color: #999;">Published: ${a.publicationDate ? format(new Date(a.publicationDate), 'yyyy-MM-dd') : 'Unknown'}</span>
        </li>
      `).join('')}
    </ul>
    <p style="font-size: 12px; color: #999;">This email was sent automatically by Journal Monitor</p>
  `;

    const result = await sendEmail({
        targetEmail: settings.targetEmail,
        smtpConfig: settings.smtpConfig,
        message: {
            subject: `[Journal Monitor] ${articles.length} New Articles Found`,
            html: htmlContent
        }
    });

    return { ...result, articleCount: articles.length };
}

async function deliverTopicSummaryEmail(
    prisma: PrismaClient,
    payload: Extract<EmailDeliveryPayload, { kind: 'TOPIC_SUMMARY' }>
) {
    const settings = await prisma.userSettings.findUnique({ where: { userId: payload.userId } });
    if (!settings?.emailEnabled || !settings.targetEmail) {
        await prisma.topicSummaryRun.update({
            where: { id: payload.runId },
            data: { deliveryStatus: 'SKIPPED' }
        }).catch(() => undefined);
        return { skipped: true, reason: 'Email disabled or missing target email' };
    }

    try {
        const result = await sendEmail({
            targetEmail: settings.targetEmail,
            smtpConfig: settings.smtpConfig,
            message: {
                subject: `[Journal Monitor] ${payload.topicName} 周报：${payload.paperCount} 篇匹配论文`,
                text: payload.markdown,
                html: markdownToHtml(payload.markdown)
            }
        });

        await prisma.topicSummaryRun.update({
            where: { id: payload.runId },
            data: { deliveryStatus: 'SENT', deliveryError: null }
        });
        return { ...result, paperCount: payload.paperCount };
    } catch (error) {
        await prisma.topicSummaryRun.update({
            where: { id: payload.runId },
            data: {
                deliveryStatus: 'FAILED',
                deliveryError: error instanceof Error ? error.message : String(error)
            }
        }).catch(() => undefined);
        throw error;
    }
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
