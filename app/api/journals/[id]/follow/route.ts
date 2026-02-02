import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { headers } from 'next/headers';

const prisma = new PrismaClient();

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // 获取当前用户
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { id } = await params;
    const journalId = parseInt(id);
    const { isFollowed } = await request.json();

    try {
        if (isFollowed) {
            // Check limit
            const count = await prisma.userJournalFollow.count({ where: { userId } });
            if (count >= 30) {
                return NextResponse.json({ error: 'Limit reached: You can follow up to 30 journals.' }, { status: 400 });
            }

            // 关注期刊
            await prisma.userJournalFollow.upsert({
                where: {
                    userId_journalId: { userId, journalId }
                },
                create: { userId, journalId },
                update: {}
            });
        } else {
            // 取消关注
            await prisma.userJournalFollow.deleteMany({
                where: { userId, journalId }
            });
        }

        return NextResponse.json({ success: true, isFollowed });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update follow status' }, { status: 500 });
    }
}
