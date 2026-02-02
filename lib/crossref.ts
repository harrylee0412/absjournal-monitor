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


