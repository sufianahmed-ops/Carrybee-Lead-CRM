import { buildBackupSheets } from './backup';
import { createAdminClient } from './supabase/admin';

export const BACKUP_PAGE_SIZE = 400;

export async function beginAppsScriptBackup(triggeredBy = 'apps-script') {
  const admin = createAdminClient();
  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await admin.from('backup_runs').select('id').eq('status', 'running').lt('started_at', staleBefore);
  const staleIds = (stale || []).map((run: any) => run.id);
  if (staleIds.length) {
    await admin.from('backup_snapshot_chunks').delete().in('run_id', staleIds);
    await admin.from('backup_runs').update({ status: 'failed', completed_at: new Date().toISOString(), message: 'Snapshot expired before completion.' }).in('id', staleIds);
  }
  const { data: run, error } = await admin.from('backup_runs').insert({ triggered_by: triggeredBy }).select('id').single();
  if (error) throw error;
  try {
    const sheets = await buildBackupSheets(admin);
    const manifest = [];
    for (const [name, values] of Object.entries(sheets)) {
      const headers = values[0] || [];
      const rows = values.slice(1);
      const chunkCount = Math.max(1, Math.ceil(rows.length / BACKUP_PAGE_SIZE));
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const chunk = rows.slice(chunkIndex * BACKUP_PAGE_SIZE, (chunkIndex + 1) * BACKUP_PAGE_SIZE)
          .map(row => Array.from({ length: headers.length }, (_, column) => row[column] ?? ''));
        const { error: saveError } = await admin.from('backup_snapshot_chunks').insert({
          run_id: run.id, sheet_name: name, chunk_index: chunkIndex,
          headers, rows: chunk, total_rows: rows.length,
        });
        if (saveError) throw saveError;
      }
      manifest.push({ name, chunks: chunkCount, totalRows: rows.length });
    }
    return { runId: run.id, sheets: manifest };
  } catch (error: any) {
    await admin.from('backup_runs').update({ status: 'failed', completed_at: new Date().toISOString(), message: error.message || String(error) }).eq('id', run.id);
    await admin.from('backup_snapshot_chunks').delete().eq('run_id', run.id);
    throw error;
  }
}

export async function readAppsScriptBackupChunk(runId: number, sheet: string, chunkIndex: number) {
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error('Invalid snapshot page.');
  const admin = createAdminClient();
  const { data: run, error: runError } = await admin.from('backup_runs').select('status').eq('id', runId).single();
  if (runError || run?.status !== 'running') throw new Error('Snapshot is not active.');
  const { data, error } = await admin.from('backup_snapshot_chunks')
    .select('headers,rows,total_rows').eq('run_id', runId).eq('sheet_name', sheet).eq('chunk_index', chunkIndex).single();
  if (error) throw error;
  return { runId, sheet, chunkIndex, headers: data.headers, rows: data.rows, totalRows: data.total_rows };
}

export async function finishAppsScriptBackup(input: { runId: number; success: boolean; leads: number; logs: number; message?: string }) {
  const admin = createAdminClient();
  const completedAt = new Date().toISOString();
  const { data: updated, error } = await admin.from('backup_runs').update({
    status: input.success ? 'success' : 'failed', completed_at: completedAt,
    leads_count: Math.max(0, input.leads || 0), calls_count: Math.max(0, input.logs || 0),
    message: input.message || (input.success ? 'Apps Script wrote the full snapshot to Google Sheets.' : 'Apps Script backup failed.'),
  }).eq('id', input.runId).eq('status', 'running').select('id');
  if (error) throw error;
  if (!updated?.length) throw new Error('Snapshot is not active or was already completed.');
  await admin.from('backup_snapshot_chunks').delete().eq('run_id', input.runId);
  return { ok: input.success, completedAt };
}
