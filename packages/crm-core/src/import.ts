import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parseCsv } from './csv';
import type { CoreDeps } from './deps';
import { CrmError } from './errors';
import { createLeadTx, type CreateLeadInput } from './leads';
import { IMPORT_TEMPLATES, TEMPLATES, type ImportTemplate } from './import-templates';

export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const IMPORT_FIELDS = ['fullName', 'phone', 'email', 'source', 'program', 'interestLevel', 'consentStatus', 'estimatedValue', 'preferredLanguage', 'ownerEmail', 'note'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const importOptionsSchema = z
  .object({
    /** field -> CSV header name (case-insensitive). Missing fields are auto-detected from common header names. */
    mapping: z.record(z.enum(IMPORT_FIELDS), z.string().min(1).max(120)).default({}),
    sourceId: z.string().uuid().nullish(),
    programId: z.string().uuid().nullish(),
    assignment: z.enum(['none', 'round_robin', 'user']).default('none'),
    assigneeId: z.string().uuid().nullish(),
    /** column template of a source CRM export (CSV migration aid); GENERIC = auto-detect common header names */
    template: z.enum(IMPORT_TEMPLATES).default('GENERIC'),
    defaultRegion: z.string().length(2).default('IN'),
    consentStatus: z.enum(['UNKNOWN', 'GRANTED', 'WITHDRAWN', 'DND']).default('UNKNOWN'),
  })
  .strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;

const SYNONYMS: Record<ImportField, string[]> = {
  fullName: ['full_name', 'fullname', 'name', 'lead name', 'customer name', 'full name'],
  phone: ['phone', 'phone_number', 'mobile', 'mobile number', 'contact', 'phone number', 'whatsapp'],
  email: ['email', 'email id', 'e-mail', 'email address'],
  source: ['source', 'lead source'],
  program: ['program', 'programme', 'interested in', 'course'],
  interestLevel: ['interest', 'interest level', 'interest_level'],
  consentStatus: ['consent', 'consent status', 'consent_status'],
  estimatedValue: ['value', 'estimated value', 'estimated_value', 'amount'],
  preferredLanguage: ['language', 'preferred language', 'preferred_language'],
  ownerEmail: ['owner', 'owner email', 'assigned to', 'assigned_to'],
  note: ['note', 'notes', 'remarks', 'comment'],
};

export interface DetectedMapping {
  mapping: Partial<Record<ImportField, number>>;
  /** set when the file has separate first/last name columns and no full-name column */
  nameParts: { first?: number; last?: number } | null;
}

export function detectMappingFor(header: string[], explicit: Partial<Record<ImportField, string>> = {}, template: ImportTemplate = 'GENERIC'): DetectedMapping {
  const idx = (h: string) => header.findIndex((x) => x.trim().toLowerCase() === h.trim().toLowerCase());
  const tpl = TEMPLATES[template];
  const out: Partial<Record<ImportField, number>> = {};
  for (const f of IMPORT_FIELDS) {
    const named = explicit[f];
    const candidates = [...(tpl.headers[f] ?? []), ...SYNONYMS[f]];
    const i = named ? idx(named) : candidates.map(idx).find((x) => x >= 0) ?? -1;
    if (i >= 0) out[f] = i;
  }
  let nameParts: DetectedMapping['nameParts'] = null;
  if (out.fullName === undefined) {
    const first = tpl.firstName.map(idx).find((x) => x >= 0);
    const last = tpl.lastName.map(idx).find((x) => x >= 0);
    if (first !== undefined || last !== undefined) nameParts = { first, last };
  }
  return { mapping: out, nameParts };
}

export function detectMapping(header: string[], explicit: Partial<Record<ImportField, string>> = {}): Partial<Record<ImportField, number>> {
  return detectMappingFor(header, explicit).mapping;
}

export interface ImportPreview {
  header: string[];
  totalRows: number;
  mapping: Partial<Record<ImportField, number>>;
  nameFrom: 'fullName' | 'firstLast' | null;
  template: ImportTemplate;
  sample: string[][];
  /** dry run: counts over ALL rows, nothing is written */
  dryRun: { rowsWithProblems: number; missingName: number; missingContact: number; invalidEmail: number };
  problems: string[];
}

export function previewCsv(text: string, explicit: Partial<Record<ImportField, string>> = {}, template: ImportTemplate = 'GENERIC'): ImportPreview {
  const { header, rows } = parseCsv(text);
  const { mapping, nameParts } = detectMappingFor(header, explicit, template);
  const problems: string[] = [];
  const hasName = mapping.fullName !== undefined || nameParts !== null;
  if (!hasName) problems.push('No name column found');
  if (mapping.phone === undefined && mapping.email === undefined) problems.push('No phone or email column found');
  if (rows.length > MAX_IMPORT_ROWS) problems.push(`Too many rows (max ${MAX_IMPORT_ROWS})`);
  const dry = { rowsWithProblems: 0, missingName: 0, missingContact: 0, invalidEmail: 0 };
  for (const r of rows) {
    const name = nameParts ? [nameParts.first, nameParts.last].map((i) => (i !== undefined ? (r[i] ?? '').trim() : '')).filter(Boolean).join(' ') : mapping.fullName !== undefined ? (r[mapping.fullName] ?? '').trim() : '';
    const phone = mapping.phone !== undefined ? (r[mapping.phone] ?? '').trim() : '';
    const email = mapping.email !== undefined ? (r[mapping.email] ?? '').trim() : '';
    const bad = [!name && ++dry.missingName, !phone && !email && ++dry.missingContact, email && !emailSchema.safeParse(email).success && ++dry.invalidEmail].some(Boolean);
    if (bad) dry.rowsWithProblems++;
  }
  return { header, totalRows: rows.length, mapping, nameFrom: mapping.fullName !== undefined ? 'fullName' : nameParts ? 'firstLast' : null, template, sample: rows.slice(0, 5), dryRun: dry, problems };
}

const emailSchema = z.string().email();
const num = z.string().regex(/^\d+(\.\d{1,2})?$/);

type Prisma_ = Pick<PrismaClient, '$transaction' | '$queryRaw' | 'importJob' | 'importError' | 'lead' | 'leadSource' | 'program' | 'user'>;

export interface ProcessOptions {
  workerId?: string;
  /** test seam: called before each row; throw to simulate a worker crash */
  beforeRow?: (rowIndex: number) => void | Promise<void>;
  progressEvery?: number;
}

/** Atomic claim (compare-and-set); returns false when another worker holds a live claim or the job is not runnable. */
export async function claimImportJob(prisma: Prisma_, jobId: string, leaseMs = 5 * 60_000): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE import_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = COALESCE(started_at, now()),
      locked_until = now() + (${leaseMs}::int * interval '1 millisecond'), updated_at = now()
    WHERE id = ${jobId}::uuid AND (status = 'QUEUED' OR (status = 'RUNNING' AND (locked_until IS NULL OR locked_until < now())))
    RETURNING id::text`;
  return rows.length === 1;
}

/**
 * Process an import job: resumable (processed_rows cursor), idempotent per row (import_row_key), row-level errors
 * recorded in import_errors. Each row commits in its own transaction so one bad row never poisons the batch.
 */
export async function processImportJob(prisma: Prisma_, deps: CoreDeps, jobId: string, opts: ProcessOptions = {}): Promise<{ status: string; processed: number }> {
  if (!(await claimImportJob(prisma, jobId))) return { status: 'SKIPPED', processed: 0 };
  const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
  const fail = async (message: string) => {
    await prisma.importJob.update({ where: { id: jobId }, data: { status: 'FAILED', lastError: message.slice(0, 500), finishedAt: new Date(), lockedUntil: null } });
    return { status: 'FAILED', processed: job.processedRows };
  };
  if (!job.rawCsv) return fail('CSV content is no longer available');
  const parsedOpts = importOptionsSchema.safeParse(job.options);
  if (!parsedOpts.success) return fail('Invalid import options');
  const options = parsedOpts.data;
  const { header, rows } = parseCsv(job.rawCsv);
  if (rows.length > MAX_IMPORT_ROWS) return fail(`Too many rows (max ${MAX_IMPORT_ROWS})`);
  const { mapping: map, nameParts } = detectMappingFor(header, options.mapping, options.template);
  if ((map.fullName === undefined && !nameParts) || (map.phone === undefined && map.email === undefined)) return fail('CSV must contain a name column and a phone or email column');
  await prisma.importJob.update({ where: { id: jobId }, data: { totalRows: rows.length } });

  const sources = new Map((await prisma.leadSource.findMany({ where: { organizationId: job.organizationId } })).map((s) => [s.name.toLowerCase(), s.id]));
  const programs = await prisma.program.findMany({ where: { organizationId: job.organizationId } });
  const programBy = new Map<string, string>();
  for (const p of programs) {
    programBy.set(p.code.toLowerCase(), p.id);
    programBy.set(p.name.toLowerCase(), p.id);
  }
  const owners = new Map((await prisma.user.findMany({ where: { organizationId: job.organizationId, isActive: true }, select: { id: true, email: true } })).map((u) => [u.email.toLowerCase(), u.id]));

  const every = opts.progressEvery ?? 25;
  const cell = (r: string[], f: ImportField) => (map[f] !== undefined ? (r[map[f]!] ?? '').trim() : '');
  const addErrors = async (rowNumber: number, raw: string[], items: Array<{ code: string; message: string; field?: string }>) => {
    const rawRow = Object.fromEntries(header.map((h, i) => [h, raw[i] ?? '']));
    await prisma.importError.createMany({ data: items.map((e) => ({ jobId, rowNumber, code: e.code, message: e.message, field: e.field ?? null, rawRow })), skipDuplicates: true });
  };

  try {
    for (let i = job.processedRows; i < rows.length; i++) {
      await opts.beforeRow?.(i);
      const r = rows[i]!;
      const rowNumber = i + 2; // 1-based incl. header line
      const issues: Array<{ code: string; message: string; field?: string }> = [];
      const warnings: Array<{ code: string; message: string; field?: string }> = [];
      const name = nameParts ? [nameParts.first, nameParts.last].map((ix) => (ix !== undefined ? (r[ix] ?? '').trim() : '')).filter(Boolean).join(' ') : cell(r, 'fullName');
      const phone = cell(r, 'phone');
      const email = cell(r, 'email');
      if (!name) issues.push({ code: 'MISSING_NAME', message: 'Full name is required', field: 'fullName' });
      if (!phone && !email) issues.push({ code: 'MISSING_CONTACT', message: 'A phone number or an email is required', field: 'phone' });
      if (email && !emailSchema.safeParse(email).success) issues.push({ code: 'INVALID_EMAIL', message: `"${email}" is not a valid email`, field: 'email' });
      const valueRaw = cell(r, 'estimatedValue').replace(/[,\s₹]/g, '');
      if (valueRaw && !num.safeParse(valueRaw).success) issues.push({ code: 'INVALID_VALUE', message: `"${cell(r, 'estimatedValue')}" is not a valid amount`, field: 'estimatedValue' });
      const interest = cell(r, 'interestLevel').toUpperCase();
      if (interest && !['LOW', 'MEDIUM', 'HIGH'].includes(interest)) issues.push({ code: 'INVALID_INTEREST', message: 'Interest must be LOW, MEDIUM or HIGH', field: 'interestLevel' });
      const consentCell = cell(r, 'consentStatus').toUpperCase();
      if (consentCell && !['UNKNOWN', 'GRANTED', 'WITHDRAWN', 'DND'].includes(consentCell)) issues.push({ code: 'INVALID_CONSENT', message: 'Consent must be UNKNOWN, GRANTED, WITHDRAWN or DND', field: 'consentStatus' });

      if (issues.length) {
        await addErrors(rowNumber, r, issues);
      } else {
        let sourceId = options.sourceId ?? null;
        const sourceName = cell(r, 'source');
        if (sourceName) {
          const s = sources.get(sourceName.toLowerCase());
          if (s) sourceId = s;
          else warnings.push({ code: 'WARN_UNKNOWN_SOURCE', message: `Source "${sourceName}" does not exist; default used`, field: 'source' });
        }
        let programId = options.programId ?? null;
        const programName = cell(r, 'program');
        if (programName) {
          const p = programBy.get(programName.toLowerCase());
          if (p) programId = p;
          else warnings.push({ code: 'WARN_UNKNOWN_PROGRAM', message: `Program "${programName}" does not exist; default used`, field: 'program' });
        }
        let assignedToId: string | null = options.assignment === 'user' ? (options.assigneeId ?? null) : null;
        const ownerEmail = cell(r, 'ownerEmail').toLowerCase();
        if (ownerEmail) {
          const o = owners.get(ownerEmail);
          if (o) assignedToId = o;
          else warnings.push({ code: 'WARN_OWNER_NOT_FOUND', message: `Owner "${ownerEmail}" not found or inactive; default assignment used`, field: 'ownerEmail' });
        }
        const input: CreateLeadInput = {
          fullName: name,
          phone: phone || null,
          email: email || null,
          sourceId,
          programId,
          assignedToId,
          teamId: job.teamId,
          interestLevel: (interest || null) as CreateLeadInput['interestLevel'],
          estimatedValue: valueRaw || null,
          preferredLanguage: cell(r, 'preferredLanguage') || null,
          consentStatus: (consentCell || options.consentStatus) as CreateLeadInput['consentStatus'],
          consentSource: consentCell || options.consentStatus !== 'UNKNOWN' ? `import:${job.fileName ?? job.id}` : null,
          note: cell(r, 'note') || null,
          importJobId: job.id,
          importRowKey: `${job.id}:${rowNumber}`,
          autoAssign: options.assignment === 'round_robin' ? 'round_robin' : 'none',
          assignmentMethod: 'IMPORT',
          defaultRegion: options.defaultRegion,
        };
        try {
          const res = await prisma.$transaction((tx) => createLeadTx(tx, deps, { userId: job.createdById, organizationId: job.organizationId, teamId: job.teamId }, input), { timeout: 20_000 });
          if (res.created) {
            for (const w of res.warnings) {
              const code = w.startsWith('Phone') ? 'WARN_PHONE_FLAGGED' : w.startsWith('Possible duplicate') ? 'WARN_DUPLICATE_FLAGGED' : 'WARN_INFO';
              warnings.push({ code, message: w });
            }
          }
        } catch (e) {
          if (e instanceof CrmError) await addErrors(rowNumber, r, [{ code: e.code, message: e.message }]);
          else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            /* raced with a retry of the same row: already created => idempotent */
          } else throw e;
        }
        if (warnings.length) await addErrors(rowNumber, r, warnings);
      }
      if ((i + 1) % every === 0 || i === rows.length - 1) {
        await prisma.importJob.update({ where: { id: jobId }, data: { processedRows: i + 1, lockedUntil: new Date(Date.now() + 5 * 60_000) } });
      }
    }
  } catch (e) {
    // leave RUNNING with an expiring lease: the sweep re-claims and resumes from processed_rows (no duplicates: row keys)
    await prisma.importJob.update({ where: { id: jobId }, data: { lastError: (e as Error).message.slice(0, 500), lockedUntil: new Date(Date.now() - 1000) } });
    throw e;
  }

  const [created, duplicate, errored] = await Promise.all([
    prisma.lead.count({ where: { importJobId: jobId } }),
    prisma.lead.count({ where: { importJobId: jobId, duplicateFlag: true } }),
    prisma.importError.groupBy({ by: ['rowNumber'], where: { jobId, NOT: { code: { startsWith: 'WARN_' } } } }).then((g) => g.length),
  ]);
  const status = errored > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status, processedRows: rows.length, totalRows: rows.length, createdRows: created, duplicateRows: duplicate, errorRows: errored, skippedRows: Math.max(0, rows.length - created - errored), finishedAt: new Date(), lockedUntil: null, lastError: null },
  });
  return { status, processed: rows.length };
}
