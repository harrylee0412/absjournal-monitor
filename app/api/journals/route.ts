import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { headers } from 'next/headers';

const prisma = new PrismaClient();

export async function GET(request: Request) {
    // 获取当前用户
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const ranking = searchParams.get('ranking'); // e.g., "4*", "4", "3", etc.
    const isFt50 = searchParams.get('isFt50') === 'true';
    const isUtd24 = searchParams.get('isUtd24') === 'true';
    const isFollowed = searchParams.get('isFollowed') === 'true';

    // 构建查询条件
    const where: any = {};

    if (search) {
        where.title = { contains: search, mode: 'insensitive' };
    }
    if (ranking) {
        where.ajgRanking = ranking;
    }
    if (isFt50) {
        where.isFt50 = true;
    }
    if (isUtd24) {
        where.isUtd24 = true;
    }
    if (isFollowed) {
        where.followers = {
            some: { userId }
        };
    }

    try {
        const journals = await prisma.journal.findMany({
            where,
            take: 100,
            orderBy: { title: 'asc' },
            include: {
                followers: {
                    where: { userId },
                    select: { id: true }
                }
            }
        });

        // 转换为前端格式，添加 isFollowed 字段
        const result = journals.map(j => ({
            ...j,
            isFollowed: j.followers.length > 0,
            followers: undefined // 不返回 followers 数组
        }));

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch journals' }, { status: 500 });
    }
}
