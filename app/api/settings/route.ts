import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { headers } from 'next/headers';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

export async function GET() {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    try {
        let settings = await prisma.userSettings.findUnique({ where: { userId } });

        // 如果不存在，创建默认设置
        if (!settings) {
            settings = await prisma.userSettings.create({
                data: {
                    userId,
                    cronApiKey: randomBytes(16).toString('hex') // 生成随机 API Key
                }
            });
        }

        return NextResponse.json(settings);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    try {
        const data = await request.json();

        const settings = await prisma.userSettings.upsert({
            where: { userId },
            create: {
                userId,
                emailEnabled: data.emailEnabled,
                targetEmail: data.targetEmail,
                smtpConfig: data.smtpConfig,
                preferredHour: data.preferredHour ?? 0,
                zoteroUserId: data.zoteroUserId ?? undefined,
                zoteroApiKey: data.zoteroApiKey ?? undefined,
                cronApiKey: randomBytes(16).toString('hex')
            },
            update: {
                emailEnabled: data.emailEnabled,
                targetEmail: data.targetEmail,
                smtpConfig: data.smtpConfig,
                preferredHour: data.preferredHour ?? undefined,
                zoteroUserId: data.zoteroUserId ?? undefined,
                zoteroApiKey: data.zoteroApiKey ?? undefined,
            }
        });

        return NextResponse.json(settings);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }
}
