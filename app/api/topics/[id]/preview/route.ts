import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server';
import { previewTopicSummary } from '@/lib/topic-runs';

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const topicId = Number.parseInt(id, 10);
    if (!Number.isFinite(topicId)) {
        return NextResponse.json({ error: 'Invalid topic id' }, { status: 400 });
    }

    try {
        const preview = await previewTopicSummary(session.user.id, topicId);
        return NextResponse.json(preview);
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Failed to preview topic'
        }, { status: 500 });
    }
}
