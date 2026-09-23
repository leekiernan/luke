# member importer

## Quick start

```sh
npm ci
npm run import -- sample-data/members.csv
npm run lookup -- <partner_member_id>
```

Imports are stored in `data/members.json`. The store is created automatically
on the first successful import.

## CSV format

The header must match this exact order:

```csv
partner_member_id,first_name,last_name,date_of_birth,email,policy_start,policy_end
```

| Column | Requirement |
| --- | --- |
| `partner_member_id` | String |
| `first_name` | String |
| `last_name` | String |
| `date_of_birth` | Valid `YYYY-MM-DD` date before today |
| `email` | Valid email address |
| `policy_start` | Valid `YYYY-MM-DD` date |
| `policy_end` | Valid `YYYY-MM-DD` date after `policy_start` |

The CSV reader is intentionally basic: each non-empty row must contain exactly
seven comma-separated fields. Quoted or escaped commas are not supported. **It's 
likely that real-world applications require much more time spent here.**

## Import behavior

Members are identified by the composite key `(partner_member_id, email)`.
Each newly created member receives a persistent `id` and a SHA-256
`idempotencyKey` derived from that composite key. **I chose to composite in part because `partner_member_id` could be a few things.**

- New identities are added without removing existing members.
- Matching identities overwrite the member's imported fields in place while
  preserving its `id` and `idempotencyKey`.
- Re-importing unchanged data is idempotent: it does not create duplicates.
- An email change is a new identity, even if `partner_member_id` is unchanged.

The importer groups valid rows by their composite
identity. If a group contains differing member or policy values, the rows are
quarantined: none of that group is written. The report identifies the source
rows and the fields that differ. Exact duplicate rows are safe and do not
create duplicate members.

At the end of an import the CLI prints a created/updated/unchanged/rejected/
conflicts summary. Invalid and quarantined rows are displayed in a table with
their source row, identity, status, and reason.

## Storage notes

For each import, the JSON store is loaded into an in-memory composite-key
index, updated in memory, and written atomically at most once. This avoids a
full JSON read and write for every CSV row.

Concurrent imports are not coordinated, and large datasets still need 
to fit in memory. **Indexed database is the next optimisation, held back for 
speed and simplified dependencies.**

## Layout

- `src/index.ts` — command entry point and import-report display
- `src/cli.ts` — argument parsing and usage text
- `src/importer.ts` — CSV parsing, validation, conflict detection, and import orchestration
- `src/store.ts` — JSON persistence and in-memory composite-key index
- `src/types.ts` — shared domain and import-report types
- `src/*.test.ts` — Vitest coverage and implementation outlines
- `sample-data/members.csv` — sample member import data
- `sample-data/eligible-members.csv` — small eligibility sample, including invalid rows

## AI

I've abridged the conversation for readability in CONV.md; gpt-5.6-terra high

---

https://www.dropbox.com/scl/fi/b99hco6s4yldq13rm97fg/Screen-Recording-2026-09-23-at-16.14.02.mov?rlkey=onxkcpljuduj8w28nsa2mx4mi&st=0u84phqj&dl=0
