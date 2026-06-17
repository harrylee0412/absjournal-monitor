import { NextResponse } from 'next/server';
import { runWeeklyTopicSummaries } from '@/lib/topic-runs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
    return run(request);
}

export async function POST(request: Request) {
    return run(request);
}

async function run(request: Request) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const results = await runWeeklyTopicSummaries();
        return NextResponse.json({
            success: true,
            topicsProcessed: results.length,
            results
        });
    } catch (error) {
        console.error('Weekly summaries failed', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Weekly summaries failed'
        }, { status: 500 });
    }
}

function isAuthorized(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret && process.env.NODE_ENV !== 'production') return true;
    return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}
