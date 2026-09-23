## Commands

```sh
npm ci
npm run import -- sample-data/members.csv
npm run lookup -- acme-1001
```

The eventual JSON data store is `data/members.json`; we'll work from disk for less dependencies and time constraints.

## Layout

- `src/index.ts` — command entry point
- `src/cli.ts` — argument parsing and usage text
- `src/importer.ts` — CSV parsing, validation, and import orchestration
- `src/store.ts` — JSON persistence boundary
- `src/types.ts` — shared domain types
- `sample-data/members.csv` — valid and deliberately invalid example rows

The chosen identity will be `partner_member_id`, so an import can upsert
the same member even if their email changes.

---
