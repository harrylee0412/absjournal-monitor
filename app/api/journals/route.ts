import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const ranking = searchParams.get('ranking'); // '4*', '3', etc.
    const isFollowed = searchParams.get('isFollowed');

    const where: any = {};

    if (search) {
        where.title = { contains: search }; // SQLite is case-insensitive usually, but Prisma depends. 
        // Usually need mode: 'insensitive' for Postgres, but for SQLite default depends on collation. 
        // Leaving simple for now.
    }

    if (ranking) {
        where.ajgRanking = ranking;
    }

    if (isFollowed === 'true') {
        where.isFollowed = true;
    }

    // Handle boolean filters like isFt50, isUtd24 if passed
    const isFt50 = searchParams.get('isFt50');
    if (isFt50 === 'true') where.isFt50 = true;

    const isUtd24 = searchParams.get('isUtd24');
    if (isUtd24 === 'true') where.isUtd24 = true;

    try {
        const journals = await prisma.journal.findMany({
            where,
            orderBy: { title: 'asc' },
            take: 100 // Limit for performance
        });

        return NextResponse.json(journals);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch journals' }, { status: 500 });
    }
}
