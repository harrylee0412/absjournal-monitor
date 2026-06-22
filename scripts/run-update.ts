/**
 * Compatibility helper: enqueue one daily fetch job.
 *
 * Heavy fetching is handled by the background worker. This script exists for
 * manual operations and older automation that expected scripts/run-update.ts.
 */

import 'dotenv/config';
import { JobType, PrismaClient } from '@prisma/client';
import { enqueueJob } from '@/lib/jobs';

const prisma = new PrismaClient();

async function main() {
    const job = await enqueueJob({
        type: JobType.DAILY_JOURNAL_FETCH,
        payload: { source: 'script/run-update' }
    }, prisma);

    console.log(JSON.stringify({
        success: true,
        jobId: job.id,
        status: job.status
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
