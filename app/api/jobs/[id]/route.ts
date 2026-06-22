import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server';
import { getJobForUser } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const jobId = Number.parseInt(id, 10);
    if (!Number.isFinite(jobId)) {
        return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }

    const job = await getJobForUser(jobId, session.user.id);
    if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({
        data: {
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            lastError: job.lastError,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            terminal: job.status === 'SUCCESS' || job.status === 'FAILED'
        }
    });
}
