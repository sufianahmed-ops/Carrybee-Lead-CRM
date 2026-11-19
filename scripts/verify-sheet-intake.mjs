import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const baseUrl = (process.env.APP_URL || 'https://carrybee-lead-crm.vercel.app').replace(/\/$/, '');
const secret = process.env.CRON_SECRET;
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
assert(secret, 'CRON_SECRET is required');
const token = randomUUID().toUpperCase();
const prefix = `QA-SHEET-${token}`;
const runIds = [];
const logIds = [];
const consignmentIds = [];
const businessIds = [];
let sequence = 0;

function phone() {
  sequence += 1;
  return `019${String(Date.now()).slice(-7)}${String(sequence).padStart(1, '0')}`;
}
function call({ id, number, businessId, status = '1st Trip Complete', note = 'QA initial' }) {
  const logId = `SQ-${token}-${id}`;
  logIds.push(logId);
  if (!businessIds.includes(businessId)) businessIds.push(businessId);
  return {
    logId, phone: number, source: 'Inbound', businessId, businessName: 'QA isolated test',
    merchantName: 'QA merchant', email: '', fbLink: '', productCategory: '', parcelVolume: '',
    zone: '', area: '', existingCourier: '', assignedTo: '0d2f8220-f5ad-4cdf-af31-522a9fa417bd',
    assignDate: '2026-11-10', callTime: '2026-11-10T06:00:00Z', status, reason: '', channel: 'Phone',
    nextDate: '', note, points: [1, 2],
  };
}
function care(businessId, consignmentId, firstOrderDate = '2026-09-01') {
  if (!consignmentIds.includes(consignmentId)) consignmentIds.push(consignmentId);
  return { reportingDate: '2026-11-10', businessId, businessName: 'QA isolated test', consignmentId, firstOrderDate, sourceRow: 'QA' };
}
async function request(path, options = {}, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${path}: ${response.status} ${JSON.stringify(body)}`);
  if (body.runId) runIds.push(body.runId);
  return body;
}
async function post(calls, careReports, organicRows = []) {
  return request('/api/sheets-intake', { method: 'POST', body: JSON.stringify({ action: 'sync', calls, careReports, organicRows }) });
}

function organic({ id, number, businessId, registrationDate = '2026-11-10' }) {
  if (!businessIds.includes(businessId)) businessIds.push(businessId);
  return {
    rowKey: `DD2-QA-${token}-${id}`, registrationDate, phone: number, businessId,
    businessName: 'QA organic intake', merchantName: 'QA merchant', email: '',
    storeAddress: 'QA address', profileCompleted: 'No', activePaymentMethod: 'bank',
  };
}

try {
  const unauthenticated = await fetch(`${baseUrl}/api/sheets-intake`);
  assert.equal(unauthenticated.status, 401, 'Bearer protection must reject anonymous requests');

  const config = await request('/api/sheets-intake');
  assert(config.members.length >= 7, 'Configuration must include active team members');
  assert(config.rules.length > 0 && config.channels.length > 0, 'Configuration must include status rules and channels');
  assert.equal(config.careDays, 30);
  assert.equal(config.legacyCutoff, '2026-11-04');

  const primaryBusiness = `${prefix}-PRIMARY`;
  const primary = call({ id: 'A', number: phone(), businessId: primaryBusiness });
  const bad = call({ id: 'B', number: phone(), businessId: `${prefix}-BAD`, status: 'QA INVALID STATUS' });
  const primaryCare = care(primaryBusiness, `${prefix}-CID-PRIMARY`);

  const mixed = await post([primary, bad], [primaryCare]);
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.counts, { callsImported: 1, careImported: 1, organicImported: 0, organicSkipped: 0, errors: 1 });
  assert.equal(mixed.calls[primary.logId].ok, true);
  assert.equal(mixed.calls[bad.logId].ok, false);
  assert.equal(mixed.careReports[primaryCare.consignmentId].ok, true);

  const retryCall = { ...primary, phone: `+880${primary.phone.slice(1)}`, note: 'QA retry updated' };
  const retry = await post([retryCall], [primaryCare]);
  assert.equal(retry.ok, true);
  assert.deepEqual(retry.counts, { callsImported: 1, careImported: 1, organicImported: 0, organicSkipped: 0, errors: 0 });

  const { data: primaryLeads, error: leadError } = await admin.from('leads').select('id,lead_id').eq('business_id', primaryBusiness);
  assert.ifError(leadError);
  assert.equal(primaryLeads.length, 1, 'Normalized-phone retry must not duplicate the lead');
  const { data: logs, error: logError } = await admin.from('call_logs').select('id,note,lead_id').eq('log_id', primary.logId);
  assert.ifError(logError);
  assert.equal(logs.length, 1, 'Call-ID retry must not duplicate the log');
  assert.equal(logs[0].lead_id, primaryLeads[0].id);
  assert.equal(logs[0].note, 'QA retry updated');

  const earlierCare = care(primaryBusiness, `${prefix}-CID-EARLIER`, '2026-08-15');
  const earlier = await post([], [earlierCare]);
  assert.equal(earlier.ok, true);
  const { data: details, error: detailError } = await admin.from('lead_details').select('lead_id,first_order_date,current_status,care_days_left').eq('lead_id', primaryLeads[0].lead_id).single();
  assert.ifError(detailError);
  assert.equal(details.first_order_date, '2026-08-15', 'The earliest Care Period order date must win');
  assert.equal(details.current_status, 'Care Completed');
  assert.equal(details.care_days_left, null, 'Completed care must not remain an active countdown');

  const cross = { ...primary, phone: phone(), businessId: `${prefix}-CROSS` };
  const crossResult = await post([cross], []);
  assert.equal(crossResult.calls[primary.logId].ok, false, 'A Call ID cannot move to another lead');
  const { data: crossLeads } = await admin.from('leads').select('id').eq('business_id', cross.businessId);
  assert.equal(crossLeads.length, 0, 'Failed cross-lead import must roll back its new lead');

  const ambiguousBusiness = `${prefix}-AMBIGUOUS`;
  const first = call({ id: 'D', number: phone(), businessId: ambiguousBusiness, status: 'New' });
  const second = call({ id: 'E', number: phone(), businessId: ambiguousBusiness, status: 'New' });
  const ambiguousSetup = await post([first, second], []);
  assert.equal(ambiguousSetup.ok, true);
  const ambiguousCare = care(ambiguousBusiness, `${prefix}-CID-AMBIGUOUS`);
  const ambiguous = await post([], [ambiguousCare]);
  assert.equal(ambiguous.careReports[ambiguousCare.consignmentId].ok, false, 'Ambiguous Business IDs must be rejected');
  assert.match(ambiguous.careReports[ambiguousCare.consignmentId].error, /multiple CRM leads/i);

  const invalidPhone = call({ id: 'F', number: '1234567890', businessId: `${prefix}-INVALID-PHONE`, status: 'New' });
  const invalidPhoneResult = await post([invalidPhone], []);
  assert.equal(invalidPhoneResult.calls[invalidPhone.logId].ok, false, 'Invalid Bangladeshi phone numbers must be rejected');

  const organicBusiness = `${prefix}-ORGANIC`;
  const organicRow = organic({ id: 'NEW', number: phone(), businessId: organicBusiness });
  const organicInsert = await post([], [], [organicRow]);
  assert.equal(organicInsert.counts.organicImported, 1);
  assert.equal(organicInsert.organic[organicRow.rowKey].status, 'inserted');
  const organicRetry = await post([], [], [{ ...organicRow, phone: `+880${organicRow.phone.slice(1)}` }]);
  assert.equal(organicRetry.counts.organicImported, 0);
  assert.equal(organicRetry.counts.organicSkipped, 1);
  assert.equal(organicRetry.organic[organicRow.rowKey].status, 'skipped_existing');
  const { data: organicLeads, error: organicLeadError } = await admin.from('leads').select('id,lead_id,source,assigned_to,registration_date').eq('business_id', organicBusiness);
  assert.ifError(organicLeadError);
  assert.equal(organicLeads.length, 1, 'Organic retry must not duplicate a lead');
  assert.equal(organicLeads[0].source, 'Self Registered');
  assert.equal(organicLeads[0].assigned_to, null, 'Self-registered leads must start unassigned');
  const { count: organicLogs, error: organicLogError } = await admin.from('call_logs').select('id', { count: 'exact', head: true }).eq('lead_id', organicLeads[0].id);
  assert.ifError(organicLogError);
  assert.equal(organicLogs, 0, 'Self-registered intake must not create a fake call log');

  const legacyOrganic = organic({ id: 'LEGACY', number: phone(), businessId: `${prefix}-ORGANIC-LEGACY`, registrationDate: '2026-11-04' });
  const legacyResult = await post([], [], [legacyOrganic]);
  assert.equal(legacyResult.organic[legacyOrganic.rowKey].status, 'skipped_legacy');
  const { data: legacyLeads } = await admin.from('leads').select('id').eq('business_id', legacyOrganic.businessId);
  assert.equal(legacyLeads.length, 0, 'Legacy-cutoff rows must not be inserted');
  const duplicateOrganic = organic({ id: 'DUPLICATE', number: organicRow.phone, businessId: `${prefix}-ORGANIC-DUPLICATE` });
  const duplicateResult = await post([], [], [duplicateOrganic]);
  assert.equal(duplicateResult.organic[duplicateOrganic.rowKey].status, 'skipped_existing');
  const { data: duplicateLeads } = await admin.from('leads').select('id').eq('business_id', duplicateOrganic.businessId);
  assert.equal(duplicateLeads.length, 0, 'An existing phone must preserve the original lead and skip the duplicate');
  const invalidOrganic = organic({ id: 'INVALID', number: '1234567890', businessId: `${prefix}-ORGANIC-INVALID` });
  const invalidOrganicResult = await post([], [], [invalidOrganic]);
  assert.equal(invalidOrganicResult.organic[invalidOrganic.rowKey].ok, false, 'Invalid organic phones must return row-level errors');

  const { count: careCount, error: careCountError } = await admin.from('care_period_reports').select('id', { count: 'exact', head: true }).in('consignment_id', consignmentIds);
  assert.ifError(careCountError);
  assert.equal(careCount, 2, 'Only the two non-ambiguous care reports should persist');

  console.log(JSON.stringify({
    ok: true,
    checks: ['bearer protection', 'configuration', 'mixed row results', 'normalized-phone upsert', 'Call-ID upsert', 'cross-lead rejection', 'invalid-phone rejection', 'Care Consignment-ID upsert', 'earliest First Order Date', 'Care Completed calculation', 'ambiguous Business-ID rejection', 'Self-Registered insert without fake call log', 'Self-Registered retry and duplicate preservation', 'legacy cutoff', 'organic invalid-phone rejection'],
    syncRuns: runIds.length,
    persistentTestRowsBeforeCleanup: { leads: 4, logs: 3, careReports: careCount },
  }, null, 2));
} finally {
  const errors = [];
  if (logIds.length) {
    const { error } = await admin.from('call_logs').delete().in('log_id', [...new Set(logIds)]);
    if (error) errors.push(error.message);
  }
  if (consignmentIds.length) {
    const { error } = await admin.from('care_period_reports').delete().in('consignment_id', consignmentIds);
    if (error) errors.push(error.message);
  }
  if (businessIds.length) {
    const { error } = await admin.from('leads').delete().in('business_id', [...new Set(businessIds)]);
    if (error) errors.push(error.message);
  }
  if (runIds.length) {
    const { error } = await admin.from('sheet_sync_runs').delete().in('id', [...new Set(runIds)]);
    if (error) errors.push(error.message);
  }
  assert.deepEqual(errors, [], `Cleanup failed: ${errors.join('; ')}`);
  console.log('QA cleanup completed: test calls, leads, care reports, and sync runs removed.');
}
