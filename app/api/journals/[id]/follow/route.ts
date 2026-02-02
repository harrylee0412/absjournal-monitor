import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // In Next.js 15+, params is a Promise, better to await it. 
    // However, older Next 14 is sync or async dependent on precise version.
    // The user install was 'latest' which is 16.1.6. params is definitely a Promise now.

    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);

    try {
        const { isFollowed } = await request.json();

        const journal = await prisma.journal.update({
            where: { id },
            data: { isFollowed },
        });

        return NextResponse.json(journal);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to update journal' }, { status: 500 });
    }
}
