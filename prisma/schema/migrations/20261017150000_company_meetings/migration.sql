-- CreateTable
CREATE TABLE "company_meetings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "note" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "audience_all" BOOLEAN NOT NULL DEFAULT true,
    "audience_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience_team_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "audience_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_by_id" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_meeting_joins" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_meeting_joins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_meetings_organization_id_ends_at_idx" ON "company_meetings"("organization_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_meeting_joins_meeting_id_user_id_key" ON "company_meeting_joins"("meeting_id", "user_id");

-- AddForeignKey
ALTER TABLE "company_meetings" ADD CONSTRAINT "company_meetings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_meetings" ADD CONSTRAINT "company_meetings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_meetings" ADD CONSTRAINT "company_meetings_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_meeting_joins" ADD CONSTRAINT "company_meeting_joins_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "company_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_meeting_joins" ADD CONSTRAINT "company_meeting_joins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

