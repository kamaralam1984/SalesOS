-- Attendance: minutes late at check-in, overtime after the working day ends, and when the person pressed the meeting button. Expand-only (nullable columns).
ALTER TABLE "attendance_records" ADD COLUMN "late_minutes" INTEGER,
ADD COLUMN "meeting_joined_at" TIMESTAMPTZ(6),
ADD COLUMN "overtime_minutes" INTEGER;
