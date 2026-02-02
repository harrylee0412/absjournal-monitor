import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const settings = await prisma.settings.findFirst();
        return NextResponse.json(settings || {});
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const data = await request.json();

        // Check if exists
        const existing = await prisma.settings.findFirst();

        let settings;
        if (existing) {
            settings = await prisma.settings.update({
                where: { id: existing.id },
                data: {
                    emailEnabled: data.emailEnabled,
                    targetEmail: data.targetEmail,
                    smtpConfig: data.smtpConfig, // Expected to be JSON string already or handled by client
                }
            });
        } else {
            settings = await prisma.settings.create({
                data: {
                    emailEnabled: data.emailEnabled,
                    targetEmail: data.targetEmail,
                    smtpConfig: data.smtpConfig,
                }
            });
        }

        return NextResponse.json(settings);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }
}
