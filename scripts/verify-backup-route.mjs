import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const baseUrl = process.env.APP_URL || 'https://carrybee-lead-crm.vercel.app';
const secret = process.env.CRON_SECRET;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(secret && url && serviceKey, 'CRON_SECRET and Supabase service-role environment variables are required.');
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const endpoint = `${baseUrl.replace(/\/$/, '')}/api/backup/apps-script`;
const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
let runId;

async function request(path = '', options = {}) {
  const response = await fetch(endpoint + path, options);
  const body = await response.json();
  return { status: response.status, body };
}

try {
  for (const options of [{}, { method: 'POST', body: JSON.stringify({ action: 'begin' }) }]) {
    const result = await request('', options);
    assert.equal(result.status, 401, 'Backup route must reject missing bearer authorization.');
  }

  const begun = await request('', { method: 'POST', headers, body: JSON.stringify({ action: 'begin' }) });
  assert.equal(begun.status, 200, JSON.stringify(begun.body));
  runId = begun.body.runId;
  assert(Number.isSafeInteger(runId) && runId > 0);
  assert(Array.isArray(begun.body.sheets) && begun.body.sheets.length >= 5);
  const totals = {};
  let downloadedRows = 0;
  let downloadedChunks = 0;

  for (const sheet of begun.body.sheets) {
    assert.match(sheet.name, /^[A-Za-z_]+$/);
    assert(Number.isInteger(sheet.totalRows) && sheet.totalRows >= 0);
    assert.equal(sheet.chunks, Math.max(1, Math.ceil(sheet.totalRows / 400)));
    totals[sheet.name] = sheet.totalRows;
    let actualRows = 0;
    let expectedHeaders;
    for (let chunk = 0; chunk < sheet.chunks; chunk++) {
      const path = `?runId=${runId}&sheet=${encodeURIComponent(sheet.name)}&chunk=${chunk}`;
      const page = await request(path, { headers });
      assert.equal(page.status, 200, `${sheet.name} chunk ${chunk}: ${JSON.stringify(page.body)}`);
      assert.equal(page.body.runId, runId);
      assert.equal(page.body.sheet, sheet.name);
      assert.equal(page.body.chunkIndex, chunk);
      assert.equal(page.body.totalRows, sheet.totalRows);
      assert(Array.isArray(page.body.headers) && page.body.headers.length > 0);
      assert(Array.isArray(page.body.rows));
      assert.equal(page.body.rows.length, Math.min(400, sheet.totalRows - chunk * 400));
      if (expectedHeaders) assert.deepEqual(page.body.headers, expectedHeaders);
      expectedHeaders = page.body.headers;
      for (const row of page.body.rows) assert.equal(row.length, expectedHeaders.length);
      actualRows += page.body.rows.length;
      downloadedChunks++;
    }
    assert.equal(actualRows, sheet.totalRows, `${sheet.name} must download completely.`);
    downloadedRows += actualRows;
  }

  assert.equal(totals.Leads, 11119, 'Unexpected migrated lead total.');
  assert.equal(totals.Call_Log, 15469, 'Unexpected migrated call-log total.');
  const completed = await request('', {
    method: 'POST', headers,
    body: JSON.stringify({ action: 'complete', runId, success: true, leads: totals.Leads, logs: totals.Call_Log, message: 'Automated production route smoke test; no Google Sheet was written.' }),
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.ok, true);
  const expired = await request(`?runId=${runId}&sheet=Leads&chunk=0`, { headers });
  assert.equal(expired.status, 400, 'Completed snapshots must no longer be downloadable.');
  console.log(JSON.stringify({ ok: true, runId, totals, downloadedRows, downloadedChunks, checks: ['bearer protection', 'frozen snapshot manifest', 'every sheet and chunk', 'row/header integrity', 'completion and snapshot expiry', 'QA history cleanup'] }, null, 2));
} finally {
  if (runId) {
    await admin.from('backup_snapshot_chunks').delete().eq('run_id', runId);
    const { error } = await admin.from('backup_runs').delete().eq('id', runId);
    if (error) console.error(`QA backup-run cleanup failed for ${runId}: ${error.message}`);
    else console.log(`QA backup run ${runId} and its temporary chunks were removed.`);
  }
}
