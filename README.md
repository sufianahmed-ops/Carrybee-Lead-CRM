# Carrybee Lead CRM

Production CRM: **https://carrybee-lead-crm.vercel.app**

Next.js 15 CRM with Supabase as the only live operational database. Google Sheets is used for controlled lead/care intake and read-only backup snapshots. Sheets never participates in agent writes or replaces Supabase as the source of truth.

## Local development

Use Node.js 22.23+, 24.22+, or 26.12+ (the versions supported by the Cloudflare CLI dependency).

```bash
npm install
cp .env.example .env.local
# Fill the Supabase values. APP_URL=http://localhost:3000 is optional locally.
npm run dev
```

Run quality checks separately in memory-constrained environments:

```bash
NODE_OPTIONS=--max-old-space-size=2048 npm run lint
NODE_OPTIONS=--max-old-space-size=2048 npm run build
```

## Database installation

Apply migrations in filename order:

1. `001_crm.sql` — schema, indexes, RLS, views, and transactional workflow RPCs.
2. `002_import_helpers.sql` — service-role-only lead sequence synchronization.
3. `003_event_ordering.sql` — deterministic event ordering compatibility patch.
4. `004_backup_scheduler.sql` — optional `pg_cron`/`pg_net` support; creates no job.
5. `005_apps_script_backup.sql` — service-role-only temporary snapshot pages.
6. `006_sheet_intake_care_period.sql` — authorized Sheets intake, Care Period reports, settings, indexes, and RPCs.
7. `007_care_view_performance.sql` — pre-aggregated Care Period join for fast lead-dashboard reads.

New installations run all seven. `001_crm.sql` contains the original CRM definitions; later migrations add the current intake, Care Period, and performance behavior.

## Authentication and first admin

Configure Supabase Auth for email invitations, disable public signups, and add production/local `/auth/callback` URLs to the redirect allowlist. Set `ADMIN_EMAIL`, `ADMIN_NAME`, and optionally `APP_URL`, then run:

```bash
npm run bootstrap:admin
```

The recipient opens the invitation email, sets a password, and can manage team access in the CRM. Do not rely on old temporary-password documents; reset credentials through the authorized admin flow when needed.

## Imported data and current behavior

The one-time workbook migration preserved 11,119 leads and 15,469 call logs. Post-import checks found no duplicate phone numbers, orphan logs, duplicate final IDs, or invalid pre-2000 event dates. Legacy source conventions and reconciliation details are retained in the import scripts and migration notes.

Ongoing input uses a separate Google Sheet with `Data_Dump`, `Call_Queue`, and `Care_Period` tabs. Only queue rows explicitly marked `Ready = YES` are submitted. Calls are idempotent by deterministic Call ID and normalized phone; Care reports are idempotent by Consignment ID. See **`INPUT_SHEET_SETUP.md`**.

## Keyless Google backup

Company policy prevents creating a service-account JSON key. The selected workflow is a Google Apps Script bound to a backup spreadsheet. It downloads a frozen server-side Supabase snapshot in 400-row pages, writes temporary tabs, and replaces the previous backup only after every page succeeds.

The schedule is **inactive until a successful manual backup**. After activation it runs in Asia/Dhaka at:

- Saturday–Thursday: hourly from 10:00 through 20:00;
- Friday: 10:00, 15:00, and 20:00;
- the 20:00 run also creates a dated final copy.

See **`APPS_SCRIPT_BACKUP.md`** for setup and recovery. The Apps Script stores only the backup spreadsheet ID and matching `CRON_SECRET` in its private script editor. No Google credential is needed in Vercel.

## Production environment and deployment

Required Vercel variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. `CARE_DAYS` defaults to 30 and can be managed in Team & access.

Deploy runtime application files only (`app`, `components`, `lib`, `middleware.ts`, `package.json`, `tsconfig.json`, `next-env.d.ts`, and `next.config.ts`). Never deploy `.env.local`, local archives, test artifacts, or credentials. No Vercel cron is configured; Apps Script owns the external schedule.

For the Cloudflare Workers deployment setup, including the `vinext` build, secrets, authentication, and Supabase redirect allowlist, see **`CLOUDFLARE_DEPLOYMENT.md`**.

## Verification

The production verification scripts use isolated QA records and clean them in `finally` blocks:

```bash
npx -y node@22 --env-file=.env.local scripts/verify-sheet-intake.mjs
npx -y node@22 --env-file=.env.local scripts/verify-production-e2e.mjs
npx -y node@22 --env-file=.env.local scripts/verify-backup-route.mjs
```

The browser test creates a one-time Auth link without changing a team member's password. The backup-route test downloads every snapshot chunk but does not write to Google Sheets or activate a schedule. Its synthetic run history is deleted afterward. Do not run production QA while operators are entering rows with QA-matching identifiers.
