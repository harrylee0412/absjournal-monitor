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

    // Calculate lookback window (current hour + previous 2 hours) to handle missed cron runs
    // GitHub Actions can sometimes skip hours or delay significantly
    const hoursToCheck = [
        currentHour,
        (currentHour - 1 + 24) % 24,
        (currentHour - 2 + 24) % 24
    ];

    console.log(`Checking for users scheduled in hours: ${hoursToCheck.join(', ')}`);

    // Find users whose preferred update hour covers the current or recent missed hours
    const usersToProcess = await prisma.userSettings.findMany({
        where: {
            preferredHour: { in: hoursToCheck }
        }
    });

    console.log(`Found ${usersToProcess.length} users scheduled for this hour`);

    if (usersToProcess.length === 0) {
        console.log('No users to process. Exiting.');
        return;
    }

    for (const settings of usersToProcess) {
        const userId = settings.userId;

        // Skip if already checked recently (within last 20 hours) to avoid duplicate emails
        // even with the lookback window
        if (settings.lastCheckTime) {
            const lastCheck = new Date(settings.lastCheckTime);
            const now = new Date();
            const hoursSinceLastCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

            if (hoursSinceLastCheck < 20) {
                console.log(`Skipping user ${userId}: Already checked ${hoursSinceLastCheck.toFixed(1)} hours ago`);
                continue;
            }
        }

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
