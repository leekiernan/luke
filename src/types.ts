export interface Member {
  id: string;
  idempotencyKey: string;
  partnerMemberId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  policyStart: string;
  policyEnd: string;
}

export type ImportRecordStatus = 'created' | 'updated' | 'unchanged' | 'rejected' | 'conflicted';

export interface ImportRecord {
  row: number;
  partnerMemberId: string;
  email: string;
  status: ImportRecordStatus;
  reason?: string;
}

export interface ImportConflict {
  partnerMemberId: string;
  email: string;
  rows: number[];
  differingFields: string[];
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  rejected: Array<{ row: number; reason: string }>;
  conflicts: ImportConflict[];
  records: ImportRecord[];
}
