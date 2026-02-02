import { PrismaClient } from '@prisma/client';
import { fetchNewArticlesForJournal } from '@/lib/crossref';

const prisma = new PrismaClient();

// 为特定用户更新文章
export async function updateArticlesForUser(userId: string) {
    const followedJournals = await prisma.userJournalFollow.findMany({
        where: { userId },
        include: { journal: true }
    });

    console.log(`Checking updates for ${followedJournals.length} journals (user: ${userId})...`);

    const newArticles: any[] = [];

    // Concurrency limit to avoid overwhelming the server or reaching timeouts
    const MAX_CONCURRENT = 5;
    const results = [];

    // Split into chunks or use a pool
    const processFollow = async (follow: any) => {
        const journal = follow.journal;
        const issn = journal.printIssn || journal.eIssn;
        if (!issn) return [];

        const journalNewArticles = [];
        try {
            const articles = await fetchNewArticlesForJournal(issn);
            for (const work of articles) {
                try {
                    const doi = work.DOI;
                    const title = work.title?.[0] || 'No Title';
                    const authors = work.author?.map((a: any) => `${a.given} ${a.family}`).join(', ') || '';
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
                        journalNewArticles.push({ ...article, journal });
                    }
                } catch (e) {
                    console.error(`Failed to save article ${work.DOI}`, e);
                }
            }
        } catch (jError) {
            console.error(`Failed to update journal ${journal.title}`, jError);
        }
        return journalNewArticles;
    };

    // Execute in batches
    for (let i = 0; i < followedJournals.length; i += MAX_CONCURRENT) {
        const chunk = followedJournals.slice(i, i + MAX_CONCURRENT);
        const chunkResults = await Promise.all(chunk.map(processFollow));
        chunkResults.forEach(r => newArticles.push(...r));
    }

    return newArticles;
}

// 发送邮件给特定用户
export async function sendNewArticlesEmailForUser(newArticles: any[], settings: any) {
    if (!settings.smtpConfig || !settings.targetEmail) return;

    // 动态导入 nodemailer，避免在非 Node 环境报错（虽然这里是在 Server 上）
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
    <p>为您找到 ${newArticles.length} 篇新文章：</p>
    <ul>
      ${newArticles.map(a => `
        <li style="margin-bottom: 10px;">
          <strong><a href="${a.url || `http://doi.org/${a.doi}`}">${a.title}</a></strong><br/>
          <em style="color: #666;">${a.authors || 'Unknown Authors'}</em><br/>
          <span style="font-size: 0.9em; color: #888;">${a.journal?.title || 'Journal'}</span>
        </li>
      `).join('')}
    </ul>
    <p style="font-size: 12px; color: #999;">此邮件由 Journal Monitor 自动发送</p>
  `;

    try {
        await transporter.sendMail({
            from: fromEmail,
            to: settings.targetEmail,
            subject: `[Journal Monitor] ${newArticles.length} 新文章推送`,
            html: htmlContent
        });
        console.log(`Email sent to ${settings.targetEmail}`);
    } catch (e) {
        console.error("Failed to send email", e);
    }
}
