import { Job, JobStatus, JobType, Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type JobProgress = Record<string, unknown>;

export type EnqueueJobInput = {
    type: JobType;
    userId?: string | null;
    payload?: Prisma.InputJsonValue;
    runAfter?: Date;
    maxAttempts?: number;
};

export function getEnvNumber(name: string, fallback: number, min = 0) {
    const raw = process.env[name];
    if (!raw) return fallback;

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return parsed;
}

export async function enqueueJob(input: EnqueueJobInput, client: PrismaClient = prisma) {
    return client.job.create({
        data: {
            type: input.type,
            userId: input.userId || null,
            payload: input.payload || {},
            runAfter: input.runAfter || new Date(),
            maxAttempts: input.maxAttempts ?? getEnvNumber('JOB_MAX_ATTEMPTS', 3, 1)
        }
    });
}

export async function getJobForUser(jobId: number, userId: string, client: PrismaClient = prisma) {
    return client.job.findFirst({
        where: {
            id: jobId,
            OR: [
                { userId },
                { userId: null }
            ]
        }
    });
}

export async function claimNextJob(lockOwner: string, client: PrismaClient = prisma) {
    const now = new Date();
    const lockTtlSeconds = getEnvNumber('JOB_LOCK_TTL_SECONDS', 900, 30);
    const lockExpiredBefore = new Date(now.getTime() - lockTtlSeconds * 1000);

    const candidate = await client.job.findFirst({
        where: {
            OR: [
                {
                    status: { in: [JobStatus.PENDING, JobStatus.RETRYING] },
                    runAfter: { lte: now }
                },
                {
                    status: JobStatus.RUNNING,
                    lockedAt: { lte: lockExpiredBefore }
                }
            ]
        },
        orderBy: [
            { runAfter: 'asc' },
            { createdAt: 'asc' }
        ]
    });

    if (!candidate) return null;

    const result = await client.job.updateMany({
        where: {
            id: candidate.id,
            OR: [
                {
                    status: { in: [JobStatus.PENDING, JobStatus.RETRYING] },
                    runAfter: { lte: now }
                },
                {
                    status: JobStatus.RUNNING,
                    lockedAt: { lte: lockExpiredBefore }
                }
            ]
        },
        data: {
            status: JobStatus.RUNNING,
            attempts: { increment: 1 },
            lockedAt: now,
            lockOwner,
            startedAt: now,
            lastError: null
        }
    });

    if (result.count !== 1) return null;
    return client.job.findUnique({ where: { id: candidate.id } });
}

export async function updateJobProgress(jobId: number, progress: JobProgress, client: PrismaClient = prisma) {
    return client.job.update({
        where: { id: jobId },
        data: {
            progress: progress as Prisma.InputJsonValue,
            lockedAt: new Date()
        }
    });
}

export async function completeJob(jobId: number, progress?: JobProgress, client: PrismaClient = prisma) {
    return client.job.update({
        where: { id: jobId },
        data: {
            status: JobStatus.SUCCESS,
            progress: (progress || {}) as Prisma.InputJsonValue,
            completedAt: new Date(),
            lockedAt: null,
            lockOwner: null,
            lastError: null
        }
    });
}

export async function failJob(job: Job, error: unknown, progress?: JobProgress, client: PrismaClient = prisma) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts;
    const maxAttempts = job.maxAttempts;

    if (attempts >= maxAttempts) {
        return client.job.update({
            where: { id: job.id },
            data: {
                status: JobStatus.FAILED,
                progress: (progress || job.progress || {}) as Prisma.InputJsonValue,
                completedAt: new Date(),
                lockedAt: null,
                lockOwner: null,
                lastError: message
            }
        });
    }

    const delayMs = retryDelayMs(attempts);
    return client.job.update({
        where: { id: job.id },
        data: {
            status: JobStatus.RETRYING,
            progress: (progress || job.progress || {}) as Prisma.InputJsonValue,
            runAfter: new Date(Date.now() + delayMs),
            lockedAt: null,
            lockOwner: null,
            lastError: message
        }
    });
}

function retryDelayMs(attempts: number) {
    if (attempts <= 1) return 60_000;
    if (attempts === 2) return 300_000;
    return 1_800_000;
}
