import { NextResponse } from 'next/server';
import { Prisma, PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';

const prisma = new PrismaClient();

type SearchMode = 'hybrid' | 'fts' | 'trigram';
type SortMode = 'relevance' | 'date_desc';

interface RawSearchRow {
    id: number;
    doi: string;
    title: string;
    authors: string | null;
    abstract: string | null;
    publicationDate: Date | null;
    url: string | null;
    createdAt: Date;
    journalId: number;
    journalTitle: string;
    isRead: boolean;
    score: number;
}

function toPositiveInt(raw: string | null, fallback: number, max: number) {
    const parsed = Number.parseInt(raw || '', 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, max);
}

function normalizeSearchMode(raw: string | null): SearchMode {
    if (raw === 'fts' || raw === 'trigram') return raw;
    return 'hybrid';
}

function normalizeSortMode(raw: string | null): SortMode {
    if (raw === 'date_desc') return raw;
    return 'relevance';
}

function toNumber(value: unknown) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

// 获取用户的文章列表
export async function GET(request: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unread') === 'true';
    const limit = toPositiveInt(searchParams.get('limit'), 50, 500);
    const offset = toPositiveInt(searchParams.get('offset'), 0, 50000);
    const q = (searchParams.get('q') || '').trim();
    const searchMode = normalizeSearchMode(searchParams.get('searchMode'));
    const sort = normalizeSortMode(searchParams.get('sort'));

    try {
        // 获取用户关注的期刊
        const followedJournalIds = await prisma.userJournalFollow.findMany({
            where: { userId },
            select: { journalId: true }
        });

        const journalIds = followedJournalIds.map(f => f.journalId);

        // 如果用户没有关注任何期刊，返回空
        if (journalIds.length === 0) {
            return NextResponse.json({ data: [], total: 0, hasMore: false, limit, offset });
        }

        // Non-search path keeps the previous behaviour and shape.
        if (!q) {
            const where: Prisma.ArticleWhereInput = {
                journalId: { in: journalIds },
                ...(unreadOnly ? {
                    NOT: {
                        userArticles: {
                            some: { userId, isRead: true }
                        }
                    }
                } : {})
            };

            const [articles, total] = await Promise.all([
                prisma.article.findMany({
                    where,
                    include: {
                        journal: { select: { title: true } },
                        userArticles: {
                            where: { userId },
                            select: { isRead: true }
                        }
                    },
                    orderBy: [
                        { publicationDate: 'desc' },
                        { createdAt: 'desc' }
                    ],
                    take: limit,
                    skip: offset
                }),
                prisma.article.count({ where })
            ]);

            const result = articles.map(a => ({
                ...a,
                isRead: a.userArticles[0]?.isRead || false,
                userArticles: undefined
            }));

            return NextResponse.json({
                data: result,
                total,
                hasMore: offset + result.length < total,
                limit,
                offset
            });
        }

        const visibilityFilter = Prisma.sql`a."journalId" IN (${Prisma.join(journalIds)})`;
        const unreadFilter = unreadOnly
            ? Prisma.sql`AND COALESCE(ua."isRead", false) = false`
            : Prisma.empty;

        const searchVector = Prisma.sql`(
            setweight(to_tsvector('english', COALESCE(a."title", '')), 'A') ||
            setweight(to_tsvector('english', COALESCE(a."authors", '')), 'B') ||
            setweight(to_tsvector('english', COALESCE(a."abstract", '')), 'C')
        )`;

        const searchCondition = searchMode === 'fts'
            ? Prisma.sql`c.document @@ websearch_to_tsquery('english', ${q})`
            : searchMode === 'trigram'
                ? Prisma.sql`c.trigram_score > 0.08`
                : Prisma.sql`(c.document @@ websearch_to_tsquery('english', ${q}) OR c.trigram_score > 0.08)`;

        const scoreExpression = searchMode === 'fts'
            ? Prisma.sql`c.fts_score`
            : searchMode === 'trigram'
                ? Prisma.sql`c.trigram_score`
                : Prisma.sql`((c.fts_score * 0.7) + (c.trigram_score * 0.3))`;

        const orderBy = sort === 'date_desc'
            ? Prisma.sql`c."publicationDate" DESC NULLS LAST, c."createdAt" DESC`
            : Prisma.sql`score DESC, c."publicationDate" DESC NULLS LAST, c."createdAt" DESC`;

        const rows = await prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
            WITH candidate AS (
                SELECT
                    a."id",
                    a."doi",
                    a."title",
                    a."authors",
                    a."abstract",
                    a."publicationDate",
                    a."url",
                    a."createdAt",
                    a."journalId",
                    j."title" AS "journalTitle",
                    COALESCE(ua."isRead", false) AS "isRead",
                    ${searchVector} AS document,
                    GREATEST(
                        similarity(COALESCE(a."title", ''), ${q}),
                        similarity(COALESCE(a."authors", ''), ${q}),
                        similarity(COALESCE(a."abstract", ''), ${q})
                    ) AS trigram_score
                FROM "Article" a
                JOIN "Journal" j ON j."id" = a."journalId"
                LEFT JOIN "UserArticle" ua
                    ON ua."articleId" = a."id"
                    AND ua."userId" = ${userId}
                WHERE ${visibilityFilter}
                ${unreadFilter}
            ),
            scored AS (
                SELECT
                    c.*,
                    ts_rank_cd(c.document, websearch_to_tsquery('english', ${q})) AS fts_score
                FROM candidate c
            )
            SELECT
                c."id",
                c."doi",
                c."title",
                c."authors",
                c."abstract",
                c."publicationDate",
                c."url",
                c."createdAt",
                c."journalId",
                c."journalTitle",
                c."isRead",
                ${scoreExpression} AS score
            FROM scored c
            WHERE ${searchCondition}
            ORDER BY ${orderBy}
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
            WITH candidate AS (
                SELECT
                    a."id",
                    ${searchVector} AS document,
                    GREATEST(
                        similarity(COALESCE(a."title", ''), ${q}),
                        similarity(COALESCE(a."authors", ''), ${q}),
                        similarity(COALESCE(a."abstract", ''), ${q})
                    ) AS trigram_score
                FROM "Article" a
                LEFT JOIN "UserArticle" ua
                    ON ua."articleId" = a."id"
                    AND ua."userId" = ${userId}
                WHERE ${visibilityFilter}
                ${unreadFilter}
            ),
            scored AS (
                SELECT
                    c.*,
                    ts_rank_cd(c.document, websearch_to_tsquery('english', ${q})) AS fts_score
                FROM candidate c
            )
            SELECT COUNT(*)::bigint AS total
            FROM scored c
            WHERE ${searchCondition}
        `);

        const total = toNumber(totalRows[0]?.total);

        const result = rows.map(row => ({
            id: row.id,
            doi: row.doi,
            title: row.title,
            authors: row.authors,
            abstract: row.abstract,
            publicationDate: row.publicationDate,
            url: row.url,
            journalId: row.journalId,
            createdAt: row.createdAt,
            isRead: row.isRead,
            score: Number(row.score || 0),
            journal: { title: row.journalTitle }
        }));

        return NextResponse.json({
            data: result,
            total,
            hasMore: offset + result.length < total,
            limit,
            offset
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to fetch articles' }, { status: 500 });
    }
}

// 更新文章阅读状态
export async function PUT(request: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { ids, isRead } = await request.json();

    try {
        for (const articleId of ids) {
            await prisma.userArticle.upsert({
                where: {
                    userId_articleId: { userId, articleId }
                },
                create: { userId, articleId, isRead },
                update: { isRead }
            });
        }

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to update read status' }, { status: 500 });
    }
}
