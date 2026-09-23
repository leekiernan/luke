import { parseCommand, usage } from './cli.js';
import { importMembers } from './importer.js';
import { JsonMemberStore } from './store.js';

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));

  if (!command) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const store = new JsonMemberStore(command.dataFile);

  if (command.kind === 'import') {
    const result = await importMembers(command.filename, store);

    const problemRecords = result.records.filter(
      (record) => record.status === 'rejected' || record.status === 'conflicted',
    );
    if (problemRecords.length > 0) {
      console.table(problemRecords);
    }

    console.log(
      `Imported: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.rejected.length} rejected, ${result.conflicts.length} conflicts`,
    );
    return;
  }

  // The next implementation step is to print the matching member (or a clear
  // not-found result) here.
  const member = await store.findByPartnerMemberId(command.partnerMemberId);
  console.log(member ?? 'Member not found');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
