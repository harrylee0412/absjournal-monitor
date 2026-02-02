import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { updateArticlesForUser, sendNewArticlesEmailForUser } from '@/lib/monitor';

const prisma = new PrismaClient();

// GET 请求用于 cron-job.org 调用 (按用户 API Key 验证)
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const apiKey = searchParams.get('apiKey');

    if (!userId || !apiKey) {
        return NextResponse.json({ error: 'Missing userId or apiKey' }, { status: 400 });
    }

    // 验证 API Key
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings || settings.cronApiKey !== apiKey) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    try {
        const newArticles = await updateArticlesForUser(userId);

        if (newArticles.length > 0 && settings.emailEnabled && settings.targetEmail) {
            await sendNewArticlesEmailForUser(newArticles, settings);
        }

        // 更新最后检查时间
        await prisma.userSettings.update({
            where: { userId },
            data: { lastCheckTime: new Date() }
        });

        return NextResponse.json({
            success: true,
            newArticles: newArticles.length,
            message: `Found ${newArticles.length} new articles for user`
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to update articles' }, { status: 500 });
    }
}

// POST 这里的逻辑其实已经被 /api/check-updates 替代了，
// 但为了保持兼容性或者如果有外部 POST 调用，可以保留，同样复用逻辑。
// 这里的 POST 是带 API key 验证的，适合 server-to-server。
export async function POST(request: Request) {
    // 尝试从 Authorization header 获取 userId 和 apiKey
    const authHeader = request.headers.get('authorization');
    let userId: string | null = null;
    let apiKey: string | null = null;

    if (authHeader) {
        const [user, key] = authHeader.split(':');
        userId = user;
        apiKey = key;
    } else {
        // 从 body 获取
        try {
            const body = await request.json();
            userId = body.userId;
            apiKey = body.apiKey;
        } catch {
            return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
        }
    }

    if (!userId || !apiKey) {
        return NextResponse.json({ error: 'Missing userId or apiKey' }, { status: 400 });
    }

    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings || settings.cronApiKey !== apiKey) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    try {
        const newArticles = await updateArticlesForUser(userId);

        if (newArticles.length > 0 && settings.emailEnabled && settings.targetEmail) {
            await sendNewArticlesEmailForUser(newArticles, settings);
        }

        await prisma.userSettings.update({
            where: { userId },
            data: { lastCheckTime: new Date() }
        });

        return NextResponse.json({ success: true, newArticles: newArticles.length });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to update articles' }, { status: 500 });
    }
}
