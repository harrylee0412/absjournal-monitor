import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { encryptSecret } from '@/lib/crypto';

const prisma = new PrismaClient();

export async function GET() {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await prisma.userLlmConfig.findUnique({
        where: { userId: session.user.id }
    });

    if (!config) {
        return NextResponse.json({ data: null });
    }

    return NextResponse.json({
        data: {
            provider: config.provider,
            endpoint: config.endpoint,
            model: config.model,
            hasApiKey: true,
            updatedAt: config.updatedAt
        }
    });
}

export async function PATCH(request: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const endpoint = String(body.endpoint || '').trim();
    const model = String(body.model || '').trim();
    const apiKey = String(body.apiKey || '').trim();

    const existing = await prisma.userLlmConfig.findUnique({
        where: { userId: session.user.id }
    });

    if (!endpoint || !model) {
        return NextResponse.json({ error: 'Endpoint and model are required' }, { status: 400 });
    }
    if (!existing && !apiKey) {
        return NextResponse.json({ error: 'API key is required for the first save' }, { status: 400 });
    }

    const config = await prisma.userLlmConfig.upsert({
        where: { userId: session.user.id },
        create: {
            userId: session.user.id,
            provider: 'openai-compatible',
            endpoint,
            model,
            encryptedApiKey: encryptSecret(apiKey)
        },
        update: {
            endpoint,
            model,
            ...(apiKey ? { encryptedApiKey: encryptSecret(apiKey) } : {})
        }
    });

    return NextResponse.json({
        data: {
            provider: config.provider,
            endpoint: config.endpoint,
            model: config.model,
            hasApiKey: true,
            updatedAt: config.updatedAt
        }
    });
}
