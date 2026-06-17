import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { normalizeTranslateMode } from '@/lib/translator';
import { backfillTopicMatchesForUser, splitKeywords } from '@/lib/topics';

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
    const topicId = Number.parseInt(id, 10);
    if (!Number.isFinite(topicId)) {
        return NextResponse.json({ error: 'Invalid topic id' }, { status: 400 });
    }

    const topic = await prisma.topicSubscription.findFirst({
        where: { id: topicId, userId: session.user.id },
        include: {
            matches: {
                orderBy: { createdAt: 'desc' },
                take: 25,
                include: {
                    article: {
                        include: { journal: true }
                    }
                }
            },
            summaryRuns: {
                orderBy: { createdAt: 'desc' },
                take: 10
            }
        }
    });

    if (!topic) {
        return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    return NextResponse.json({ data: topic });
}

export async function PATCH(
    request: Request,
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

    const existing = await prisma.topicSubscription.findFirst({
        where: { id: topicId, userId: session.user.id }
    });
    if (!existing) {
        return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const keywords = body.keywords === undefined ? existing.keywords : splitKeywords(body.keywords);
    const nextName = body.name === undefined ? existing.name : String(body.name || '').trim();
    if (!nextName) {
        return NextResponse.json({ error: 'Topic name is required' }, { status: 400 });
    }
    if (keywords.length === 0) {
        return NextResponse.json({ error: 'At least one keyword is required' }, { status: 400 });
    }

    const topic = await prisma.topicSubscription.update({
        where: { id: topicId },
        data: {
            name: nextName,
            keywords,
            enabled: body.enabled === undefined ? existing.enabled : Boolean(body.enabled),
            translateMode: body.translateMode === undefined ? existing.translateMode : normalizeTranslateMode(body.translateMode),
            deliveryEnabled: body.deliveryEnabled === undefined ? existing.deliveryEnabled : Boolean(body.deliveryEnabled)
        }
    });
    await backfillTopicMatchesForUser(prisma, session.user.id, topic.id);

    return NextResponse.json({ data: topic });
}

export async function DELETE(
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

    const existing = await prisma.topicSubscription.findFirst({
        where: { id: topicId, userId: session.user.id }
    });
    if (!existing) {
        return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    await prisma.topicSubscription.delete({ where: { id: topicId } });
    return NextResponse.json({ success: true });
}
