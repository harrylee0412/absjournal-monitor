import { auth } from '@/lib/auth/server';
import { PrismaClient } from '@prisma/client';
import { fetchNewArticlesForJournal } from '@/lib/crossref';
import { sendNewArticlesEmailForUser } from '@/lib/monitor';

const prisma = new PrismaClient();

export const runtime = 'nodejs';
export const maxDuration = 60; // Allow up to 60 seconds for streaming

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

    // 2. Get followed journals
    const followedJournals = await prisma.userJournalFollow.findMany({
        where: { userId },
        include: { journal: true },
        orderBy: { journalId: 'asc' }
    });

    // 3. Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendMessage = (msg: object) => {
                controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'));
            };

            const allNewArticles: any[] = [];

            sendMessage({
                type: 'start',
                total: followedJournals.length,
                message: `Starting update for ${followedJournals.length} journals...`
            });

            for (let i = 0; i < followedJournals.length; i++) {
                const follow = followedJournals[i];
                const journal = follow.journal;
                const issn = journal.printIssn || journal.eIssn;

                if (!issn) {
                    sendMessage({
                        type: 'skip',
                        index: i + 1,
                        journal: journal.title,
                        reason: 'No ISSN'
                    });
                    continue;
                }

                try {
                    sendMessage({
                        type: 'checking',
                        index: i + 1,
                        journal: journal.title
                    });

                    const articles = await fetchNewArticlesForJournal(issn);
                    let newCount = 0;

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
                                where: { userId_articleId: { userId, articleId: article.id } }
                            });

                            if (!userArticle) {
                                await prisma.userArticle.create({
                                    data: { userId, articleId: article.id, isRead: false }
                                });
                                allNewArticles.push({ ...article, journal });
                                newCount++;
                            }
                        } catch (e) {
                            console.error(`Failed to save article ${work.DOI}`, e);
                        }
                    }

                    sendMessage({
                        type: 'done',
                        index: i + 1,
                        journal: journal.title,
                        newArticles: newCount
                    });
                } catch (jError) {
                    sendMessage({
                        type: 'error',
                        index: i + 1,
                        journal: journal.title,
                        error: 'Failed to fetch'
                    });
                    console.error(`Failed to update journal ${journal.title}`, jError);
                }
            }

            // 4. Update last check time
            await prisma.userSettings.update({
                where: { userId },
                data: { lastCheckTime: new Date() }
            }).catch(() => { });

            // 5. Send email if enabled and new articles found
            if (allNewArticles.length > 0) {
                const settings = await prisma.userSettings.findUnique({ where: { userId } });
                if (settings?.emailEnabled && settings?.targetEmail) {
                    await sendNewArticlesEmailForUser(allNewArticles, settings);
                }
            }

            sendMessage({
                type: 'complete',
                totalNewArticles: allNewArticles.length,
                message: `Update complete! Found ${allNewArticles.length} new articles.`
            });

            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
