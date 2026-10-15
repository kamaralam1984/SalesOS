import { z } from 'zod';

const s = (n = 600) => z.string().max(n);
const list = (n = 8, len = 300) => z.array(s(len)).max(n).default([]);

export const summarizeOutput = z.object({ summary: s(1200), keyPoints: list() }).strict();
export const extractOutput = z
  .object({
    requirements: list(),
    objections: list(),
    interest: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).default('UNKNOWN'),
    budget: z.object({ mentioned: z.boolean(), text: s(200).nullable() }).default({ mentioned: false, text: null }),
    nextSteps: list(),
  })
  .strict();
export const draftOutput = z.object({ subject: s(160).nullable().default(null), message: s(1500), reminders: list(4, 200) }).strict();
export const briefOutput = z.object({ headline: s(300), history: list(10), openItems: list(), talkingPoints: list(6) }).strict();

export type Feature = 'summarize' | 'extract' | 'draft_followup' | 'call_brief';
export const OUTPUT_SCHEMAS: Record<Feature, z.ZodTypeAny> = {
  summarize: summarizeOutput, extract: extractOutput, draft_followup: draftOutput, call_brief: briefOutput,
};
export const SCHEMA_HINT: Record<Feature, string> = {
  summarize: '{"summary": string (<=1200 chars), "keyPoints": string[] (<=8)}',
  extract: '{"requirements": string[], "objections": string[], "interest": "HIGH"|"MEDIUM"|"LOW"|"UNKNOWN", "budget": {"mentioned": boolean, "text": string|null}, "nextSteps": string[]}',
  draft_followup: '{"subject": string|null, "message": string, "reminders": string[]}',
  call_brief: '{"headline": string, "history": string[], "openItems": string[], "talkingPoints": string[]}',
};
