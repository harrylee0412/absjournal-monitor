import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function sendNewArticlesEmail(newArticles: any[]) {
    if (newArticles.length === 0) return;

    const settings = await prisma.settings.findFirst();

    if (!settings || !settings.emailEnabled || !settings.targetEmail || !settings.smtpConfig) {
        console.log("Email disabled or not configured.");
        return;
    }

    let transporter;
    let fromEmail = settings.targetEmail; // Default to target if from not set

    try {
        const config = JSON.parse(settings.smtpConfig);
        transporter = nodemailer.createTransport(config);
        if (config.from) fromEmail = config.from;
    } catch (e) {
        console.error("Invalid SMTP config", e);
        return;
    }

    const htmlContent = `
        <h1>Journal Monitor Update</h1>
        <p>Found ${newArticles.length} new articles today:</p>
        <ul>
            ${newArticles.map(a => `
                <li style="margin-bottom: 10px;">
                    <strong><a href="${a.url || `http://doi.org/${a.doi}`}">${a.title}</a></strong><br/>
                    <em style="color: #666;">${a.authors ? a.authors : 'Unknown Authors'}</em><br/>
                    <span style="font-size: 0.9em; color: #888;">${a.journal?.title || 'Journal'} - ${new Date(a.publicationDate).toLocaleDateString()}</span>
                </li>
            `).join('')}
        </ul>
        <p>Visit your <a href="http://localhost:3000">Dashboard</a> to manage them.</p>
    `;

    try {
        await transporter.sendMail({
            from: fromEmail,
            to: settings.targetEmail,
            subject: `[Journal Monitor] ${newArticles.length} New Articles Found`,
            html: htmlContent
        });
        console.log(`Email sent to ${settings.targetEmail}`);
    } catch (e) {
        console.error("Failed to send email", e);
    }
}
