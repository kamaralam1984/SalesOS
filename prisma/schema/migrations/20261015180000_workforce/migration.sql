-- Workforce domain (DEC-048): attendance, holidays, leave, Earned Leave ledger, goals, work tasks, payroll register, announcements; employee profile additions.
-- CreateEnum
CREATE TYPE "HolidayKind" AS ENUM ('NATIONAL', 'REGIONAL', 'COMPANY', 'OPTIONAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "HolidayStatus" AS ENUM ('SUGGESTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "WorkAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'WFH', 'LATE', 'HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE', 'UNPAID_LEAVE');

-- CreateEnum
CREATE TYPE "WorkAttendanceSource" AS ENUM ('SELF', 'MANAGER', 'HR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveStep" AS ENUM ('MANAGER', 'HR');

-- CreateEnum
CREATE TYPE "LeaveStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "HalfDayPart" AS ENUM ('NONE', 'FIRST_HALF', 'SECOND_HALF');

-- CreateEnum
CREATE TYPE "LeaveTxnKind" AS ENUM ('OPENING', 'CREDIT_EARNED', 'CREDIT_POLICY', 'DEBIT_LEAVE', 'REVERSAL', 'ADJUSTMENT', 'CARRY_FORWARD', 'EXPIRY');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PENDING_VERIFICATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoalRisk" AS ENUM ('ON_TRACK', 'AT_RISK', 'COMPLETED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "GoalUpdateKind" AS ENUM ('PROGRESS', 'COMMENT', 'SUBMITTED', 'VERIFIED', 'RETURNED', 'REOPENED');

-- CreateEnum
CREATE TYPE "WorkTaskStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayComponentKind" AS ENUM ('EARNING', 'DEDUCTION');

-- AlterTable
ALTER TABLE "employee_profiles" ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "employee_code" TEXT,
ADD COLUMN     "hr_contact_id" UUID,
ADD COLUMN     "probation_months" INTEGER,
ADD COLUMN     "share_birthday" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "work_location" TEXT;

-- CreateTable
CREATE TABLE "workforce_settings" (
    "organization_id" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workforce_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HolidayKind" NOT NULL,
    "location" TEXT,
    "status" "HolidayStatus" NOT NULL DEFAULT 'SUGGESTED',
    "source_rule" TEXT,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "WorkAttendanceStatus" NOT NULL,
    "check_in_at" TIMESTAMPTZ(6),
    "check_out_at" TIMESTAMPTZ(6),
    "work_minutes" INTEGER,
    "source" "WorkAttendanceSource" NOT NULL DEFAULT 'SELF',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "old_value" JSONB NOT NULL,
    "new_value" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "corrected_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type_key" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "half_day" "HalfDayPart" NOT NULL DEFAULT 'NONE',
    "days" DECIMAL(6,2) NOT NULL,
    "unpaid_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_approval_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step" "LeaveStep" NOT NULL,
    "status" "LeaveStepStatus" NOT NULL DEFAULT 'PENDING',
    "actor_id" UUID,
    "comment" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balance_txns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type_key" TEXT NOT NULL,
    "kind" "LeaveTxnKind" NOT NULL,
    "amount" DECIMAL(6,2) NOT NULL,
    "balance_before" DECIMAL(8,2) NOT NULL,
    "balance_after" DECIMAL(8,2) NOT NULL,
    "leave_request_id" UUID,
    "period_start" DATE,
    "period_end" DATE,
    "eligible_days" DECIMAL(6,2),
    "calculation" JSONB,
    "unique_key" TEXT,
    "policy_version" INTEGER,
    "created_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_balance_txns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earned_leave_progress" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "processed_through" DATE,
    "eligible_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "period_start" DATE,
    "credits_given" INTEGER NOT NULL DEFAULT 0,
    "day_log" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "earned_leave_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "created_by_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_date" DATE NOT NULL,
    "target_date" DATE NOT NULL,
    "cycle_days" INTEGER NOT NULL DEFAULT 45,
    "target_value" DECIMAL(14,2),
    "current_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unit" TEXT,
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk" "GoalRisk" NOT NULL DEFAULT 'ON_TRACK',
    "submitted_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "verified_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_milestones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "goal_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_updates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "kind" "GoalUpdateKind" NOT NULL,
    "current_value" DECIMAL(14,2),
    "progress_pct" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "WorkTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigner_id" UUID NOT NULL,
    "assignee_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "status" "WorkTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "goal_id" UUID,
    "project" TEXT,
    "evidence" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_task_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "actor_id" UUID,
    "kind" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "components" JSONB NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "working_days" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "calculated_at" TIMESTAMPTZ(6),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "paid_by_id" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "payment_reference" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "structure_id" UUID,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "working_days" INTEGER NOT NULL,
    "paid_days" DECIMAL(6,2) NOT NULL,
    "loss_of_pay_days" DECIMAL(6,2) NOT NULL,
    "basis" JSONB NOT NULL,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "total_deductions" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience_roles" TEXT[],
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_organization_id_status_date_idx" ON "holidays"("organization_id", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_organization_id_date_name_key" ON "holidays"("organization_id", "date", "name");

-- CreateIndex
CREATE INDEX "attendance_records_organization_id_date_idx" ON "attendance_records"("organization_id", "date");

-- CreateIndex
CREATE INDEX "attendance_records_organization_id_user_id_date_idx" ON "attendance_records"("organization_id", "user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_user_id_date_key" ON "attendance_records"("user_id", "date");

-- CreateIndex
CREATE INDEX "attendance_corrections_organization_id_user_id_date_idx" ON "attendance_corrections"("organization_id", "user_id", "date");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_status_start_date_idx" ON "leave_requests"("organization_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_user_id_start_date_idx" ON "leave_requests"("organization_id", "user_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_approval_steps_request_id_step_key" ON "leave_approval_steps"("request_id", "step");

-- CreateIndex
CREATE INDEX "leave_balance_txns_organization_id_user_id_type_key_created_idx" ON "leave_balance_txns"("organization_id", "user_id", "type_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balance_txns_organization_id_unique_key_key" ON "leave_balance_txns"("organization_id", "unique_key");

-- CreateIndex
CREATE UNIQUE INDEX "earned_leave_progress_user_id_key" ON "earned_leave_progress"("user_id");

-- CreateIndex
CREATE INDEX "earned_leave_progress_organization_id_idx" ON "earned_leave_progress"("organization_id");

-- CreateIndex
CREATE INDEX "goals_organization_id_owner_id_status_idx" ON "goals"("organization_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "goals_organization_id_reviewer_id_status_idx" ON "goals"("organization_id", "reviewer_id", "status");

-- CreateIndex
CREATE INDEX "goals_organization_id_target_date_idx" ON "goals"("organization_id", "target_date");

-- CreateIndex
CREATE INDEX "goal_milestones_goal_id_idx" ON "goal_milestones"("goal_id");

-- CreateIndex
CREATE INDEX "goal_updates_goal_id_created_at_idx" ON "goal_updates"("goal_id", "created_at");

-- CreateIndex
CREATE INDEX "work_tasks_organization_id_assignee_id_status_due_at_idx" ON "work_tasks"("organization_id", "assignee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "work_tasks_organization_id_assigner_id_status_idx" ON "work_tasks"("organization_id", "assigner_id", "status");

-- CreateIndex
CREATE INDEX "work_tasks_goal_id_idx" ON "work_tasks"("goal_id");

-- CreateIndex
CREATE INDEX "work_task_events_task_id_created_at_idx" ON "work_task_events"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "salary_structures_organization_id_user_id_effective_from_idx" ON "salary_structures"("organization_id", "user_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_user_id_effective_from_key" ON "salary_structures"("user_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_organization_id_month_key" ON "payroll_runs"("organization_id", "month");

-- CreateIndex
CREATE INDEX "payslips_organization_id_user_id_idx" ON "payslips"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_user_id_key" ON "payslips"("run_id", "user_id");

-- CreateIndex
CREATE INDEX "announcements_organization_id_published_at_idx" ON "announcements"("organization_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_organization_id_employee_code_key" ON "employee_profiles"("organization_id", "employee_code");

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_approval_steps" ADD CONSTRAINT "leave_approval_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_updates" ADD CONSTRAINT "goal_updates_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_events" ADD CONSTRAINT "work_task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "work_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Workforce append-only guards (DEC-048). Idempotent. Shipped inside migration 20261015180000_workforce (exact copy; a test asserts they match)
-- and re-applied by apps/api/src/common/prisma/workforce-guards.ts in dev/test (DB_AUTO_DDL).
CREATE OR REPLACE FUNCTION salesos_wf_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attendance_corrections_append_only ON attendance_corrections;
CREATE TRIGGER attendance_corrections_append_only BEFORE UPDATE OR DELETE ON attendance_corrections FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();
DROP TRIGGER IF EXISTS attendance_corrections_no_truncate ON attendance_corrections;
CREATE TRIGGER attendance_corrections_no_truncate BEFORE TRUNCATE ON attendance_corrections FOR EACH STATEMENT EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS leave_balance_txns_append_only ON leave_balance_txns;
CREATE TRIGGER leave_balance_txns_append_only BEFORE UPDATE OR DELETE ON leave_balance_txns FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();
DROP TRIGGER IF EXISTS leave_balance_txns_no_truncate ON leave_balance_txns;
CREATE TRIGGER leave_balance_txns_no_truncate BEFORE TRUNCATE ON leave_balance_txns FOR EACH STATEMENT EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS goal_updates_append_only ON goal_updates;
CREATE TRIGGER goal_updates_append_only BEFORE UPDATE OR DELETE ON goal_updates FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS work_task_events_append_only ON work_task_events;
CREATE TRIGGER work_task_events_append_only BEFORE UPDATE OR DELETE ON work_task_events FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS salary_structures_append_only ON salary_structures;
CREATE TRIGGER salary_structures_append_only BEFORE UPDATE OR DELETE ON salary_structures FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();
