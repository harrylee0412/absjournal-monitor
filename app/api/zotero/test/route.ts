import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import { testZoteroConnection } from '@/lib/zotero';

const prisma = new PrismaClient();

export async function POST() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings?.zoteroUserId || !settings?.zoteroApiKey) {
      return NextResponse.json(
        { ok: false, message: '请先保存 Zotero User ID 和 API Key' },
        { status: 400 }
      );
    }

    const result = await testZoteroConnection(
      settings.zoteroUserId,
      settings.zoteroApiKey
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, message: `测试失败: ${msg}` },
      { status: 500 }
    );
  }
}
