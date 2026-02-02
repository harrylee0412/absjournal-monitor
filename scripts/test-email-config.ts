import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Checking email settings...");

    const settings = await prisma.settings.findFirst();

    if (!settings) {
        console.error("❌ No settings found in database. Please configure settings at http://localhost:3000/settings first.");
        return;
    }

    console.log(`Settings found: Email Enabled = ${settings.emailEnabled}, Target = ${settings.targetEmail}`);

    if (!settings.emailEnabled) {
        console.warn("⚠️ Email notifications are disabled in settings.");
    }

    if (!settings.smtpConfig) {
        console.error("❌ No SMTP configuration found.");
        return;
    }

    try {
        const config = JSON.parse(settings.smtpConfig);
        console.log(`SMTP Host: ${config.host}, Port: ${config.port}, User: ${config.auth?.user}`);

        const transporter = nodemailer.createTransport(config);

        // Verify connection
        await transporter.verify();
        console.log("✅ SMTP connection verified.");

        // Send test mail
        const fromEmail = config.from || settings.targetEmail;
        console.log(`Sending test email from ${fromEmail} to ${settings.targetEmail}...`);

        await transporter.sendMail({
            from: fromEmail,
            to: settings.targetEmail,
            subject: "Journal Monitor - Test Email",
            text: "This is a test email from your Journal Monitor application. If you received this, your email configuration is correct!",
            html: "<h1>Test Successful</h1><p>This is a test email from your <strong>Journal Monitor</strong> application.</p>"
        });

        console.log("✅ Test email sent successfully!");

    } catch (e) {
        console.error("❌ Failed to send email:", e);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
