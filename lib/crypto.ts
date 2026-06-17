import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function encryptionKey() {
    return crypto
        .createHash('sha256')
        .update(process.env.ENCRYPTION_SECRET || 'dev-encryption-secret-change-me')
        .digest();
}

export function encryptSecret(value: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(payload: string) {
    const [ivRaw, tagRaw, encryptedRaw] = payload.split('.');
    if (!ivRaw || !tagRaw || !encryptedRaw) {
        throw new Error('Invalid encrypted payload');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64')),
        decipher.final()
    ]).toString('utf8');
}
