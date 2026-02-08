import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';

const prisma = new PrismaClient();

export async function GET(request: Request) {
    // Get current user
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const ranking = searchParams.get('ranking');
    const domain = searchParams.get('domain');
    const isFt50 = searchParams.get('isFt50') === 'true';
    const isUtd24 = searchParams.get('isUtd24') === 'true';
    const isFollowed = searchParams.get('isFollowed') === 'true';
    const getDomains = searchParams.get('getDomains') === 'true';

    // Return distinct domains for dropdown
    if (getDomains) {
        const domains = await prisma.journal.findMany({
            where: { domain: { not: null } },
            select: { domain: true },
            distinct: ['domain'],
            orderBy: { domain: 'asc' }
        });
        return NextResponse.json(domains.map(d => d.domain).filter(Boolean));
    }

    // Build query conditions
    const where: any = {};

    if (search) {
        where.title = { contains: search, mode: 'insensitive' };
    }
    if (ranking) {
        where.ajgRanking = ranking;
    }
    if (domain) {
        where.domain = domain;
    }
    if (isFt50) {
        where.isFt50 = true;
    }
    if (isUtd24) {
        where.isUtd24 = true;
    }
    if (isFollowed) {
        where.followers = {
            some: { userId }
        };
    }

    try {
        const journals = await prisma.journal.findMany({
            where,
            take: 100,
            orderBy: { title: 'asc' },
            include: {
                followers: {
                    where: { userId },
                    select: { id: true }
                }
            }
        });

        // Transform to frontend format with isFollowed field
        const result = journals.map(j => ({
            ...j,
            isFollowed: j.followers.length > 0,
            followers: undefined
        }));

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch journals' }, { status: 500 });
    }
}
