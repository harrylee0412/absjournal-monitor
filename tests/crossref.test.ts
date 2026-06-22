import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { fetchNewArticlesForJournal } from '@/lib/crossref';

test('fetchNewArticlesForJournal uses CrossRef polite pool and 100-row window', async () => {
    const originalGet = axios.get;
    process.env.CROSSREF_CONTACT_EMAIL = 'researcher@example.com';

    let captured: unknown;
    axios.get = (async (_url: string, config: unknown) => {
        captured = config;
        return {
            data: {
                message: {
                    items: []
                }
            }
        };
    }) as typeof axios.get;

    try {
        await fetchNewArticlesForJournal('1234-5678', new Date('2026-06-01T00:00:00Z'));
    } finally {
        axios.get = originalGet;
    }

    const config = captured as {
        params: Record<string, unknown>;
        headers: Record<string, string>;
    };

    assert.equal(config.params.filter, 'issn:1234-5678,from-created-date:2026-06-01');
    assert.equal(config.params.rows, 100);
    assert.equal(config.params.sort, 'created');
    assert.equal(config.params.order, 'desc');
    assert.equal(config.params.mailto, 'researcher@example.com');
    assert.match(config.headers['User-Agent'], /mailto:researcher@example.com/);
});
