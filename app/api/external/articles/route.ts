import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyApiKey, isAuthError } from '@/lib/auth/apikey';

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const authResult = await verifyApiKey(request);
  if (isAuthError(authResult)) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  const { userId } = authResult;
  const { searchParams } = new URL(request.url);

  const since = searchParams.get('since');
  const journalId = searchParams.get('journalId');
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    // Get user's followed journal IDs
    const follows = await prisma.userJournalFollow.findMany({
      where: { userId },
      select: { journalId: true },
    });
    const journalIds = follows.map((f) => f.journalId);

    if (journalIds.length === 0) {
      return NextResponse.json({ data: [], total: 0, hasMore: false });
    }

    // Build where clause
    const where: any = {
      journalId: { in: journalIds },
    };

    if (since) {
      where.createdAt = { gte: new Date(since) };
    }

    if (journalId) {
      const jid = parseInt(journalId);
      if (journalIds.includes(jid)) {
        where.journalId = jid;
      } else {
        return NextResponse.json({ data: [], total: 0, hasMore: false });
      }
    }

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: {
          journal: {
            select: { id: true, title: true, printIssn: true, eIssn: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.article.count({ where }),
    ]);

    return NextResponse.json({
      data: articles,
      total,
      hasMore: offset + articles.length < total,
    });
  } catch (error) {
    console.error('Failed to fetch articles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch articles' },
      { status: 500 }
    );
  }
}
