import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, 'Invalid calendar date.');
const optionalDate = z.union([isoDate, z.literal('')]).default('');
const callSchema = z.object({
  logId: z.string().regex(/^SQ-[0-9A-F-]{8,80}$/),
  phone: z.string().trim().min(10).max(40), source: z.string().trim().max(100).default(''),
  businessId: z.string().trim().max(100).default(''), businessName: z.string().trim().max(300).default(''),
  merchantName: z.string().trim().max(300).default(''), email: z.string().trim().max(300).default(''),
  fbLink: z.string().trim().max(1000).default(''), productCategory: z.string().trim().max(200).default(''),
  parcelVolume: z.string().trim().max(200).default(''), zone: z.string().trim().max(100).default(''),
  area: z.string().trim().max(200).default(''), existingCourier: z.string().trim().max(200).default(''),
  assignedTo: z.string().uuid(), assignDate: optionalDate,
  callTime: z.string().datetime({ offset: true }), status: z.string().trim().min(1).max(150),
  reason: z.string().trim().max(300).default(''), channel: z.string().trim().max(100).default(''),
  nextDate: optionalDate, note: z.string().max(10000).default(''),
  points: z.array(z.number().int().min(1).max(7)).max(7).default([]),
});
const careSchema = z.object({
  reportingDate: isoDate, businessId: z.string().trim().min(1).max(100),
  businessName: z.string().trim().max(300).default(''), consignmentId: z.string().trim().min(1).max(150),
  firstOrderDate: isoDate, sourceRow: z.string().max(100).default(''),
});
// Request 26: one row from 1st_Order_Date_Dump_2 — a consignment the merchant CREATED.
// Whether it was collected is decided later by comparing against 1st_Order_Date_Dump, so this
// endpoint only records the request. Keyed on consignmentId, which is unique per request.
const pickupSchema = z.object({
  businessId: z.string().trim().min(1).max(100),
  businessName: z.string().trim().max(300).default(''),
  consignmentId: z.string().trim().min(3).max(150),
  requestedAt: z.string().datetime({ offset: true }),
});
const organicSchema = z.object({
  rowKey: z.string().trim().min(3).max(150), registrationDate: isoDate,
  phone: z.string().trim().min(10).max(40), businessId: z.string().trim().max(100).default(''),
  businessName: z.string().trim().max(300).default(''), merchantName: z.string().trim().max(300).default(''),
  email: z.string().trim().max(300).default(''), storeAddress: z.string().trim().max(1000).default(''),
  profileCompleted: z.string().trim().max(50).default(''), activePaymentMethod: z.string().trim().max(200).default(''),
});
const syncSchema = z.object({
  action: z.literal('sync'),
  calls: z.array(callSchema).max(500).default([]),
  careReports: z.array(careSchema).max(500).default([]),
  organicRows: z.array(organicSchema).max(500).default([]),
  pickupRequests: z.array(pickupSchema).max(500).default([]),
});

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  const [members, rules, channels, care, cutoff] = await Promise.all([
    admin.from('team_members').select('id,name,team').eq('active', true).order('name'),
    admin.from('status_rules').select('status,needs_next_date,reason_required').order('status'),
    admin.from('list_values').select('value').eq('category', 'Channel').order('sort_order'),
    admin.from('app_settings').select('value').eq('key', 'CARE_DAYS').single(),
    admin.from('app_settings').select('value').eq('key', 'LEGACY_CUTOFF').single(),
  ]);
  const error = members.error || rules.error || channels.error || care.error || cutoff.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    members: members.data, rules: rules.data, channels: channels.data.map((row: any) => row.value),
    careDays: Number(care.data.value) || 30, legacyCutoff: cutoff.data.value || '2026-11-04',
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  let runId: number | null = null;
  try {
    const input = syncSchema.parse(await request.json());
    const { data: run, error: runError } = await admin.from('sheet_sync_runs').insert({
      calls_received: input.calls.length, care_received: input.careReports.length, organic_received: input.organicRows.length,
    }).select('id').single();
    if (runError) throw runError;
    runId = run.id;
    const calls: Record<string, { ok: boolean; leadId?: string; error?: string }> = {};
    const careReports: Record<string, { ok: boolean; leadId?: string; error?: string }> = {};
    const organic: Record<string, { ok: boolean; leadId?: string; status?: string; error?: string }> = {};
    let callsImported = 0; let careImported = 0; let organicImported = 0; let organicSkipped = 0; let errorCount = 0;

    for (const call of input.calls) {
      try {
        const { data, error } = await admin.rpc('import_sheet_call', { p: call });
        if (error) throw error;
        calls[call.logId] = { ok: true, leadId: data.leadId }; callsImported++;
      } catch (error: any) {
        calls[call.logId] = { ok: false, error: String(error.message || error).slice(0, 1000) }; errorCount++;
      }
    }

    for (const row of input.organicRows) {
      try {
        const { data, error } = await admin.rpc('import_organic_lead', { p: row });
        if (error) throw error;
        organic[row.rowKey] = { ok: true, leadId: data.leadId || '', status: data.status };
        if (data.status === 'inserted') organicImported++; else organicSkipped++;
      } catch (error: any) {
        organic[row.rowKey] = { ok: false, error: String(error.message || error).slice(0, 1000) }; errorCount++;
      }
    }

    // Request 26: pickup requests are written one row at a time so a single malformed
    // consignment cannot discard the rest of the batch.
    let pickupImported = 0;
    const pickups: Record<string, { ok: boolean; error?: string }> = {};
    if (input.pickupRequests.length) {
      const seen = new Set<string>();
      for (const row of input.pickupRequests) {
        if (seen.has(row.consignmentId)) { pickups[row.consignmentId] = { ok: true }; continue; }
        seen.add(row.consignmentId);
        const { error } = await admin.from('pickup_requests').upsert({
          business_id: row.businessId,
          business_name: row.businessName,
          consignment_id: row.consignmentId,
          requested_at: row.requestedAt,
          source_tab: '1st_Order_Date_Dump_2',
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'consignment_id' });
        if (error) { pickups[row.consignmentId] = { ok: false, error: String(error.message).slice(0, 1000) }; errorCount++; }
        else { pickups[row.consignmentId] = { ok: true }; pickupImported++; }
      }
    }

    if (input.careReports.length) {
      // A dump can contain a Consignment ID more than once. Keep the last row,
      // matching the previous sequential-upsert behavior, then write in bulk.
      const deduped = [...new Map(input.careReports.map(report => [report.consignmentId, report])).values()];
      const businessIds = [...new Set(deduped.map(report => report.businessId))];
      const matches: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from('leads').select('lead_id,business_id').in('business_id', businessIds).range(from, from + 999);
        if (error) throw error;
        matches.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const byBusiness = new Map<string, string[]>();
      for (const match of matches) {
        const ids = byBusiness.get(match.business_id) || []; ids.push(match.lead_id); byBusiness.set(match.business_id, ids);
      }
      const valid: typeof deduped = [];
      for (const report of deduped) {
        const leadMatches = byBusiness.get(report.businessId) || [];
        if (leadMatches.length > 1) {
          careReports[report.consignmentId] = { ok: false, error: 'Business ID matches multiple CRM leads; resolve that ambiguity first.' };
          errorCount++;
        } else valid.push(report);
      }
      if (valid.length) {
        const { error } = await admin.from('care_period_reports').upsert(valid.map(report => ({
          reporting_date: report.reportingDate, business_id: report.businessId, business_name: report.businessName,
          consignment_id: report.consignmentId, first_order_date: report.firstOrderDate,
          source_row: report.sourceRow, last_synced_at: new Date().toISOString(),
        })), { onConflict: 'consignment_id' });
        for (const report of valid) {
          if (error) {
            careReports[report.consignmentId] = { ok: false, error: String(error.message).slice(0, 1000) }; errorCount++;
          } else {
            careReports[report.consignmentId] = { ok: true, leadId: byBusiness.get(report.businessId)?.[0] || '' }; careImported++;
          }
        }
      }
    }

    const status = errorCount ? (callsImported + careImported + organicImported ? 'partial' : 'failed') : 'success';
    await admin.from('sheet_sync_runs').update({
      status, completed_at: new Date().toISOString(), calls_imported: callsImported,
      care_imported: careImported, organic_imported: organicImported + pickupImported, error_count: errorCount,
      message: errorCount ? `${errorCount} row(s) need attention in the input spreadsheet.` : 'All submitted rows synchronized.',
    }).eq('id', runId);
    return NextResponse.json({
      ok: !errorCount, runId, calls, careReports, organic, pickups,
      counts: { callsImported, careImported, organicImported, organicSkipped, pickupsImported: pickupImported, errors: errorCount },
    });
  } catch (error: any) {
    if (runId) await admin.from('sheet_sync_runs').update({ status: 'failed', completed_at: new Date().toISOString(), error_count: 1, message: String(error.message || error).slice(0, 1500) }).eq('id', runId);
    return NextResponse.json({ error: error.message || String(error) }, { status: 400 });
  }
}
