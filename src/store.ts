import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Member } from './types.js';

/** Persistence boundary for the CLI. JSON is the initial implementation. */
export class JsonMemberStore {
  constructor(readonly filename: string) {}

  async findByPartnerMemberId(partnerMemberId: string): Promise<Member | undefined> {
    const members = await this.readMembers();
    return members.find((member) => member.partnerMemberId === partnerMemberId);
  }

  async findByPartnerMemberIdAndEmail(
    partnerMemberId: string,
    email: string,
  ): Promise<Member | undefined> {
    const members = await this.readMembers();
    return members.find(
      (member) => member.partnerMemberId === partnerMemberId && member.email === email,
    );
  }

  async upsert(member: Member): Promise<'created' | 'updated' | 'unchanged'> {
    const members = await this.readMembers();
    const index = members.findIndex(
      (storedMember) =>
        storedMember.partnerMemberId === member.partnerMemberId && storedMember.email === member.email,
    );

    if (index === -1) {
      members.push(member);
      await this.writeMembers(members);
      return 'created';
    }

    const existingMember = members[index];
    if (JSON.stringify(existingMember) === JSON.stringify(member)) {
      return 'unchanged';
    }

    members[index] = member;
    await this.writeMembers(members);
    console.log(">>>", member)
    return 'updated';
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

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
