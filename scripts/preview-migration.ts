import { readFile, writeFile } from 'node:fs/promises';
import { prepareLegacyImport, validateLegacyImport } from '../lib/import-legacy';

const text = (value: any) => String(value ?? '').trim();

async function main() {
  const workbook = JSON.parse(await readFile(process.env.IMPORT_WORKBOOK_JSON || 'import-data.json', 'utf8'));
  const leads = workbook.Leads || [];
  const logs = workbook.Call_Log || [];
  const legacy = workbook.Legacy_Import || [];
  const statusMap = workbook.Legacy_Status_Map || [];
  const currentLeadRows = leads.filter((row: any) => text(row.Phone) || text(row['Lead ID'])).map((row: any) => ({
    lead_id: text(row['Lead ID']), phone: text(row.Phone),
  }));
  validateLegacyImport(leads, legacy, statusMap);
  const startingMaxId = Math.max(0, ...currentLeadRows.map((row: any) => Number(row.lead_id.match(/(\d+)$/)?.[1] || 0)));
  const members = (workbook.Team || []).filter((row: any) => text(row.Name)).map((row: any) => ({ id: text(row.Name), name: text(row.Name) }));
  const prepared = prepareLegacyImport({ currentLeadRows, legacyRows: legacy, statusMapRows: statusMap, members, startingMaxId });
  const leadIds = [...currentLeadRows.map((row: any) => row.lead_id), ...prepared.leads.map(row => row.lead_id)];
  const logIds = [...logs.map((row: any) => text(row['Log ID'])).filter(Boolean), ...prepared.logs.map(row => row.log_id)];
  if (new Set(leadIds).size !== leadIds.length) throw new Error('Preview contains duplicate lead IDs.');
  if (new Set(logIds).size !== logIds.length) throw new Error('Preview contains duplicate log IDs.');
  const leadIdSet = new Set(leadIds);
  if (prepared.logs.some(row => !leadIdSet.has(row.lead_public_id))) throw new Error('A legacy log has no destination lead.');
  const knownStatuses = new Set((workbook.Status_Rules || []).map((row: any) => text(row.Status)));
  const unknownMappedStatuses = Object.keys(prepared.stats.mappedStatuses).filter(status => !knownStatuses.has(status));
  if (unknownMappedStatuses.length) throw new Error(`Mapped statuses missing from Status_Rules: ${unknownMappedStatuses.join(', ')}`);
  if (prepared.stats.matchedCurrentLeads + prepared.stats.newLegacyLeads !== legacy.length) throw new Error('Legacy row accounting mismatch.');
  if (prepared.logs.some(row => row.entry_source !== 'Legacy')) throw new Error('Legacy entry-source validation failed.');

  const summary = {
    currentLeads: currentLeadRows.length, currentLogs: logs.length,
    ...prepared.stats, finalLogs: logs.length + prepared.logs.length,
    finalLeadIds: leadIds.length, finalLogIds: logIds.length,
  };
  const statusRows = Object.entries(prepared.stats.mappedStatuses).sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `| ${status} | ${count} |`).join('\n');
  const agentRows = Object.entries(prepared.stats.unmatchedAgents).map(([name, count]) => `| ${name} | ${count} | Preserved as text; no new user created |`).join('\n');
  const markdown = `# CRM migration dry-run preview\n\n**No production data has been imported by this preview.**\n\n| Check | Result |\n|---|---:|\n| Current leads preserved | ${summary.currentLeads} |\n| Current call/event logs preserved | ${summary.currentLogs} |\n| Legacy rows read | ${summary.legacyRows} |\n| Current leads matched one-to-one by phone | ${summary.matchedCurrentLeads} |\n| New legacy-only leads to create | ${summary.newLegacyLeads} |\n| Legacy status events to import | ${summary.legacyLogs} |\n| **Final leads** | **${summary.finalLeadCount}** |\n| **Final call/event logs** | **${summary.finalLogs}** |\n| Generated lead ID range | ${summary.firstNewLeadId} – ${summary.lastNewLeadId} |\n| Approved “Ineligible - Cold lead” fallbacks | ${summary.approvedFallbacks} → Follow Up - Cold / Decision Pending |\n| Spreadsheet-placeholder dates handled with Assign Date | ${summary.spreadsheetDateFallbacks} |\n| Duplicate final lead IDs | 0 |\n| Duplicate final log IDs | 0 |\n| Legacy logs without a destination lead | 0 |\n| Mapped statuses absent from Status_Rules | 0 |\n\n## Mapped legacy history\n\n| New status | Events |\n|---|---:|\n${statusRows}\n\n## Agents without current CRM accounts\n\n| Legacy agent | Rows | Handling |\n|---|---:|---|\n${agentRows || '| None | 0 | All matched |'}\n\n## Migration behavior\n\n- Current lead IDs and base details are preserved; legacy rows add history to their matching leads.\n- Only legacy-only phones receive new sequential lead IDs.\n- Exact legacy times were unavailable; fixed early times preserve status-date and contact/FU ordering.\n- Old statuses are stored with Entry Source = Legacy. Newer current-tracker logs remain authoritative by timestamp.\n- Legacy remarks and unmatched agent names are preserved in notes/history.\n- Generated IDs are deterministic, so a failed import can be rerun without duplication.\n`;
  await writeFile('migration-preview.md', markdown);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
