import { auth } from '@/lib/auth/server';
import { PrismaClient } from '@prisma/client';
import { fetchNewArticlesForJournal } from '@/lib/crossref';
import { sendNewArticlesEmailForUser } from '@/lib/monitor';

const prisma = new PrismaClient();

export const runtime = 'nodejs';
export const maxDuration = 60;

// Process 10 journals per request to stay well under timeout
const BATCH_SIZE = 10;

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
        const body = await request.json();
        startIndex = body.startIndex || 0;
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
            const sendMessage = (msg: object) => {
                controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'));
            };

            const batchNewArticles: any[] = [];

            sendMessage({
                type: 'batch_start',
                startIndex,
                endIndex,
                total: totalJournals,
                message: startIndex === 0
                    ? `Starting update for ${totalJournals} journals...`
                    : `Continuing from journal ${startIndex + 1}...`
            });

            for (let i = 0; i < batch.length; i++) {
                const globalIndex = startIndex + i + 1;
                const follow = batch[i];
                const journal = follow.journal;
                const issn = journal.printIssn || journal.eIssn;

                if (!issn) {
                    sendMessage({
                        type: 'skip',
                        index: globalIndex,
                        journal: journal.title,
                        reason: 'No ISSN'
                    });
                    continue;
                }

                try {
                    sendMessage({
                        type: 'checking',
                        index: globalIndex,
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
                                batchNewArticles.push({ ...article, journal });
                                newCount++;
                            }
                        } catch (e) {
                            console.error(`Failed to save article ${work.DOI}`, e);
                        }
                    }

                    sendMessage({
                        type: 'done',
                        index: globalIndex,
                        journal: journal.title,
                        newArticles: newCount
                    });
                } catch (jError) {
                    sendMessage({
                        type: 'error',
                        index: globalIndex,
                        journal: journal.title,
                        error: 'Failed to fetch'
                    });
                    console.error(`Failed to update journal ${journal.title}`, jError);
                }
            }

            const hasMore = endIndex < totalJournals;
            const isComplete = !hasMore;

            // Update last check time only when fully complete
            if (isComplete) {
                await prisma.userSettings.update({
                    where: { userId },
                    data: { lastCheckTime: new Date() }
                }).catch(() => { });
            }

            // Send batch completion signal
            sendMessage({
                type: 'batch_complete',
                batchNewArticles: batchNewArticles.length,
                nextIndex: hasMore ? endIndex : null,
                hasMore,
                message: hasMore
                    ? `Batch complete (${batchNewArticles.length} new). Continuing...`
                    : `🎉 All done! Found ${batchNewArticles.length} new articles in this batch.`
            });

            // If complete and has new articles, send email
            if (isComplete && batchNewArticles.length > 0) {
                const settings = await prisma.userSettings.findUnique({ where: { userId } });
                if (settings?.emailEnabled && settings?.targetEmail) {
                    await sendNewArticlesEmailForUser(batchNewArticles, settings);
                }
            }

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
