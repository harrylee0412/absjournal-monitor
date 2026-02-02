import { NextResponse } from 'next/server';
import { updateArticlesForUser, sendNewArticlesEmailForUser } from '@/lib/monitor';
import { auth } from '@/lib/auth/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
    try {
        // 1. 验证用户 Session
        const { data: session } = await auth.getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = session.user.id;

        // 2. 调用核心逻辑
        const newArticles = await updateArticlesForUser(userId);

        // 3. 如果需要，发送邮件（获取用户设置）
        if (newArticles.length > 0) {
            const settings = await prisma.userSettings.findUnique({ where: { userId } });
            if (settings?.emailEnabled && settings?.targetEmail) {
                await sendNewArticlesEmailForUser(newArticles, settings);
            }
        }

        // 4. 更新最后检查时间
        await prisma.userSettings.update({
            where: { userId },
            data: { lastCheckTime: new Date() } // createIfNotExists is not available in update, assume triggered after settings created
        }).catch(() => { }); // catch error if settings don't exist yet

        return NextResponse.json({ success: true, newArticles: newArticles.length });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to update articles' }, { status: 500 });
    }
}
