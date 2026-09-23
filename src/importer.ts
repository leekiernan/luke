import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { JsonMemberStore } from './store.js';
import type { ImportConflict, ImportRecord, ImportResult, Member } from './types.js';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function currentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

const dateSchema = z.string().refine(isCalendarDate, {
  message: 'Must be a valid date in YYYY-MM-DD format.',
});

/** Validates a CSV-shaped member row before it is mapped to the domain model. */
export const memberImportSchema = z
  .object({
    partner_member_id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    date_of_birth: dateSchema.refine((date) => date < currentDate(), {
      message: 'Must be a date before today.',
    }),
    email: z.string().email(),
    policy_start: dateSchema,
    policy_end: dateSchema,
  })
  .superRefine(({ policy_start, policy_end }, context) => {
    if (policy_end <= policy_start) {
      context.addIssue({
        code: 'custom',
        path: ['policy_end'],
        message: 'Must be a date after policy_start.',
      });
    }
  });

export type MemberImportRow = z.infer<typeof memberImportSchema>;

/**
 * Import boundary: CSV parsing, row validation, and store upserts belong here.
 */
export async function importMembers(
  filename: string,
  store: JsonMemberStore,
): Promise<ImportResult> {
  const rows = await readCsvRows(filename);
  const result: ImportResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: [],
    conflicts: [],
    records: [],
  };

  const validRows: ValidCsvRow[] = [];

  for (const { row, values, reason: malformedReason } of rows) {
    if (malformedReason) {
      result.rejected.push({ row, reason: malformedReason });
      result.records.push(rejectedRecord(row, values, malformedReason));
      continue;
    }

    const imported = memberImportSchema.safeParse(values);

    if (!imported.success) {
      const reason = imported.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      result.rejected.push({ row, reason });
      result.records.push(rejectedRecord(row, values, reason));
      continue;
    }

    validRows.push({ row, values: imported.data });
  }

  result.conflicts = findConflicts(validRows);
  const conflictByRow = new Map<number, ImportConflict>();
  for (const conflict of result.conflicts) {
    for (const row of conflict.rows) {
      conflictByRow.set(row, conflict);
    }
  }

  for (const validRow of validRows) {
    const conflict = conflictByRow.get(validRow.row);
    if (conflict) {
      result.records.push(conflictedRecord(validRow, conflict));
      continue;
    }

    const member = await toMember(validRow.values, store);
    const status = await store.upsert(member);
    result[status] += 1;
    result.records.push({
      row: validRow.row,
      partnerMemberId: member.partnerMemberId,
      email: member.email,
      status,
    });
  }

  result.records.sort((left, right) => left.row - right.row);
  return result;
}

const csvHeaders = [
  'partner_member_id',
  'first_name',
  'last_name',
  'date_of_birth',
  'email',
  'policy_start',
  'policy_end',
] as const;

interface CsvRow {
  row: number;
  values: Record<string, string>;
  reason?: string;
}

interface ValidCsvRow {
  row: number;
  values: MemberImportRow;
}

async function readCsvRows(filename: string): Promise<CsvRow[]> {
  const contents = await readFile(filename, 'utf8');
  const [header, ...lines] = contents.split(/\r?\n/);

  if (header !== csvHeaders.join(',')) {
    throw new Error(`CSV must have columns: ${csvHeaders.join(',')}`);
  }

  return lines.flatMap((line, index) => {
    if (line === '') return [];

    const fields = line.split(',');
    const row = index + 2;
    if (fields.length !== csvHeaders.length) {
      return [
        {
          row,
          values: malformedRow(fields),
          reason: `Expected ${csvHeaders.length} columns but found ${fields.length}.`,
        },
      ];
    }

    return [
      {
        row,
        values: Object.fromEntries(csvHeaders.map((headerName, field) => [headerName, fields[field] ?? ''])),
      },
    ];
  });
}

function malformedRow(fields: string[]): Record<string, string> {
  const row = Object.fromEntries(csvHeaders.map((header, index) => [header, fields[index] ?? '']));
  row.email = row.email || '';
  return row;
}

async function toMember(row: MemberImportRow, store: JsonMemberStore): Promise<Member> {
  const existing = await store.findByPartnerMemberIdAndEmail(row.partner_member_id, row.email);

  return {
    id: existing?.id ?? randomUUID(),
    idempotencyKey: existing?.idempotencyKey ?? idempotencyKey(row.partner_member_id, row.email),
    partnerMemberId: row.partner_member_id,
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    email: row.email,
    policyStart: row.policy_start,
    policyEnd: row.policy_end,
  };
}

function idempotencyKey(partnerMemberId: string, email: string): string {
  return createHash('sha256').update(JSON.stringify([partnerMemberId, email])).digest('hex');
}

const comparableFields = [
  ['first_name', 'firstName'],
  ['last_name', 'lastName'],
  ['date_of_birth', 'dateOfBirth'],
  ['policy_start', 'policyStart'],
  ['policy_end', 'policyEnd'],
] as const;

function findConflicts(rows: ValidCsvRow[]): ImportConflict[] {
  const groups = new Map<string, ValidCsvRow[]>();

  for (const row of rows) {
    const key = JSON.stringify([row.values.partner_member_id, row.values.email]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()].flatMap((group) => {
    if (group.length < 2) return [];

    const differingFields = comparableFields.flatMap(([inputField, memberField]) => {
      const values = new Set(group.map(({ values: row }) => row[inputField]));
      return values.size > 1 ? [memberField] : [];
    });

    if (differingFields.length === 0) return [];

    const first = group[0];
    if (!first) return [];

    return [
      {
        partnerMemberId: first.values.partner_member_id,
        email: first.values.email,
        rows: group.map(({ row }) => row),
        differingFields,
      },
    ];
  });
}

function rejectedRecord(row: number, values: Record<string, string>, reason: string): ImportRecord {
  return {
    row,
    partnerMemberId: values.partner_member_id ?? '',
    email: values.email ?? '',
    status: 'rejected',
    reason,
  };
}

function conflictedRecord({ row, values }: ValidCsvRow, conflict: ImportConflict): ImportRecord {
  return {
    row,
    partnerMemberId: values.partner_member_id,
    email: values.email,
    status: 'conflicted',
    reason: `Conflicts with rows ${conflict.rows.join(', ')}: ${conflict.differingFields.join(', ')} differ.`,
  };
}
