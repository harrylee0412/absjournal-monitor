import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';

const prisma = new PrismaClient();

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const runId = Number.parseInt(id, 10);
    if (!Number.isFinite(runId)) {
        return NextResponse.json({ error: 'Invalid report id' }, { status: 400 });
    }

    const run = await prisma.topicSummaryRun.findFirst({
        where: { id: runId, userId: session.user.id },
        include: {
            topic: true,
            articles: {
                include: {
                    article: {
                        include: { journal: true }
                    }
                },
                orderBy: { id: 'asc' }
            }
        }
    });

    if (!run) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    return NextResponse.json({ data: run });
}
