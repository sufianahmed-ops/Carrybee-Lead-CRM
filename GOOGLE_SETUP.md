# Google Sheets intake and keyless backup

Company policy prevents creating a service-account JSON key. This project uses three distinct Google workflows:

1. **Excel workbook** — the completed one-time legacy migration;
2. **Input Google Sheet + Apps Script** — controlled ongoing call and Care Period intake;
3. **Separate backup Google Sheet + Apps Script** — read-only scheduled snapshots from Supabase.

Supabase remains the sole live operational database. No Google credentials are used by the production web application.

## 1. Legacy Excel migration — completed

The source workbook was exported as `.xlsx`, extracted with `scripts/extract-workbook.py`, imported with `scripts/import-workbook.ts`, and reconciled at **11,119 leads and 15,469 call logs**. Source edits were frozen for migration; the legacy workbook is no longer a live CRM data source.

To reproduce a migration in a new environment:

```bash
python3 scripts/extract-workbook.py carrybee-source.xlsx import-data.json
NODE_OPTIONS=--max-old-space-size=2048 npm run import:workbook
```

The extractor requires Python and `openpyxl` and reads saved formula results. It does not recalculate formulas or Apps Script. Preserve all required tabs and headers, and reconcile counts and warnings before cutover.

## 2. Configure ongoing input

Use the existing **Carrybee_Input** spreadsheet, not the backup spreadsheet. Follow **`INPUT_SHEET_SETUP.md`** and replace its old script with the configured `private/CarrybeeInput_READY_TO_PASTE.gs` (or use `apps-script/CarrybeeInput.gs` and configure another environment).

The script creates/configures:

- `Data_Dump` for pasted raw lead rows;
- `Call_Queue` for agent assignment, validation, and `Ready = YES` approval;
- `Care_Period` for manual first-order/consignment reports;
- `Data_Dump_2` for the automatic Self Registered feed (new post-cutoff merchants only; existing leads preserved);
- `1st_Order_Date_Dump` for automatic first-order reports;
- `Auto_Sync_Status` for per-row automatic-feed results and change detection;
- `Input_Status` for the latest synchronization result.

Run setup and a manual sync, inspect every row-level result, and only then activate the five-minute input trigger. Do not bulk-insert the legacy dump: registrations on or before **2026-11-04** are skipped automatically.

## 3. Configure the keyless backup

Create a **different** spreadsheet for backups and follow **`APPS_SCRIPT_BACKUP.md`**. In brief:

1. Open **Extensions → Apps Script** in the backup sheet.
2. Paste `apps-script/CarrybeeBackup.gs` into the editor.
3. Set the backup spreadsheet ID and the same `CRON_SECRET` configured in Vercel.
4. Run `setupCarrybeeBackup` once and authorize an account that can edit the sheet and create dated Drive copies.
5. Run `testCarrybeeBackup` and verify every tab plus `Backup_Status = SUCCESS`.
6. Only after that manual success, run `activateCarrybeeSchedule` separately.

The script downloads frozen snapshots in 400-row pages and stages all tabs before replacing the previous successful backup. Transient Supabase snapshot pages are removed when a run finishes. A failed run does not activate scheduling.

## Required production configuration

Vercel must contain `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. Apply all migrations through `008_automatic_self_registered_intake.sql`.

Migration `004_backup_scheduler.sql` enables optional database extensions only. No database or Vercel cron job is needed for the selected Apps Script approach.

## Optional legacy service-account method

`npm run import:sheet` and `npm run backup` remain for organizations that approve service-account JSON credentials. They are not needed for the selected method and should stay unconfigured under current company policy.
