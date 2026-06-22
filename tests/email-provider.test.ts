import assert from 'node:assert/strict';
import test from 'node:test';
import { sendEmail } from '@/lib/email-provider';

test('sendEmail uses Resend platform provider when configured', async () => {
    const originalFetch = global.fetch;
    const originalEnv = {
        EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
        EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO
    };

    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'Journal Monitor <updates@example.com>';
    process.env.EMAIL_REPLY_TO = 'support@example.com';

    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(JSON.stringify({ id: 'email_test_123' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    }) as typeof fetch;

    try {
        const result = await sendEmail({
            targetEmail: 'reader@example.com',
            message: {
                subject: 'Weekly summary',
                html: '<p>Hello</p>',
                text: 'Hello'
            }
        });

        assert.deepEqual(result, { sent: true, provider: 'resend', id: 'email_test_123' });
        assert.equal(capturedUrl, 'https://api.resend.com/emails');
        assert.equal(capturedInit?.method, 'POST');
        assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer re_test');

        const body = JSON.parse(String(capturedInit?.body));
        assert.equal(body.from, 'Journal Monitor <updates@example.com>');
        assert.deepEqual(body.to, ['reader@example.com']);
        assert.equal(body.reply_to, 'support@example.com');
    } finally {
        global.fetch = originalFetch;
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
});
