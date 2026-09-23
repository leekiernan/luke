import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Member } from './types.js';

/** A mutable composite-key index for one import batch. */
export class InMemoryMemberIndex {
  private readonly membersByIdentity = new Map<string, number>();
  private changed = false;

  constructor(readonly members: Member[]) {
    for (const [index, member] of members.entries()) {
      this.membersByIdentity.set(memberIdentity(member.partnerMemberId, member.email), index);
    }
  }

  get hasChanges(): boolean {
    return this.changed;
  }

  findByPartnerMemberId(partnerMemberId: string): Member | undefined {
    return this.members.find((member) => member.partnerMemberId === partnerMemberId);
  }

  findByPartnerMemberIdAndEmail(partnerMemberId: string, email: string): Member | undefined {
    const index = this.membersByIdentity.get(memberIdentity(partnerMemberId, email));
    return index === undefined ? undefined : this.members[index];
  }

  upsert(member: Member): 'created' | 'updated' | 'unchanged' {
    const key = memberIdentity(member.partnerMemberId, member.email);
    const index = this.membersByIdentity.get(key);

    if (index === undefined) {
      this.membersByIdentity.set(key, this.members.length);
      this.members.push(member);
      this.changed = true;
      return 'created';
    }

    const existingMember = this.members[index];
    if (JSON.stringify(existingMember) === JSON.stringify(member)) {
      return 'unchanged';
    }

    this.members[index] = member;
    this.changed = true;
    return 'updated';
  }
}

/** Persistence boundary for the CLI. JSON is the initial implementation. */
export class JsonMemberStore {
  constructor(readonly filename: string) {}

  async findByPartnerMemberId(partnerMemberId: string): Promise<Member | undefined> {
    const index = await this.loadMemberIndex();
    return index.findByPartnerMemberId(partnerMemberId);
  }

  async findByPartnerMemberIdAndEmail(
    partnerMemberId: string,
    email: string,
  ): Promise<Member | undefined> {
    const index = await this.loadMemberIndex();
    return index.findByPartnerMemberIdAndEmail(partnerMemberId, email);
  }

  async upsert(member: Member): Promise<'created' | 'updated' | 'unchanged'> {
    const index = await this.loadMemberIndex();
    const status = index.upsert(member);
    await this.saveMemberIndex(index);
    return status;
  }

  async loadMemberIndex(): Promise<InMemoryMemberIndex> {
    return new InMemoryMemberIndex(await this.readMembers());
  }

  async saveMemberIndex(index: InMemoryMemberIndex): Promise<void> {
    if (index.hasChanges) {
      await this.writeMembers(index.members);
    }
  }

  private async readMembers(): Promise<Member[]> {
    try {
      const contents = await readFile(this.filename, 'utf8');
      const members: unknown = JSON.parse(contents);

      if (!Array.isArray(members)) {
        throw new Error(`Member data file must contain a JSON array: ${this.filename}`);
      }

      return members as Member[];
    } catch (error: unknown) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  private async writeMembers(members: Member[]): Promise<void> {
    await mkdir(path.dirname(this.filename), { recursive: true });

    const temporaryFilename = `${this.filename}.${randomUUID()}.tmp`;
    await writeFile(temporaryFilename, JSON.stringify(members, null, 2));
    await rename(temporaryFilename, this.filename);
  }
}

function memberIdentity(partnerMemberId: string, email: string): string {
  return JSON.stringify([partnerMemberId, email]);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
