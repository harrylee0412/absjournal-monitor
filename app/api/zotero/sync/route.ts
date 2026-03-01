import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { syncToZotero } from '@/lib/zotero';

const prisma = new PrismaClient();

export async function POST() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // Get Zotero credentials from settings
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings?.zoteroUserId || !settings?.zoteroApiKey) {
      return NextResponse.json(
        { error: '请先在设置中配置 Zotero User ID 和 API Key' },
        { status: 400 }
      );
    }

    // Get followed journals
    const follows = await prisma.userJournalFollow.findMany({
      where: { userId },
      include: { journal: true },
    });

    if (follows.length === 0) {
      return NextResponse.json(
        { error: '你还没有关注任何期刊' },
        { status: 400 }
      );
    }

    const journalIds = follows.map((f) => f.journal.id);
    const journals = follows.map((f) => f.journal);

    // Get articles from followed journals
    const articles = await prisma.article.findMany({
      where: { journalId: { in: journalIds } },
      include: { journal: true },
      orderBy: { createdAt: 'desc' },
    });

    // Sync to Zotero
    const result = await syncToZotero(
      settings.zoteroUserId,
      settings.zoteroApiKey,
      journals,
      articles
    );

    return NextResponse.json({
      success: true,
      ...result,
      totalArticles: articles.length,
      totalJournals: journals.length,
    });
  } catch (error: unknown) {
    console.error('Zotero sync error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `同步失败: ${msg}` }, { status: 500 });
  }
}
