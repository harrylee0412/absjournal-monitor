import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { updateArticlesForUser, sendNewArticlesEmailForUser } from '@/lib/monitor';

const prisma = new PrismaClient();

// GET 请求用于 cron-job.org 调用 (按用户 API Key 验证)
export async function GET(request: Request) {
    // 检查是否为系统级 Cron 调用 (Bear Token)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // 如果有 CRON_SECRET 且匹配，执行全站更新
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        try {
            // 获取所有开启了邮件通知或者只是注册了的用户(从 UserSettings 表获取)
            // updateArticlesForUser 内部会处理邮件发送，所以这里只需要遍历用户
            const users = await prisma.userSettings.findMany({
                select: { userId: true }
            });

            console.log(`Starting system-wide update for ${users.length} users...`);

            // 串行或并发处理所有用户
            let updatedCount = 0;
            for (const user of users) {
                try {
                    await updateArticlesForUser(user.userId);
                    updatedCount++;
                } catch (uError) {
                    console.error(`Failed to update for user ${user.userId}`, uError);
                }
            }

            return NextResponse.json({ success: true, mode: 'system', usersProcessed: updatedCount });
        } catch (error) {
            console.error('System update failed', error);
            return NextResponse.json({ error: 'System update failed' }, { status: 500 });
        }
    }

    // 个人用户 API Key 验证模式
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const apiKey = searchParams.get('apiKey');

    if (!userId || !apiKey) {
        return NextResponse.json({ error: 'Missing userId or apiKey, and invalid CRON_SECRET' }, { status: 401 });
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
