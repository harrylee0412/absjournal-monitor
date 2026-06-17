import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';

const prisma = new PrismaClient();

export async function GET() {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const runs = await prisma.topicSummaryRun.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        include: {
            topic: {
                select: { id: true, name: true }
            }
        },
        take: 100
    });

    return NextResponse.json({ data: runs });
}
