import { NextResponse } from 'next/server';
import { updateArticlesForFollowedJournals } from '@/lib/crossref';
import { sendNewArticlesEmail } from '@/lib/email';

export async function POST(request: Request) {
    try {
        // Cast to any because the lib now returns array
        const newArticles: any[] = await updateArticlesForFollowedJournals();

        if (newArticles.length > 0) {
            await sendNewArticlesEmail(newArticles);
        }

        return NextResponse.json({ success: true, newArticles: newArticles.length });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to update articles' }, { status: 500 });
    }
}
