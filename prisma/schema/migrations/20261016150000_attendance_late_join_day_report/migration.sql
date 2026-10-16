-- Attendance: late join after the cutoff (with reason) and the end-of-day task report filled before check-out. Expand-only.
ALTER TABLE "attendance_records" ADD COLUMN "late_join" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "late_join_reason" TEXT,
ADD COLUMN "day_report_pct" INTEGER,
ADD COLUMN "day_report_note" TEXT,
ADD COLUMN "tasks_done" INTEGER,
ADD COLUMN "tasks_open" INTEGER;
