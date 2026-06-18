import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { normalizeTranslateMode } from '@/lib/translator';
import { splitKeywords } from '@/lib/topics';

const prisma = new PrismaClient();

export async function GET() {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const topics = await prisma.topicSubscription.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        include: {
            _count: {
                select: {
                    matches: true,
                    summaryRuns: true
                }
            },
            summaryRuns: {
                orderBy: { createdAt: 'desc' },
                take: 1
            }
        }
    });

    return NextResponse.json({ data: topics });
}

export async function POST(request: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const keywords = splitKeywords(body.keywords);

    if (!name) {
        return NextResponse.json({ error: 'Topic name is required' }, { status: 400 });
    }
    if (keywords.length === 0) {
        return NextResponse.json({ error: 'At least one keyword is required' }, { status: 400 });
    }

    const existing = await prisma.topicSubscription.findFirst({
        where: {
            userId: session.user.id,
            name: { equals: name, mode: 'insensitive' }
        }
    });
    if (existing) {
        return NextResponse.json({ data: existing, reused: true });
    }

    const topic = await prisma.topicSubscription.create({
        data: {
            userId: session.user.id,
            name,
            keywords,
            enabled: body.enabled !== false,
            translateMode: normalizeTranslateMode(body.translateMode),
            deliveryEnabled: body.deliveryEnabled !== false
        }
    });

    return NextResponse.json({ data: topic }, { status: 201 });
}
