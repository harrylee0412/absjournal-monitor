import assert from 'node:assert/strict';
import test from 'node:test';
import { findMatchedKeywords } from '@/lib/topics';

test('short ASCII topic keywords match whole words instead of substrings', () => {
    assert.deepEqual(
        findMatchedKeywords({
            title: 'Investing in Data Quality for High-Impact Research',
            authors: null,
            abstract: null
        }, ['AI']),
        []
    );

    assert.deepEqual(
        findMatchedKeywords({
            title: 'Human-AI collaboration and organizational design',
            authors: null,
            abstract: null
        }, ['AI']),
        ['AI']
    );
});
