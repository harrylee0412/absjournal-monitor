import crypto from 'node:crypto';
import { decryptSecret } from '@/lib/crypto';

export type TranslateMode = 'llm' | 'baidu' | 'none';

export type LlmConfigForTranslation = {
    endpoint: string;
    model: string;
    encryptedApiKey: string;
} | null;

export function normalizeTranslateMode(value: unknown): TranslateMode {
    if (value === 'baidu' || value === 'none') return value;
    return 'llm';
}

export async function translateText(
    text: string | null | undefined,
    mode: TranslateMode,
    llmConfig?: LlmConfigForTranslation
) {
    const input = (text || '').trim();
    if (!input || mode === 'none') return input;

    if (mode === 'llm' && llmConfig) {
        try {
            return await translateWithLlm(input, llmConfig);
        } catch (error) {
            console.error('LLM translation failed, falling back:', error);
        }
    }

    if ((mode === 'llm' || mode === 'baidu') && process.env.BAIDU_TRANSLATE_APP_ID && process.env.BAIDU_TRANSLATE_SECRET) {
        try {
            return await translateWithBaidu(input);
        } catch (error) {
            console.error('Baidu translation failed, falling back:', error);
        }
    }

    return input;
}

async function translateWithLlm(text: string, config: NonNullable<LlmConfigForTranslation>) {
    const apiKey = decryptSecret(config.encryptedApiKey);
    const endpoint = config.endpoint.replace(/\/$/, '');
    const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                {
                    role: 'system',
                    content: 'Translate academic paper titles and abstracts into concise, faithful Chinese. Keep technical terms precise.'
                },
                { role: 'user', content: text }
            ],
            temperature: 0.2
        })
    });

    if (!response.ok) {
        throw new Error(`LLM translation failed: ${response.status}`);
    }

    const payload = await response.json();
    return payload.choices?.[0]?.message?.content?.trim() || text;
}

async function translateWithBaidu(text: string) {
    const appId = process.env.BAIDU_TRANSLATE_APP_ID || '';
    const secret = process.env.BAIDU_TRANSLATE_SECRET || '';
    const salt = String(Date.now());
    const sign = crypto
        .createHash('md5')
        .update(`${appId}${text}${salt}${secret}`)
        .digest('hex');

    const params = new URLSearchParams({
        q: text,
        from: 'en',
        to: 'zh',
        appid: appId,
        salt,
        sign
    });

    const response = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!response.ok) {
        throw new Error(`Baidu translation failed: ${response.status}`);
    }

    const payload = await response.json();
    if (payload.error_code) {
        throw new Error(`Baidu translation failed: ${payload.error_code}`);
    }

    return (payload.trans_result || []).map((item: { dst: string }) => item.dst).join('\n') || text;
}
