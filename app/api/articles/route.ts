import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { headers } from 'next/headers';

const prisma = new PrismaClient();

// 获取用户的文章列表
export async function GET(request: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unread') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    try {
        // 获取用户关注的期刊的文章
        const followedJournalIds = await prisma.userJournalFollow.findMany({
            where: { userId },
            select: { journalId: true }
        });

        const journalIds = followedJournalIds.map(f => f.journalId);

        // 如果用户没有关注任何期刊，返回空
        if (journalIds.length === 0) {
            return NextResponse.json({ data: [], total: 0 });
        }

        // 获取文章及用户的阅读状态
        const articles = await prisma.article.findMany({
            where: {
                journalId: { in: journalIds },
                ...(unreadOnly ? {
                    NOT: {
                        userArticles: {
                            some: { userId, isRead: true }
                        }
                    }
                } : {})
            },
            include: {
                journal: { select: { title: true } },
                userArticles: {
                    where: { userId },
                    select: { isRead: true }
                }
            },
            orderBy: { publicationDate: 'desc' },
            take: limit
        });

        // 转换格式
        const result = articles.map(a => ({
            ...a,
            isRead: a.userArticles[0]?.isRead || false,
            userArticles: undefined
        }));

        return NextResponse.json({ data: result, total: result.length });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to fetch articles' }, { status: 500 });
    }
}

// 更新文章阅读状态
export async function PUT(request: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { ids, isRead } = await request.json();

    try {
        for (const articleId of ids) {
            await prisma.userArticle.upsert({
                where: {
                    userId_articleId: { userId, articleId }
                },
                create: { userId, articleId, isRead },
                update: { isRead }
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update read status' }, { status: 500 });
    }
}
