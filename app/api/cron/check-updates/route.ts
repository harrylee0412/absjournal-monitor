import { NextResponse } from 'next/server';
import { JobType, PrismaClient } from '@prisma/client';
import { enqueueJob } from '@/lib/jobs';

const prisma = new PrismaClient();

export const runtime = 'nodejs';

export async function GET(request: Request) {
    return run(request);
}

export async function POST(request: Request) {
    return run(request);
}

async function run(request: Request) {
    if (isAuthorized(request)) {
        const job = await enqueueJob({
            type: JobType.DAILY_JOURNAL_FETCH,
            payload: { source: 'vercel-cron' }
        });

        return NextResponse.json({
            success: true,
            jobId: job.id,
            status: job.status
        }, { status: 202 });
    }

    const legacy = await enqueueLegacyUserJob(request);
    if (legacy) return legacy;

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function isAuthorized(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret && process.env.NODE_ENV !== 'production') return true;
    return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

async function enqueueLegacyUserJob(request: Request) {
    const url = new URL(request.url);
    let userId = url.searchParams.get('userId');
    let apiKey = url.searchParams.get('apiKey');

    if (request.method === 'POST' && (!userId || !apiKey)) {
        const authHeader = request.headers.get('authorization');
        if (authHeader?.includes(':')) {
            const [user, key] = authHeader.split(':');
            userId = user;
            apiKey = key;
        } else {
            const body = await request.json().catch(() => ({}));
            userId = typeof body.userId === 'string' ? body.userId : userId;
            apiKey = typeof body.apiKey === 'string' ? body.apiKey : apiKey;
        }
    }

    if (!userId || !apiKey) return null;

    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings || settings.cronApiKey !== apiKey) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const job = await enqueueJob({
        type: JobType.USER_CHECK_UPDATE,
        userId,
        payload: { userId, source: 'legacy-cron' }
    }, prisma);

    return NextResponse.json({
        success: true,
        jobId: job.id,
        status: job.status
    }, { status: 202 });
}
