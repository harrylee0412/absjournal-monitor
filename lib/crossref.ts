import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { subMonths, format } from 'date-fns';

const prisma = new PrismaClient();

const CROSSREF_API_URL = 'https://api.crossref.org/works';

interface CrossRefWork {
    DOI: string;
    title: string[];
    author?: { given?: string; family?: string }[];
    abstract?: string;
    created: { 'date-time': string };
    URL: string;
}

export async function fetchNewArticlesForJournal(issn: string, fromDate?: Date) {
    // Default to 1 month ago if not provided
    const filterDate = fromDate || subMonths(new Date(), 1);
    const dateStr = format(filterDate, 'yyyy-MM-dd');

    // Filter by ISSN and from-created-date
    const filter = `issn:${issn},from-created-date:${dateStr}`;

    try {
        const response = await axios.get(CROSSREF_API_URL, {
            params: {
                filter: filter,
                rows: 50,
                sort: 'created',
                order: 'desc'
            },
            headers: {
                'User-Agent': `JournalMonitor/1.0 (mailto:${process.env.CROSSREF_CONTACT_EMAIL || 'test@test.com'})`
            }
        });

        const items = response.data?.message?.items as CrossRefWork[];
        return items || [];
    } catch (error) {
        console.error(`Error fetching for ISSN ${issn}:`, error);
        return [];
    }
}

export async function updateArticlesForFollowedJournals() {
    const followedJournals = await prisma.journal.findMany({
        where: { isFollowed: true }
    });

    console.log(`Checking updates for ${followedJournals.length} followed journals...`);

    const newArticles = [];

    for (const journal of followedJournals) {
        // Prefer print ISSN, fallback to E-ISSN
        const issn = journal.printIssn || journal.eIssn;
        if (!issn) continue;

        const articles = await fetchNewArticlesForJournal(issn);

        for (const work of articles) {
            try {
                const doi = work.DOI;
                const title = work.title?.[0] || 'No Title';
                const authors = work.author?.map(a => `${a.given} ${a.family}`).join(', ') || '';
                const abstract = work.abstract || '';
                const pubDate = new Date(work.created['date-time']);
                const url = work.URL;

                const existing = await prisma.article.findUnique({ where: { doi } });

                if (!existing) {
                    const created = await prisma.article.create({
                        data: {
                            doi,
                            title,
                            authors,
                            abstract,
                            publicationDate: pubDate,
                            url,
                            journalId: journal.id
                        },
                        include: { journal: true }
                    });
                    newArticles.push(created);
                }
            } catch (e) {
                console.error(`Failed to save article ${work.DOI}`, e);
            }
        }
    }

    return newArticles;
}
