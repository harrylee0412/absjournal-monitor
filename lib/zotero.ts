const ZOTERO_API_BASE = 'https://api.zotero.org';

interface ZoteroCollection {
  key: string;
  data: {
    key: string;
    name: string;
    parentCollection: string | false;
  };
}

interface ZoteroJournal {
  title: string;
  printIssn?: string | null;
  eIssn?: string | null;
}

interface ZoteroArticle {
  title: string;
  doi?: string | null;
  url?: string | null;
  abstract?: string | null;
  authors?: string | null;
  publicationDate?: Date | string | null;
  journal: {
    title: string;
    printIssn?: string | null;
    eIssn?: string | null;
  };
}

async function zoteroFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`${ZOTERO_API_BASE}${path}`, {
    ...options,
    headers: {
      'Zotero-API-Version': '3',
      'Zotero-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  // Handle rate limiting
  const backoff = res.headers.get('Backoff');
  const retryAfter = res.headers.get('Retry-After');
  if (backoff || retryAfter) {
    const waitSec = parseInt(backoff || retryAfter || '5', 10);
    await delay(waitSec * 1000);
  }

  return res;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * List all collections in a user's library (handles pagination).
 */
export async function listCollections(
  userId: string,
  apiKey: string
): Promise<ZoteroCollection[]> {
  const all: ZoteroCollection[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const res = await zoteroFetch(
      `/users/${userId}/collections?limit=${limit}&start=${start}`,
      apiKey
    );
    if (!res.ok) {
      throw new Error(`Failed to list collections: ${res.status} ${await res.text()}`);
    }

    const data: ZoteroCollection[] = await res.json();
    all.push(...data);

    const totalResults = parseInt(res.headers.get('Total-Results') || '0', 10);
    start += limit;
    if (start >= totalResults || data.length === 0) break;

    await delay(100);
  }

  return all;
}

/**
 * Create collections in batches of up to 50.
 * Returns an array of created collection objects.
 */
export async function createCollections(
  userId: string,
  apiKey: string,
  collections: { name: string; parentCollection?: string | false }[]
): Promise<ZoteroCollection[]> {
  const created: ZoteroCollection[] = [];

  for (let i = 0; i < collections.length; i += 50) {
    const batch = collections.slice(i, i + 50);
    const res = await zoteroFetch(`/users/${userId}/collections`, apiKey, {
      method: 'POST',
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      throw new Error(`Failed to create collections: ${res.status} ${await res.text()}`);
    }

    const result = await res.json();
    // Zotero returns { successful: {0: {...}, 1: {...}}, failed: {...} }
    if (result.successful) {
      created.push(...Object.values(result.successful) as ZoteroCollection[]);
    }

    await delay(100);
  }

  return created;
}

/**
 * Create items in batches of up to 50.
 * Returns the count of successfully created items.
 */
export async function createItems(
  userId: string,
  apiKey: string,
  items: Record<string, unknown>[]
): Promise<number> {
  let count = 0;

  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const res = await zoteroFetch(`/users/${userId}/items`, apiKey, {
      method: 'POST',
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      throw new Error(`Failed to create items: ${res.status} ${await res.text()}`);
    }

    const result = await res.json();
    if (result.successful) {
      count += Object.keys(result.successful).length;
    }

    await delay(100);
  }

  return count;
}

/**
 * Parse a semicolon-separated author string into Zotero creator objects.
 */
function parseAuthors(authors: string | null | undefined): { creatorType: string; firstName: string; lastName: string }[] {
  if (!authors) return [];
  return authors
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((name) => {
      const parts = name.split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        // "LastName, FirstName" format
        return { creatorType: 'author', lastName: parts[0], firstName: parts.slice(1).join(' ') };
      }
      // Single name or "FirstName LastName" format
      const words = name.split(/\s+/);
      if (words.length >= 2) {
        return { creatorType: 'author', lastName: words[words.length - 1], firstName: words.slice(0, -1).join(' ') };
      }
      return { creatorType: 'author', lastName: name, firstName: '' };
    });
}

/**
 * Convert an article to a Zotero journalArticle item.
 */
function articleToZoteroItem(
  article: ZoteroArticle,
  collectionKey: string
): Record<string, unknown> {
  const date = article.publicationDate
    ? new Date(article.publicationDate).toISOString().split('T')[0]
    : '';

  return {
    itemType: 'journalArticle',
    title: article.title,
    DOI: article.doi || '',
    url: article.url || '',
    abstractNote: article.abstract || '',
    publicationTitle: article.journal.title,
    date,
    ISSN: article.journal.printIssn || article.journal.eIssn || '',
    creators: parseAuthors(article.authors),
    collections: [collectionKey],
  };
}

/**
 * Main sync function: sync journals and articles to Zotero.
 */
export async function syncToZotero(
  userId: string,
  apiKey: string,
  journals: ZoteroJournal[],
  articles: ZoteroArticle[]
): Promise<{ collectionsCreated: number; itemsCreated: number }> {
  // 1. Get all existing collections
  const existingCollections = await listCollections(userId, apiKey);

  // 2. Find or create "Journal Monitor" root collection
  let rootCollection = existingCollections.find(
    (c) => c.data.name === 'Journal Monitor' && c.data.parentCollection === false
  );

  let collectionsCreated = 0;

  if (!rootCollection) {
    const created = await createCollections(userId, apiKey, [
      { name: 'Journal Monitor', parentCollection: false },
    ]);
    rootCollection = created[0];
    collectionsCreated++;
  }

  const rootKey = rootCollection.data.key;

  // 3. Find or create sub-collections for each journal
  const journalCollectionMap = new Map<string, string>(); // journal title -> collection key

  // Find existing sub-collections under root
  for (const col of existingCollections) {
    if (col.data.parentCollection === rootKey) {
      journalCollectionMap.set(col.data.name, col.data.key);
    }
  }

  // Determine which journals need new sub-collections
  const toCreate: { name: string; parentCollection: string }[] = [];
  for (const journal of journals) {
    if (!journalCollectionMap.has(journal.title)) {
      toCreate.push({ name: journal.title, parentCollection: rootKey });
    }
  }

  if (toCreate.length > 0) {
    const created = await createCollections(userId, apiKey, toCreate);
    for (const col of created) {
      journalCollectionMap.set(col.data.name, col.data.key);
      collectionsCreated++;
    }
  }

  // 4. Create article items, grouped by journal
  let itemsCreated = 0;
  const itemsByCollection = new Map<string, Record<string, unknown>[]>();

  for (const article of articles) {
    const collectionKey = journalCollectionMap.get(article.journal.title);
    if (!collectionKey) continue;

    const item = articleToZoteroItem(article, collectionKey);
    const existing = itemsByCollection.get(collectionKey) || [];
    existing.push(item);
    itemsByCollection.set(collectionKey, existing);
  }

  for (const [, items] of itemsByCollection) {
    itemsCreated += await createItems(userId, apiKey, items);
  }

  return { collectionsCreated, itemsCreated };
}

/**
 * Test connection to Zotero API by listing collections.
 */
export async function testZoteroConnection(
  userId: string,
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await zoteroFetch(`/users/${userId}/collections?limit=1`, apiKey);
    if (res.ok) {
      return { ok: true, message: '连接成功！Zotero API 凭据有效。' };
    }
    if (res.status === 403) {
      return { ok: false, message: 'API Key 无权限或无效。请检查 Key 的读写权限。' };
    }
    return { ok: false, message: `连接失败: HTTP ${res.status}` };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `连接失败: ${msg}` };
  }
}
