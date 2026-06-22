import { NextResponse } from 'next/server';
import { JobType } from '@prisma/client';
import { enqueueJob } from '@/lib/jobs';

export const runtime = 'nodejs';

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

    const job = await enqueueJob({
        type: JobType.WEEKLY_TOPIC_SUMMARY,
        payload: { source: 'vercel-cron' }
    });

    return NextResponse.json({
        success: true,
        jobId: job.id,
        status: job.status
    }, { status: 202 });
}

function isAuthorized(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret && process.env.NODE_ENV !== 'production') return true;
    return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}
