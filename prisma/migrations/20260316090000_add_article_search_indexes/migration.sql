-- Enable trigram search support
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- FTS index with weighted fields (title > authors > abstract)
CREATE INDEX IF NOT EXISTS "Article_search_tsv_idx"
ON "Article"
USING GIN (
    (
        setweight(to_tsvector('english', COALESCE("title", '')), 'A') ||
        setweight(to_tsvector('english', COALESCE("authors", '')), 'B') ||
        setweight(to_tsvector('english', COALESCE("abstract", '')), 'C')
    )
);

-- Trigram indexes for fuzzy keyword matching
CREATE INDEX IF NOT EXISTS "Article_title_trgm_idx"
ON "Article"
USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Article_authors_trgm_idx"
ON "Article"
USING GIN ("authors" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Article_abstract_trgm_idx"
ON "Article"
USING GIN ("abstract" gin_trgm_ops);

-- Common filter/sort path index for followed-journal article listing
CREATE INDEX IF NOT EXISTS "Article_journalId_publicationDate_idx"
ON "Article" ("journalId", "publicationDate" DESC, "createdAt" DESC);
