import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonMemberStore } from './store.js';

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'perci-store-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

const member = {
  id: 'member-1',
  idempotencyKey: 'member-1-key',
  partnerMemberId: 'partner-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1815-12-10',
  email: 'ada@example.test',
  policyStart: '2026-01-01',
  policyEnd: '2026-12-31',
};

describe('JsonMemberStore', () => {
  describe('constructor', () => {
    it.todo('retains the configured JSON data filename');
  });

  describe('findByPartnerMemberId', () => {
    it('returns the stored member matching the partner member ID', async () => {
      const filename = path.join(temporaryDirectory, 'members.json');
      await writeFile(filename, JSON.stringify([member]));

      await expect(new JsonMemberStore(filename).findByPartnerMemberId('partner-1')).resolves.toEqual(member);
    });

    it('returns undefined when no stored member has the requested partner member ID', async () => {
      const filename = path.join(temporaryDirectory, 'members.json');
      await writeFile(filename, JSON.stringify([member]));

      await expect(new JsonMemberStore(filename).findByPartnerMemberId('missing-1')).resolves.toBeUndefined();
    });
  });

  describe('upsert', () => {
    it.todo('creates a member that does not yet exist');
    it.todo('updates an existing member with the same partner member ID');
    it.todo('leaves an identical member unchanged');
  });
});
