import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unread') === 'true';
    const journalId = searchParams.get('journalId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const where: any = {};

    if (unreadOnly) {
        where.isRead = false;
    }

    if (journalId) {
        where.journalId = parseInt(journalId, 10);
    }

    try {
        const articles = await prisma.article.findMany({
            where,
            orderBy: { publicationDate: 'desc' }, // or createdAt
            take: limit,
            skip: (page - 1) * limit,
            include: {
                journal: true // distinct selection might be better for bandwidth, but title is needed
            }
        });

        const total = await prisma.article.count({ where });

        return NextResponse.json({
            data: articles,
            metadata: {
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch articles' }, { status: 500 });
    }
}

// Also add PUT to mark as read
export async function PUT(request: Request) {
    try {
        const { ids, isRead } = await request.json(); // ids: number[]
        if (!Array.isArray(ids)) return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });

        await prisma.article.updateMany({
            where: {
                id: { in: ids }
            },
            data: { isRead }
        });

        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: 'Failed to update articles' }, { status: 500 });
    }
}
