-- Developer Panel "Feature access": per-role / per-user permission overrides layered over the code catalogue.
CREATE TABLE "feature_overrides" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "scope" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_overrides_organization_id_subject_type_subject_key__key" ON "feature_overrides"("organization_id", "subject_type", "subject_key", "permission_key");
CREATE INDEX "feature_overrides_organization_id_subject_type_subject_key_idx" ON "feature_overrides"("organization_id", "subject_type", "subject_key");

ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
