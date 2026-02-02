import schedule from 'node-cron';
import { updateArticlesForFollowedJournals } from '../lib/crossref';
import { sendNewArticlesEmail } from '../lib/email';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runTask() {
    console.log("Running scheduled update check...");
    try {
        const newArticles = await updateArticlesForFollowedJournals();
        console.log(`Found ${newArticles.length} new articles.`);

        if (newArticles.length > 0) {
            await sendNewArticlesEmail(newArticles);
        }
    } catch (error) {
        console.error("Task failed:", error);
    }
}

// Check every day at 8:00 AM
// Format: second minute hour dayofmonth month dayofweek
// node-cron: minute hour dayofmonth month dayofweek (optional second? usually 5 fields is standard cron but node-cron supports 6 with seconds? Check docs. standard is 5 or 6).
// node-cron supports 6 fields (second included) if specified, or 5.
// Let's use '0 8 * * *' => 8:00 AM every day.

console.log("Scheduler started. Running at 08:00 daily.");
schedule.schedule('0 8 * * *', runTask);

// Run once immediately to verify? Maybe not.
