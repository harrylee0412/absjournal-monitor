-- Background job queue and journal-level fetch state.

CREATE TYPE "JobType" AS ENUM (
    'USER_CHECK_UPDATE',
    'DAILY_JOURNAL_FETCH',
    'WEEKLY_TOPIC_SUMMARY',
    'EMAIL_DELIVERY'
);

CREATE TYPE "JobStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'RETRYING',
    'SUCCESS',
    'FAILED'
);

CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockOwner" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalFetchState" (
    "id" SERIAL NOT NULL,
    "journalId" INTEGER NOT NULL,
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessfulFromDate" TIMESTAMP(3),
    "lastError" TEXT,
    "lastItemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalFetchState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");
CREATE INDEX "Job_userId_idx" ON "Job"("userId");
CREATE INDEX "Job_lockedAt_idx" ON "Job"("lockedAt");

CREATE UNIQUE INDEX "JournalFetchState_journalId_key" ON "JournalFetchState"("journalId");

ALTER TABLE "JournalFetchState"
ADD CONSTRAINT "JournalFetchState_journalId_fkey"
FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
