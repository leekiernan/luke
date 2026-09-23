import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importMembers, memberImportSchema } from './importer.js';
import { JsonMemberStore } from './store.js';

const validMember = {
  partner_member_id: 'partner-123',
  first_name: 'Ada',
  last_name: 'Lovelace',
  date_of_birth: '1815-12-10',
  email: 'ada@example.test',
  policy_start: '2026-01-01',
  policy_end: '2026-12-31',
};

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'perci-importer-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function writeCsv(rows: string[]): Promise<string> {
  const filename = path.join(temporaryDirectory, 'members.csv');
  const header = 'partner_member_id,first_name,last_name,date_of_birth,email,policy_start,policy_end';

  await writeFile(filename, [header, ...rows].join('\n'));
  return filename;
}

async function writeStoredMembers(members: unknown[]): Promise<string> {
  const filename = path.join(temporaryDirectory, 'members.json');
  await writeFile(filename, JSON.stringify(members));
  return filename;
}

async function readStoredMembers(filename: string): Promise<Array<Record<string, unknown>>> {
  return JSON.parse(await readFile(filename, 'utf8')) as Array<Record<string, unknown>>;
}

describe('memberImportSchema', () => {
  it('accepts a valid CSV-shaped member row', () => {
    expect(memberImportSchema.safeParse(validMember).success).toBe(true);
  });

  it('rejects an invalid email, invalid dates, and a future date of birth', () => {
    expect(memberImportSchema.safeParse({ ...validMember, email: 'not-an-email' }).success).toBe(false);
    expect(memberImportSchema.safeParse({ ...validMember, date_of_birth: '2000-02-30' }).success).toBe(false);
    expect(memberImportSchema.safeParse({ ...validMember, date_of_birth: '2999-01-01' }).success).toBe(false);
  });

  it('requires policy_end to be after policy_start', () => {
    const result = memberImportSchema.safeParse({
      ...validMember,
      policy_end: validMember.policy_start,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['policy_end'], message: 'Must be a date after policy_start.' }),
      );
    }
  });
});

