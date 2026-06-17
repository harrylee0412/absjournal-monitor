-- Topic subscriptions are scoped to the user's existing followed journals.

CREATE TABLE "TopicSubscription" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[] NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "translateMode" TEXT NOT NULL DEFAULT 'llm',
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicArticleMatch" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" INTEGER NOT NULL,
    "articleId" INTEGER NOT NULL,
    "matchedKeywords" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicArticleMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicSummaryRun" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "summaryMarkdown" TEXT,
    "paperCount" INTEGER NOT NULL DEFAULT 0,
    "deliveryStatus" TEXT,
    "deliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicSummaryRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicSummaryRunArticle" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "articleId" INTEGER NOT NULL,
    "matchedKeywords" TEXT[] NOT NULL,
    "translatedTitle" TEXT,
    "translatedAbstract" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicSummaryRunArticle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserLlmConfig" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai-compatible',
    "endpoint" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLlmConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopicSubscription_userId_idx" ON "TopicSubscription"("userId");
CREATE INDEX "TopicSubscription_userId_enabled_idx" ON "TopicSubscription"("userId", "enabled");

CREATE INDEX "TopicArticleMatch_userId_idx" ON "TopicArticleMatch"("userId");
CREATE INDEX "TopicArticleMatch_topicId_idx" ON "TopicArticleMatch"("topicId");
CREATE INDEX "TopicArticleMatch_articleId_idx" ON "TopicArticleMatch"("articleId");
CREATE INDEX "TopicArticleMatch_createdAt_idx" ON "TopicArticleMatch"("createdAt");
CREATE UNIQUE INDEX "TopicArticleMatch_topicId_articleId_key" ON "TopicArticleMatch"("topicId", "articleId");

CREATE INDEX "TopicSummaryRun_userId_idx" ON "TopicSummaryRun"("userId");
CREATE INDEX "TopicSummaryRun_topicId_idx" ON "TopicSummaryRun"("topicId");
CREATE INDEX "TopicSummaryRun_createdAt_idx" ON "TopicSummaryRun"("createdAt");

CREATE INDEX "TopicSummaryRunArticle_runId_idx" ON "TopicSummaryRunArticle"("runId");
CREATE INDEX "TopicSummaryRunArticle_articleId_idx" ON "TopicSummaryRunArticle"("articleId");
CREATE UNIQUE INDEX "TopicSummaryRunArticle_runId_articleId_key" ON "TopicSummaryRunArticle"("runId", "articleId");

CREATE UNIQUE INDEX "UserLlmConfig_userId_key" ON "UserLlmConfig"("userId");
CREATE INDEX "UserLlmConfig_userId_idx" ON "UserLlmConfig"("userId");

ALTER TABLE "TopicArticleMatch"
ADD CONSTRAINT "TopicArticleMatch_topicId_fkey"
FOREIGN KEY ("topicId") REFERENCES "TopicSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TopicArticleMatch"
ADD CONSTRAINT "TopicArticleMatch_articleId_fkey"
FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TopicSummaryRun"
ADD CONSTRAINT "TopicSummaryRun_topicId_fkey"
FOREIGN KEY ("topicId") REFERENCES "TopicSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TopicSummaryRunArticle"
ADD CONSTRAINT "TopicSummaryRunArticle_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "TopicSummaryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TopicSummaryRunArticle"
ADD CONSTRAINT "TopicSummaryRunArticle_articleId_fkey"
FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
