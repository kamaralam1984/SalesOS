import { z } from 'zod';
import { uuidSchema } from './common';
import { roleKeySchema } from './identity';

/** Extra company Zoom meetings announced by HR, the Founder or the Developer (separate from the daily meeting link in the workforce policy). */
const ZOOM_HOST = /(^|\.)(zoom\.us|zoom\.com|zoomgov\.com)$/i;

/** https Zoom links only: a link shown on people's home page must not be able to point anywhere else. */
export const zoomMeetingLinkSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.toLowerCase().startsWith('https://'), 'The link must start with https://')
  .refine((u) => {
    // https://host[:port]/...  (no user-info: "https://zoom.us@evil.com" must not pass)
    const m = /^https:\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i.exec(u);
    return m ? ZOOM_HOST.test(m[1]!) : false;
  }, 'Only Zoom links (zoom.us) are allowed');

/** Who gets the link: everyone, or the union of the chosen roles, teams and people. */
export const meetingAudienceSchema = z
  .object({
    everyone: z.boolean(),
    roles: z.array(roleKeySchema).max(12).default([]),
    teamIds: z.array(uuidSchema).max(30).default([]),
    userIds: z.array(uuidSchema).max(300).default([]),
  })
  .refine((a) => a.everyone || a.roles.length + a.teamIds.length + a.userIds.length > 0, 'Choose who the meeting is for');
export type MeetingAudience = z.infer<typeof meetingAudienceSchema>;

export const createMeetingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  url: zoomMeetingLinkSchema,
  /** ISO date-time with offset, e.g. 2026-10-20T15:30:00+05:30 */
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480).default(60),
  note: z.string().trim().max(300).optional(),
  audience: meetingAudienceSchema.default({ everyone: true, roles: [], teamIds: [], userIds: [] }),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/** Filters for the manager's meeting list. */
export const listMeetingsQuerySchema = z.object({
  status: z.enum(['UPCOMING', 'LIVE', 'ENDED', 'CANCELLED']).optional(),
  q: z.string().trim().max(80).optional(),
  from: day.optional(),
  to: day.optional(),
  /** EVERYONE = meetings for the whole company; SELECTED = meetings for chosen roles, teams or people */
  audience: z.enum(['EVERYONE', 'SELECTED']).optional(),
  /** meetings that this role / team / person is invited to */
  roleKey: roleKeySchema.optional(),
  teamId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
});
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;
