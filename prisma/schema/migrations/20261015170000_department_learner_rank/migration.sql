-- JD gap closure: optional department label on users, learner-reported earnings on leads (revenue-based learner ranks).
ALTER TABLE "users" ADD COLUMN "department" TEXT;
ALTER TABLE "leads" ADD COLUMN "learner_earned_revenue" DECIMAL(14,2),
                    ADD COLUMN "learner_earned_at" TIMESTAMPTZ(6);
ALTER TABLE "improvement_plans" ADD COLUMN "proposed_by_manager" BOOLEAN NOT NULL DEFAULT false;
