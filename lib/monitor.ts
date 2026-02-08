import { PrismaClient } from '@prisma/client';
import { fetchNewArticlesForJournal } from '@/lib/crossref';
import { format } from 'date-fns';

const prisma = new PrismaClient();

// Maximum journals to process per cron invocation (Safe limit: 2 to prevent 10s timeout)
const BATCH_SIZE = 2;

// Update articles for a specific user (batch processing)
export async function updateArticlesForUser(userId: string, options?: { batchSize?: number, ignoreIndex?: boolean }) {
    // Get user settings for batch tracking
    const settings = await prisma.userSettings.findUnique({ where: { userId } });

    // Determine start index: 0 if ignoring index (full update), otherwise use DB value
    const startIndex = options?.ignoreIndex ? 0 : (settings?.lastProcessedJournalIndex || 0);

    const followedJournals = await prisma.userJournalFollow.findMany({
        where: { userId },
        include: { journal: true },
        orderBy: { journalId: 'asc' }
    });

    const limit = options?.batchSize || BATCH_SIZE;

    console.log(`User ${userId}: Processing journals ${startIndex} to ${startIndex + limit - 1} of ${followedJournals.length}`);

    // Get batch to process
    const batch = followedJournals.slice(startIndex, startIndex + limit);
    const newArticles: any[] = [];

    for (const follow of batch) {
        const journal = follow.journal;
        const issn = journal.printIssn || journal.eIssn;
        if (!issn) continue;

        try {
            const articles = await fetchNewArticlesForJournal(issn);
            for (const work of articles) {
                try {
                    const doi = work.DOI;
                    const title = work.title?.[0] || 'No Title';
                    const authors = work.author?.map((a: any) => `${a.given || ''} ${a.family || ''}`).join(', ') || '';
                    const abstract = work.abstract || '';
                    const pubDate = new Date(work.created['date-time']);
                    const url = work.URL;

                    let article = await prisma.article.findUnique({ where: { doi } });

                    if (!article) {
                        article = await prisma.article.create({
                            data: { doi, title, authors, abstract, publicationDate: pubDate, url, journalId: journal.id }
                        });
                    }

                    const userArticle = await prisma.userArticle.findUnique({
                        where: {
                            userId_articleId: { userId, articleId: article.id }
                        }
                    });

                    if (!userArticle) {
                        await prisma.userArticle.create({
                            data: { userId, articleId: article.id, isRead: false }
                        });
                        newArticles.push({ ...article, journal });
                    }
                } catch (e) {
                    console.error(`Failed to save article ${work.DOI}`, e);
                }
            }
        } catch (jError) {
            console.error(`Failed to update journal ${journal.title}`, jError);
        }
    }

    // Only update batch index if NOT ignoring index (i.e. Vercel mode)
    if (!options?.ignoreIndex) {
        const nextIndex = startIndex + limit >= followedJournals.length ? 0 : startIndex + limit;
        const isComplete = nextIndex === 0 && startIndex !== 0;

        await prisma.userSettings.update({
            where: { userId },
            data: {
                lastProcessedJournalIndex: nextIndex,
                lastCheckTime: isComplete ? new Date() : undefined
            }
        });
        console.log(`User ${userId}: Batch complete. Next index: ${nextIndex}.`);
    } else {
        // For full update, just update check time
        await prisma.userSettings.update({
            where: { userId },
            data: { lastCheckTime: new Date() }
        });
        console.log(`User ${userId}: Full update complete.`);
    }

    return newArticles;
}

// Send email to a specific user
export async function sendNewArticlesEmailForUser(newArticles: any[], settings: any) {
    if (!settings.smtpConfig || !settings.targetEmail) return;

    const nodemailer = await import('nodemailer');

    let transporter;
    let fromEmail = settings.targetEmail;

    try {
        const config = JSON.parse(settings.smtpConfig);
        transporter = nodemailer.createTransport(config);
        if (config.from) fromEmail = config.from;
    } catch (e) {
        console.error("Invalid SMTP config", e);
        return;
    }

    const htmlContent = `
    <h1>Journal Monitor Update</h1>
    <p>Found ${newArticles.length} new articles for you:</p>
    <ul>
      ${newArticles.map(a => `
        <li style="margin-bottom: 15px;">
          <strong><a href="${a.url || `https://doi.org/${a.doi}`}">${a.title}</a></strong><br/>
          <em style="color: #666;">${a.authors || 'Unknown Authors'}</em><br/>
          <span style="font-size: 0.9em; color: #888;">${a.journal?.title || 'Journal'}</span><br/>
          <span style="font-size: 0.85em; color: #999;">Published: ${a.publicationDate ? format(new Date(a.publicationDate), 'yyyy-MM-dd') : 'Unknown'}</span>
        </li>
      `).join('')}
    </ul>
    <p style="font-size: 12px; color: #999;">This email was sent automatically by Journal Monitor</p>
  `;

    try {
        await transporter.sendMail({
            from: fromEmail,
            to: settings.targetEmail,
            subject: `[Journal Monitor] ${newArticles.length} New Articles Found`,
            html: htmlContent
        });
        console.log(`Email sent to ${settings.targetEmail}`);
    } catch (e) {
        console.error("Failed to send email", e);
    }
}
