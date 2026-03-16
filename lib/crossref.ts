import axios, { AxiosError } from 'axios';
import { subMonths, format } from 'date-fns';

const CROSSREF_API_URL = 'https://api.crossref.org/works';

function getEnvNumber(name: string, fallback: number, min = 0) {
    const raw = process.env[name];
    if (!raw) return fallback;

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return parsed;
}

const CROSSREF_HTTP_TIMEOUT_MS = getEnvNumber('CROSSREF_HTTP_TIMEOUT_MS', 25000, 1000);
const CROSSREF_MAX_RETRIES = getEnvNumber('CROSSREF_MAX_RETRIES', 2, 0);
const CROSSREF_RETRY_BASE_MS = getEnvNumber('CROSSREF_RETRY_BASE_MS', 800, 50);

export interface CrossRefWork {
    DOI: string;
    title: string[];
    author?: { given?: string; family?: string }[];
    abstract?: string;
    created: { 'date-time': string };
    URL: string;
}

interface FetchJournalOptions {
    signal?: AbortSignal;
}

function isAbortError(error: unknown) {
    const maybeError = error as { name?: string; code?: string };
    return maybeError?.name === 'AbortError' || maybeError?.code === 'ERR_CANCELED';
}

function shouldRetry(error: unknown) {
    if (!axios.isAxiosError(error)) return true;

    const status = error.response?.status;
    if (!status) return true;
    if (status >= 500) return true;
    if (status === 429) return true;

    return false;
}

async function sleep(ms: number, signal?: AbortSignal) {
    if (ms <= 0) return;

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            resolve();
        }, ms);

        if (!signal) return;

        if (signal.aborted) {
            clearTimeout(timer);
            reject(new Error('Aborted'));
            return;
        }

        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
        }, { once: true });
    });
}

export async function fetchNewArticlesForJournal(issn: string, fromDate?: Date, options?: FetchJournalOptions) {
    // Default to 1 month ago if not provided
    const filterDate = fromDate || subMonths(new Date(), 1);
    const dateStr = format(filterDate, 'yyyy-MM-dd');

    // Filter by ISSN and from-created-date
    const filter = `issn:${issn},from-created-date:${dateStr}`;

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= CROSSREF_MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get(CROSSREF_API_URL, {
                params: {
                    filter,
                    rows: 50,
                    sort: 'created',
                    order: 'desc'
                },
                headers: {
                    'User-Agent': `JournalMonitor/1.0 (mailto:${process.env.CROSSREF_CONTACT_EMAIL || 'test@test.com'})`
                },
                timeout: CROSSREF_HTTP_TIMEOUT_MS,
                signal: options?.signal
            });

            const items = response.data?.message?.items as CrossRefWork[] | undefined;
            return items || [];
        } catch (error) {
            lastError = error;

            if (isAbortError(error) || options?.signal?.aborted) {
                throw new Error(`CrossRef request aborted for ISSN ${issn}`);
            }

            const isLastAttempt = attempt === CROSSREF_MAX_RETRIES;
            if (isLastAttempt || !shouldRetry(error)) {
                break;
            }

            const backoffMs = CROSSREF_RETRY_BASE_MS * (2 ** attempt);
            await sleep(backoffMs, options?.signal);
        }
    }

    if (lastError) {
        const axiosError = lastError as AxiosError;
        const status = axiosError.response?.status;
        const statusText = status ? ` (status ${status})` : '';
        throw new Error(`Failed fetching CrossRef data for ISSN ${issn}${statusText}`);
    }

    throw new Error(`Failed fetching CrossRef data for ISSN ${issn}`);
}


