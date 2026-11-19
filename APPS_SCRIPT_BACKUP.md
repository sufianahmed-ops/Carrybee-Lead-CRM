# Keyless Google Sheets backup with Apps Script

This script uses the authorizing Google account's permission on a dedicated backup spreadsheet. It requires no service-account JSON key. Supabase is always the source of truth; the script never writes operational CRM changes back to Supabase.

## One-time setup

1. Create a new Google Sheet **for backups only** and copy its spreadsheet ID from the URL between `/d/` and the next `/`.
2. Open **Extensions → Apps Script** in that sheet.
3. Copy all of `apps-script/CarrybeeBackup.gs` into the editor, replacing the default contents.
4. Replace:
   - `PASTE_BACKUP_SPREADSHEET_ID` with the backup spreadsheet ID;
   - `PASTE_CRON_SECRET` with the same secret configured as `CRON_SECRET` in Vercel.
5. Save. Keep the script private because it contains the backup secret.
6. Select `setupCarrybeeBackup` and click **Run**. Authorize using an account that can edit the spreadsheet and create Drive copies.
7. Select `testCarrybeeBackup` and click **Run** for the first full manual backup. Authorize external requests if prompted.
8. Verify that `Backup_Status!A2` is `SUCCESS`, lead/log counts are correct, and the visible tabs contain the expected data.

**Do not activate the schedule until that manual backup succeeds.** A manual run alone does not create a schedule.

## Activate the schedule

After verifying the manual backup, select `activateCarrybeeSchedule` and click **Run** once. It replaces older Carrybee schedule triggers rather than creating duplicates.

Asia/Dhaka schedule:

- Saturday–Thursday: 10:00, 11:00, …, 20:00;
- Friday: 10:00, 15:00, and 20:00;
- the 20:00 run creates `Carrybee CRM Final - YYYY-MM-DD` in the same Drive folder and records its URL in `Daily_Archives`.

Apps Script daily triggers run within Google's selected time window, not at an exact minute. The scheduled handler independently checks Dhaka date/hour and skips Friday hours that are not allowed.

## Snapshot and failure protection

- Supabase materializes a short-lived server-side snapshot and records a `backup_runs` entry, so later edits do not change rows waiting for download.
- Apps Script downloads each sheet in 400-row pages and writes temporary `CB_NEW_…` tabs.
- Only after every page succeeds does it replace the visible backup tabs.
- If a request or write fails, temporary tabs are removed, old tab names are restored on a best-effort basis, and the run is marked failed.
- A script lock prevents overlapping runs. A second run reports an explicit error instead of silently skipping.
- `Backup_Status` shows running/success/failure, finish time, lead/log counts, and the latest message.
- Completed snapshots expire immediately and temporary database chunks are deleted.

## Monitoring and recovery

In Apps Script, use **Triggers** to inspect the schedule and **Executions** to inspect errors. In Supabase, inspect `backup_runs` for server-side history. A successful production API test is not proof that Google wrote a backup; confirm the spreadsheet itself.

After changing the spreadsheet ID or secret, update the script, run `setupCarrybeeBackup`, and run `testCarrybeeBackup` again. If an organization restricts Apps Script triggers, external requests, or Drive copies, ask the Google Workspace administrator to allow this project; do not bypass company policy.
