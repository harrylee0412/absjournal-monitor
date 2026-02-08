
import { PrismaClient } from '@prisma/client';
import { updateArticlesForUser, sendNewArticlesEmailForUser } from '../lib/monitor';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting daily update via GitHub Actions...');

    // Get all users
    const settingsList = await prisma.userSettings.findMany();

    console.log(`Found ${settingsList.length} users to process.`);

    for (const settings of settingsList) {
        try {
            console.log(`Updating articles for user ${settings.userId}...`);

            // Full update (ignoreIndex: true, batchSize: 10000)
            // This bypasses the Vercel-specific batching logic
            const newArticles = await updateArticlesForUser(settings.userId, {
                batchSize: 10000,
                ignoreIndex: true
            });

            if (newArticles.length > 0) {
                console.log(`Found ${newArticles.length} new articles.`);

                if (settings.emailEnabled && settings.targetEmail) {
                    console.log(`Sending email notification to ${settings.targetEmail}...`);
                    await sendNewArticlesEmailForUser(newArticles, settings);
                } else {
                    console.log('Email notifications disabled for this user.');
                }
            } else {
                console.log('No new articles found.');
            }
        } catch (e) {
            console.error(`Error updating for user ${settings.userId}:`, e);
        }
    }

    console.log('Daily update complete.');
}

main()
    .catch(e => {
        console.error('Fatal error during update:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
