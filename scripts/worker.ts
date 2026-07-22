import 'dotenv/config';
import { Job, PrismaClient } from '@prisma/client';
import { claimNextJob, failJob, getEnvNumber } from '@/lib/jobs';
import { processJob } from '@/lib/job-worker';

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const once = args.has('--once');
const dryRun = args.has('--dry-run');
const lockOwner = `${process.env.WORKER_NAME || 'journal-worker'}-${process.pid}`;
// Keep idle polling above Neon's five-minute scale-to-zero window. A short
// interval keeps the database compute awake even when there is no work.
const pollIntervalMs = getEnvNumber('WORKER_POLL_INTERVAL_MS', 30 * 60 * 1000, 6 * 60 * 1000);
const workerConcurrency = getEnvNumber('WORKER_CONCURRENCY', 4, 1);

let stopping = false;

process.on('SIGINT', () => {
    stopping = true;
});

process.on('SIGTERM', () => {
    stopping = true;
});

async function main() {
    if (dryRun) {
        await printRunnableJobs();
        return;
    }

    console.log(`Worker ${lockOwner} started. concurrency=${workerConcurrency}, once=${once}`);

    do {
        let processed = 0;

        try {
            processed = await processAvailableJobs();
        } catch (error) {
            if (once) throw error;

            console.error(`Queue poll failed. Retrying in ${pollIntervalMs}ms.`, error);
            await prisma.$disconnect();
            await sleep(pollIntervalMs);
            continue;
        }

        if (once) break;
        if (processed === 0) await sleep(pollIntervalMs);
    } while (!stopping);
}

async function processAvailableJobs() {
    // Probe the queue once before starting concurrent consumers. Previously,
    // every idle poll issued one query per concurrency slot.
    const firstJob = await claimNextJob(lockOwner, prisma);
    if (!firstJob) return 0;

    let processed = 0;
    const runWorker = async (initialJob?: Job) => {
        let job = initialJob || await claimNextJob(lockOwner, prisma);

        while (!stopping && job) {
            processed++;
            console.log(`Processing job ${job.id} (${job.type}) attempt=${job.attempts + 1}/${job.maxAttempts}`);
            try {
                await processJob(prisma, job);
                console.log(`Job ${job.id} completed`);
            } catch (error) {
                console.error(`Job ${job.id} failed`, error);
                await failJob(job, error, undefined, prisma);
            }

            if (once) return;
            job = await claimNextJob(lockOwner, prisma);
        }
    };

    const workers = [
        runWorker(firstJob),
        ...Array.from({ length: workerConcurrency - 1 }, () => runWorker())
    ];

    await Promise.all(workers);
    return processed;
}

async function printRunnableJobs() {
    const jobs = await prisma.job.findMany({
        where: {
            status: { in: ['PENDING', 'RETRYING'] },
            runAfter: { lte: new Date() }
        },
        orderBy: [
            { runAfter: 'asc' },
            { createdAt: 'asc' }
        ],
        take: 20
    });

    console.log(JSON.stringify({
        lockOwner,
        runnableJobs: jobs.map(job => ({
            id: job.id,
            type: job.type,
            status: job.status,
            userId: job.userId,
            attempts: job.attempts,
            runAfter: job.runAfter
        }))
    }, null, 2));
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
