/**
 * Hourly Update Script for GitHub Actions
 * 
 * This script runs every hour and processes only users whose
 * preferredHour matches the current UTC hour.
 */

import { PrismaClient } from '@prisma/client';
import { updateArticlesForUser, sendNewArticlesEmailForUser } from '../lib/monitor';

const prisma = new PrismaClient();

async function main() {
    const currentHour = new Date().getUTCHours();
    console.log(`[${new Date().toISOString()}] Running hourly update for UTC hour: ${currentHour}`);

    // Find all users whose preferred update hour matches current hour
    const usersToProcess = await prisma.userSettings.findMany({
        where: { preferredHour: currentHour }
    });

    console.log(`Found ${usersToProcess.length} users scheduled for this hour`);

    if (usersToProcess.length === 0) {
        console.log('No users to process. Exiting.');
        return;
    }

    for (const settings of usersToProcess) {
        const userId = settings.userId;
        console.log(`\n--- Processing user: ${userId} ---`);

        try {
            // Full update: ignore batch index, process all journals
            const newArticles = await updateArticlesForUser(userId, {
                ignoreIndex: true,
                batchSize: 100 // Process all at once
            });

            console.log(`User ${userId}: Found ${newArticles.length} new articles`);

            // Send email if enabled and has new articles
            if (newArticles.length > 0 && settings.emailEnabled && settings.targetEmail) {
                console.log(`Sending email to ${settings.targetEmail}...`);
                await sendNewArticlesEmailForUser(newArticles, settings);
                console.log('Email sent successfully');
            }
        } catch (error) {
            console.error(`Error processing user ${userId}:`, error);
        }
    }

    console.log('\n✅ Hourly update complete');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
