# Carrybee input spreadsheet setup

Use the dedicated **Carrybee_Input** Google Sheet. Do not install this script in the backup spreadsheet. Supabase remains the operational source of truth.

## Install or update the real spreadsheet

1. Open **Carrybee_Input → Extensions → Apps Script**.
2. Replace the entire old editor contents with `private/CarrybeeInput_READY_TO_PASTE.gs`. This configured file already contains the production URL and private bearer secret; keep it private.
   - For another environment, use `apps-script/CarrybeeInput.gs` instead and replace `PASTE_CRON_SECRET` with that environment's `CRON_SECRET`.
3. Save, then run `setupCarrybeeInput` once and approve spreadsheet and external-request permissions.
4. Reload the spreadsheet. The **Carrybee CRM** menu provides setup, manual sync, and schedule activation.
5. Run **Carrybee CRM → Sync now** manually and wait for completion. The first run can take several minutes because it reviews the automatic dumps and records their sync state.

Setup creates or refreshes `Data_Dump`, `Call_Queue`, `Care_Period`, `Auto_Sync_Status`, and `Input_Status`, then downloads active team members, statuses, channels, Care Days, and the legacy cutoff from the CRM.

## Automatic feeds

### `Data_Dump_2` — Self Registered merchants

Keep the existing feed headers unchanged. On each sync, changed rows are evaluated as follows:

- Registration dates **on or before 2026-11-04** are legacy and skipped.
- A newer, genuinely new merchant is inserted as **Self Registered**, with **no assignee** and **no fabricated call log**.
- An existing normalized phone or Business ID is preserved and reported as `SKIPPED`; the import never overwrites that lead or creates a duplicate.
- Address is stored in the lead's Area field. Profile Completed and Active Payment Method are preserved in the lead notes.
- Unchanged rows are not resubmitted.

### `1st_Order_Date_Dump` — first-order reports

Changed rows are upserted by **Consignment ID**. Business ID and Consignment ID are required. The earliest valid First Order Date controls the Care Period for a uniquely matched CRM lead. Ambiguous Business IDs are rejected rather than attached to the wrong merchant.

### `Auto_Sync_Status`

This tab records each automatic row's type, source row, stable key, Business ID, Consignment ID, result, CRM Lead ID, message, sync time, and content hash. `SYNCED` means imported/updated; `SKIPPED` means an existing CRM lead was safely preserved; `ERROR` requires review. Do not edit the Content Hash column.

The real merchant **SPARTA / Business ID 39448 / CB-011134** was imported during production verification. Its first spreadsheet run may therefore correctly show `SKIPPED` because the real lead already exists.

## Enter manual calls

1. Paste raw rows into `Data_Dump` using its existing headers. Do not rename headers.
2. Run **Sync now**. New raw rows are copied once into `Call_Queue` with deterministic `SQ-…` Call IDs and `Ready = NO`.
3. In `Call_Queue`, choose **Assigned To**, confirm **Call Time** and **Status**, and complete the relevant fields.
4. Set **Ready = YES** only for rows approved for import. Rows left at `NO` are never submitted.
5. Run **Sync now** and inspect `Sync Status`, `Error`, `CRM Lead ID`, and `Last Synced` for each submitted row.

A valid retry upserts the same call/lead instead of duplicating it. Valid rows can succeed alongside row-level errors. Invalid phone numbers, unknown agents/statuses, cross-lead Call IDs, and conflicting data are rejected. `Raw Key` is a hidden internal deduplication column; do not edit it.

Accepted date entry includes `YYYY-MM-DD` and legacy `M/D/YYYY`. Call times without an explicit timezone are interpreted as Asia/Dhaka. Spreadsheet date cells are preferred over ambiguous typed values.

## Enter manual Care Period reports

Populate the first five `Care_Period` columns:

- `Reporting Date`
- `Business ID`
- `Business Name`
- `Consignment ID`
- `First Order Date`

The script calculates elapsed days and either remaining days or **Care Completed** using the CRM's Care Days setting (currently 30). The CRM dashboard performs the authoritative calculation.

## Activate only after a clean manual run

Review `Input_Status` and all row-level results. Activate the five-minute trigger only when the latest status is `SUCCESS` and the results are correct:

**Carrybee CRM → Activate 5-minute input sync**

An `ATTENTION` status means one or more rows need review. Activation replaces an older input trigger rather than creating duplicates. Re-running manual sync after activation is safe because a script lock prevents overlapping executions; an overlapping scheduled run exits without processing a duplicate batch.

## Production verification completed

Production deployment `dpl_4nKfWFtpBAv5LVQcEhsJk4zZ4oX6` is `READY` and promoted. The expanded isolated suite passed bearer protection, configuration, mixed row results, normalized-phone and Call-ID upserts, cross-lead rollback, invalid-phone rejection, Care upserts and calculations, organic insertion without fake call logs, duplicate preservation, and legacy cutoff handling. All isolated QA rows were removed.

Real-data checks also passed:

- Existing **CB-000058** remained unchanged with no duplicate or extra call log.
- New real merchant **SPARTA / CB-011134** imported correctly as an unassigned Self Registered lead with its metadata preserved and no call log.
- The Call Queue's 27 columns mapped correctly to a verified CRM lead/log before the QA records were deleted.
- Temporary `Data_Dump` and `Call_Queue` QA rows were cleared from the real spreadsheet.

The real updated-script manual run completed with `SUCCESS` and zero errors: 728 new Self Registered leads, 77 existing leads preserved, 11,252 legacy rows skipped, and 4,103 first-order reports synchronized. The user then activated the five-minute schedule. The following automatic no-change cycle returned `SUCCESS`, reported 4,908 unchanged automatic rows, and imported zero rows with zero errors. Final reconciliation remained 11,848 leads, 15,469 call logs, and 4,103 Care Period reports, with zero duplicate Business IDs or normalized phones. Input automation is active and verified.
