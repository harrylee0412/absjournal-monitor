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

  try {
    const journals = await prisma.journal.findMany({
      where: {
        followers: { some: { userId } },
      },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        printIssn: true,
        eIssn: true,
        ajgRanking: true,
        domain: true,
        isFt50: true,
        isUtd24: true,
      },
    });

    return NextResponse.json({ data: journals });
  } catch (error) {
    console.error('Failed to fetch journals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch journals' },
      { status: 500 }
    );
  }
}
