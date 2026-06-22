export type EmailMessage = {
    subject: string;
    html: string;
    text?: string;
};

export type SendEmailOptions = {
    targetEmail: string;
    message: EmailMessage;
    smtpConfig?: string | null;
};

export function isPlatformEmailConfigured() {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(options: SendEmailOptions) {
    const provider = getEmailProvider();
    if (provider === 'resend') {
        return sendWithResend(options.targetEmail, options.message);
    }

    if (options.smtpConfig) {
        return sendWithUserSmtp(options.smtpConfig, options.targetEmail, options.message);
    }

    throw new Error('Email provider is not configured');
}

function getEmailProvider() {
    const configured = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    if (configured === 'resend' || configured === 'platform') return 'resend';
    if (configured === 'smtp') return 'smtp';
    return isPlatformEmailConfigured() ? 'resend' : 'smtp';
}

async function sendWithResend(targetEmail: string, message: EmailMessage) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
        throw new Error('Resend email is missing RESEND_API_KEY or EMAIL_FROM');
    }

    const replyTo = process.env.EMAIL_REPLY_TO || undefined;
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to: [targetEmail],
            subject: message.subject,
            html: message.html,
            text: message.text,
            reply_to: replyTo
        })
    });

    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`Resend email failed: ${response.status} ${responseText.slice(0, 300)}`);
    }

    const data = responseText ? JSON.parse(responseText) as { id?: string } : {};
    return { sent: true, provider: 'resend', id: data.id || null };
}

async function sendWithUserSmtp(
    smtpConfig: string,
    targetEmail: string,
    message: EmailMessage
) {
    const nodemailer = await import('nodemailer');
    const config = JSON.parse(smtpConfig);
    const transporter = nodemailer.createTransport({
        ...config,
        connectionTimeout: config.connectionTimeout ?? 15000,
        greetingTimeout: config.greetingTimeout ?? 15000,
        socketTimeout: config.socketTimeout ?? 30000
    });

    const info = await transporter.sendMail({
        from: config.from || targetEmail,
        to: targetEmail,
        subject: message.subject,
        text: message.text,
        html: message.html
    });

    return { sent: true, provider: 'smtp', messageId: info.messageId || null };
}
