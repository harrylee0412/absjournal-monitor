import { NextResponse } from 'next/server';
import { JobType } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { enqueueJob } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST() {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const job = await enqueueJob({
        type: JobType.USER_CHECK_UPDATE,
        userId: session.user.id,
        payload: { userId: session.user.id, source: 'manual' }
    });

    return NextResponse.json({
        jobId: job.id,
        status: job.status
    }, { status: 202 });
}