describe('importMembers', () => {
  describe('persistence', () => {
    it('loads one composite-key index and saves a multi-row import once', async () => {
      const dataFile = await writeStoredMembers([]);
      const csv = await writeCsv([
        'partner-1,Ada,Lovelace,1815-12-10,ada@example.test,2026-01-01,2026-12-31',
        'partner-2,Grace,Hopper,1906-12-09,grace@example.test,2026-01-01,2026-12-31',
      ]);
      const store = new JsonMemberStore(dataFile);
      const loadMemberIndex = vi.spyOn(store, 'loadMemberIndex');
      const saveMemberIndex = vi.spyOn(store, 'saveMemberIndex');

      await expect(importMembers(csv, store)).resolves.toMatchObject({ created: 2 });

      expect(loadMemberIndex).toHaveBeenCalledOnce();
      expect(saveMemberIndex).toHaveBeenCalledOnce();
    });

    it('adds newly imported members without removing existing data-store records', async () => {
      const existingMember = {
        id: 'member-existing',
        idempotencyKey: 'existing-key',
        partnerMemberId: 'existing-1',
        firstName: 'Existing',
        lastName: 'Member',
        dateOfBirth: '1980-01-01',
        email: 'existing@example.test',
        policyStart: '2026-01-01',
        policyEnd: '2026-12-31',
      };
      const dataFile = await writeStoredMembers([existingMember]);
      const csv = await writeCsv(['new-1,New,Member,1990-01-01,new@example.test,2026-01-01,2026-12-31']);

      await expect(importMembers(csv, new JsonMemberStore(dataFile))).resolves.toMatchObject({ created: 1 });
      await expect(readStoredMembers(dataFile)).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining(existingMember), expect.objectContaining({ partnerMemberId: 'new-1' })]),
      );
    });

    it('assigns each new member a persistent ID and deterministic idempotency key from partner_member_id and email', async () => {
      const dataFile = await writeStoredMembers([]);
      const csv = await writeCsv(['partner-1,Ada,Lovelace,1815-12-10,ada@example.test,2026-01-01,2026-12-31']);

      await importMembers(csv, new JsonMemberStore(dataFile));

      const [member] = await readStoredMembers(dataFile);
      expect(member).toMatchObject({ partnerMemberId: 'partner-1', email: 'ada@example.test' });
      expect(member?.id).toEqual(expect.any(String));
      expect(member?.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not duplicate members when the same CSV is imported again', async () => {
      const dataFile = await writeStoredMembers([]);
      const csv = await writeCsv(['partner-1,Ada,Lovelace,1815-12-10,ada@example.test,2026-01-01,2026-12-31']);
      const store = new JsonMemberStore(dataFile);

      await importMembers(csv, store);
      await expect(importMembers(csv, store)).resolves.toMatchObject({ created: 0, unchanged: 1 });
      await expect(readStoredMembers(dataFile)).resolves.toHaveLength(1);
    });

    it('matches an existing member only when both partner_member_id and email match', async () => {
      const dataFile = await writeStoredMembers([
        {
          id: 'member-existing',
          idempotencyKey: 'existing-key',
          partnerMemberId: 'partner-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          dateOfBirth: '1815-12-10',
          email: 'old-email@example.test',
          policyStart: '2026-01-01',
          policyEnd: '2026-12-31',
        },
      ]);
      const csv = await writeCsv(['partner-1,Ada,Lovelace,1815-12-10,new-email@example.test,2026-01-01,2026-12-31']);

      await expect(importMembers(csv, new JsonMemberStore(dataFile))).resolves.toMatchObject({ created: 1 });
      await expect(readStoredMembers(dataFile)).resolves.toHaveLength(2);
    });

    it('updates matching members in place, preserving their persistent ID and idempotency key', async () => {
      const dataFile = await writeStoredMembers([]);
      const originalCsv = await writeCsv(['partner-1,Ada,Lovelace,1815-12-10,ada@example.test,2026-01-01,2026-12-31']);
      const store = new JsonMemberStore(dataFile);

      await importMembers(originalCsv, store);
      const [originalMember] = await readStoredMembers(dataFile);
      const updatedCsv = await writeCsv(['partner-1,Augusta,Lovelace,1815-12-10,ada@example.test,2026-01-01,2026-12-31']);

      await expect(importMembers(updatedCsv, store)).resolves.toMatchObject({ updated: 1 });
      await expect(readStoredMembers(dataFile)).resolves.toEqual([
        expect.objectContaining({
          id: originalMember?.id,
          idempotencyKey: originalMember?.idempotencyKey,
          firstName: 'Augusta',
        }),
      ]);
    });
  });

  describe('report records', () => {
    it('quarantines conflicting same-key rows and reports their group without changing stored data', async () => {
      const dataFile = await writeStoredMembers([
        {
          id: 'member-mia',
          idempotencyKey: 'mia-key',
          partnerMemberId: 'lv-1027',
          firstName: 'Mia',
          lastName: 'Bennett',
          dateOfBirth: '1980-03-15',
          email: 'mia.bennett1027@example.test',
          policyStart: '2025-01-01',
          policyEnd: '2025-12-31',
        },
      ]);
      const csv = await writeCsv([
        'lv-1027,Mia,Bennett,1980-03-15,mia.bennett1027@example.test,2026-03-01,2027-04-30',
        'lv-1027,Mia,Bennett,1980-03-15,mia.bennett1027@example.test,2026-07-01,2027-07-30',
      ]);

      await expect(importMembers(csv, new JsonMemberStore(dataFile))).resolves.toMatchObject({
        updated: 0,
        conflicts: [
          {
            partnerMemberId: 'lv-1027',
            email: 'mia.bennett1027@example.test',
            rows: [2, 3],
            differingFields: ['policyStart', 'policyEnd'],
          },
        ],
        records: [
          {
            row: 2,
            partnerMemberId: 'lv-1027',
            email: 'mia.bennett1027@example.test',
            status: 'conflicted',
            reason: expect.stringContaining('policyStart, policyEnd differ'),
          },
          {
            row: 3,
            partnerMemberId: 'lv-1027',
            email: 'mia.bennett1027@example.test',
            status: 'conflicted',
            reason: expect.stringContaining('policyStart, policyEnd differ'),
          },
        ],
      });
      await expect(readStoredMembers(dataFile)).resolves.toEqual([
        expect.objectContaining({ policyStart: '2025-01-01', policyEnd: '2025-12-31' }),
      ]);
    });

    it('returns created, updated, unchanged, and rejected records for the import-results table', async () => {
      const dataFile = await writeStoredMembers([
        {
          id: 'member-update',
          idempotencyKey: 'update-key',
          partnerMemberId: 'update-1',
          firstName: 'Before',
          lastName: 'Update',
          dateOfBirth: '1980-01-01',
          email: 'update@example.test',
          policyStart: '2026-01-01',
          policyEnd: '2026-12-31',
        },
        {
          id: 'member-unchanged',
          idempotencyKey: 'unchanged-key',
          partnerMemberId: 'unchanged-1',
          firstName: 'Same',
          lastName: 'Member',
          dateOfBirth: '1980-01-01',
          email: 'same@example.test',
          policyStart: '2026-01-01',
          policyEnd: '2026-12-31',
        },
      ]);
      const csv = await writeCsv([
        'new-1,New,Member,1990-01-01,new@example.test,2026-01-01,2026-12-31',
        'update-1,After,Update,1980-01-01,update@example.test,2026-01-01,2026-12-31',
        'unchanged-1,Same,Member,1980-01-01,same@example.test,2026-01-01,2026-12-31',
        'broken-1,Broken,Email,1990-01-01,not-an-email,2026-01-01,2026-12-31',
      ]);

      await expect(importMembers(csv, new JsonMemberStore(dataFile))).resolves.toMatchObject({
        records: [
          { row: 2, partnerMemberId: 'new-1', email: 'new@example.test', status: 'created' },
          { row: 3, partnerMemberId: 'update-1', email: 'update@example.test', status: 'updated' },
          { row: 4, partnerMemberId: 'unchanged-1', email: 'same@example.test', status: 'unchanged' },
          {
            row: 5,
            partnerMemberId: 'broken-1',
            email: 'not-an-email',
            status: 'rejected',
            reason: expect.stringContaining('email'),
          },
        ],
      });
    });

    it('returns each rejected source row with its row number and validation reason', async () => {
      const dataFile = await writeStoredMembers([]);
      const csv = await writeCsv([
        'bad-email,Ada,Lovelace,1815-12-10,not-an-email,2026-01-01,2026-12-31',
        'bad-policy,Ada,Lovelace,1815-12-10,ada@example.test,2026-12-31,2026-01-01',
        'short-row,Ada,Lovelace,1815-12-10,ada@example.test,2026-01-01',
      ]);

      await expect(importMembers(csv, new JsonMemberStore(dataFile))).resolves.toMatchObject({
        rejected: [
          { row: 2, reason: expect.stringContaining('email') },
          { row: 3, reason: expect.stringContaining('policy_end') },
          { row: 4, reason: 'Expected 7 columns but found 6.' },
        ],
      });
    });
  });
});
