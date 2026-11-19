# Production verification and handoff

Verified on 2026-11-10 through 2026-11-12 (Asia/Dhaka).

## Production

- CRM: https://carrybee-lead-crm.vercel.app
- Current Vercel deployment: `dpl_4nKfWFtpBAv5LVQcEhsJk4zZ4oX6`
- Deployment state: `READY`, `PROMOTED`, alias assigned
- Vercel cron jobs: none
- Supabase project: `mpxvegyzpybnipokztbz`
- Care Days: 30
- Self Registered legacy cutoff: 2026-11-04 (inclusive)
- Backup schedule: user-reported activated; trigger existence not independently inspected
- Input schedule: activated by the user; the next automatic no-change cycle returned `SUCCESS` with 4,908 unchanged rows, zero imports, and zero errors

## Passed checks

### Live Sheets-intake and Care Period API

`scripts/verify-sheet-intake.mjs` passed bearer authorization, configuration, mixed valid/invalid rows, normalized-phone upsert, Call-ID upsert, cross-lead rollback, invalid-phone rejection, Care Consignment-ID upsert, earliest First Order Date, Care Completed calculation, ambiguous Business-ID rejection, Self Registered insertion without fake call logs, organic retry/duplicate preservation, legacy cutoff handling, and organic invalid-phone rejection. All isolated QA data and sync-run records were removed.

### Automatic-feed and real-data verification

- Migration `automatic_self_registered_intake` and `import_organic_lead(jsonb)` are installed; `LEGACY_CUTOFF = 2026-11-04` is live.
- Production deployment `dpl_4nKfWFtpBAv5LVQcEhsJk4zZ4oX6` passed the expanded isolated suite, with zero QA leads/reports and the original totals restored afterward.
- Real legacy-overlap check on `CB-000058` returned `skipped_existing`; every checked lead field stayed unchanged, no duplicate was created, and its call count stayed unchanged.
- Real new merchant `SPARTA` / Business ID `39448` imported in successful sync run 31 as `CB-011134`, source `Self Registered`, unassigned, registration date `2026-11-11`, address/profile/payment metadata preserved, and zero call logs.
- The real Call Queue's 27-column mapping was verified through a CRM lead/log round trip. Its QA CRM rows and the temporary `Data_Dump` / `Call_Queue` sheet rows were then removed.
- The configured private Input script was regenerated from the expanded Apps Script, has no placeholders, and passes syntax checking. The user installed it, completed the clean manual run, and activated the five-minute schedule.

### Authenticated browser workflow

`scripts/verify-production-e2e.mjs` passed one-time team-lead sign-in without changing passwords, dashboard bootstrap, Care Period view, Care Days admin save at unchanged value 30, backup activation instructions, All Leads table, migrated-lead search, and sign-out. Browser page errors: 0.

### Lead-view performance

Before `care_view_performance`, a 1,000-row `lead_details` request failed with Postgres `57014` statement timeout after 8,409 ms. After the migration, the identical request returned HTTP 200 with 1,000 rows in 2,562 ms. The browser dashboard subsequently loaded successfully.

### Full backup-route snapshot

`scripts/verify-backup-route.mjs` passed bearer protection, snapshot manifest, every sheet and chunk, row/header integrity, completion, snapshot expiry, and QA cleanup.

- 26,699 total exported rows
- 75 snapshot chunks
- Leads: 11,119
- Call logs: 15,469
- Team: 7
- Settings: 19
- Status rules: 17
- Lists: 36
- Lead sources: 5
- Call script entries: 7
- Dashboard rows: 20
- Care Period reports: 0

This was an API snapshot test only. It did not write to a real Google Sheet and did not activate scheduling. Synthetic backup-run history was deleted.

### Static/build checks

Strict TypeScript, production build, Apps Script syntax, and verification-script syntax checks passed. The Apps Script input setup now creates all Care Period result headers, preserves row-specific validation errors, and rejects invalid date/time input. Backup lock contention now reports an explicit error rather than appearing successful.

## Real Input manual run — completed

The user installed the updated script and completed the real manual run on 2026-11-12. `Input_Status = SUCCESS` with zero errors. Across sync batches 33–53, all 21 runs succeeded:

- 728 new Self Registered leads imported; all 728 are unassigned and have zero fabricated call logs.
- 77 existing leads preserved as `SKIPPED` without overwrite or duplication.
- 11,252 legacy-cutoff rows skipped.
- 4,103 first-order reports synchronized and visible in `Auto_Sync_Status` as `SYNCED`.
- SPARTA correctly shows `SKIPPED` mapped to `CB-011134`.
- Zero duplicate Business IDs and zero duplicate normalized phones were found.
- Current totals: 11,848 leads, 15,469 call logs, and 4,103 Care Period reports.

The user then selected **Carrybee CRM → Activate 5-minute input sync**. The activation routine deletes any prior `syncCarrybeeInput` triggers before creating one, so one activation leaves exactly one matching trigger. The next automatic cycle updated `Input_Status` to `SUCCESS` with 0 new leads, 0 existing rows resubmitted, 0 Care reports imported, 0 errors, and 4,908 unchanged automatic rows (805 organic + 4,103 first-order). Because all rows were unchanged, the script correctly made no new backend sync-run records. Final totals remained 11,848 leads, 15,469 call logs, and 4,103 Care Period reports; duplicate Business IDs, duplicate normalized phones, and failed sync runs all remained zero. Input schedule activation and no-change deduplication are verified.

## Previous reconciliation before the manual run

- Leads: 11,120 (the original 11,119 plus real merchant SPARTA)
- Call logs: 15,469
- Care Period reports: 0
- Sheet sync runs: 1 (real run 31, `SUCCESS`)
- Successful real backup runs: 2 (run IDs 3 and 4)
- Temporary backup chunks: 0
- QA leads: 0
- Temporary Input `Data_Dump` and `Call_Queue` QA rows: cleared

## Real Google Sheets setup

- Backup spreadsheet: `1AFVVi9uajJfZGyOVu1YAZRUBZ0k7obH90bEVWIoYF8I` (`Carrybee_Backup`).
- Input spreadsheet: `1JvtF3v2iU_z2pTnwo2EUW0cxcSus8SNYVteiSb5EEdw` (`Carrybee_Input`).
- Both use the Asia/Dhaka timezone and contain the required template tabs, headers, and dropdowns.
- The real Apps Script backup completed successfully twice. Latest verified run: ID 4, started `2026-11-11T18:00:05.423061+00:00`, completed `2026-11-11T18:04:34.622+00:00`.
- `Backup_Status = SUCCESS`, with 11,119 leads and 15,469 call logs. The spreadsheet contains all expected data tabs; Leads has 11,120 grid rows including its header and Call_Log has 15,470 including its header.
- Server-side run history confirms both real Google writes succeeded, and zero temporary snapshot chunks remain.
- Backup schedule activation is authorized only after this point; activation itself must be confirmed in Apps Script Triggers.

The remaining operational setup is to replace the Input spreadsheet's old Apps Script with the verified configured script, run authorization/setup and a real manual sync, inspect its results, and only then activate its five-minute trigger. Backup schedule activation was reported by the user; its trigger was not independently inspected.
