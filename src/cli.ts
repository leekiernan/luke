import path from 'node:path';

export type Command =
  | { kind: 'import'; filename: string; dataFile: string }
  | { kind: 'lookup'; partnerMemberId: string; dataFile: string };

const defaultDataFile = path.resolve('data/members.json');

export function parseCommand(args: string[]): Command | undefined {
  const [action, value] = args;

  if (!value) return undefined;

  if (action === 'import') {
    return { kind: 'import', filename: value, dataFile: defaultDataFile };
  }

  if (action === 'lookup') {
    return { kind: 'lookup', partnerMemberId: value, dataFile: defaultDataFile };
  }

  return undefined;
}

export function usage(): string {
  return [
    'Usage:',
    '  npm run import -- <filename.csv>',
    '  npm run lookup -- <partner_member_id>',
  ].join('\n');
}
