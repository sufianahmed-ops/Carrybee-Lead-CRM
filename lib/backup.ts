import { createAdminClient } from './supabase/admin';
import { sheetsClient } from './google';

async function all(admin: any, table: string, order = 'id'): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').order(order).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
const dt = (v: any) => v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)).replace(',', '') : '';
const d = (v: any) => v ? String(v).slice(0, 10) : '';

const leadHeaders = ['Lead ID','Source','Phone','Business ID','Business Name','Merchant Name','Email','Fb Link','Product Category','Parcel Volume','Zone','Area','Existing Courier','Assigned To','Assign Date','Registration Date','Sheet Notes','Incubation Agent','Handover Booked Time','Handover Note','1st Trip Date','1st Trip CID','Onboarded Form','Pickup Miss','Last Updated','Last Updated By','Phone Clean','Funnel','Duplicate Phone','Total Calls','LQT Touches','First Contact Date','Last Call Date','Current Status','Stage','Tab','Is Final','Current Owner','CNR Count','Points Covered','Handover Accepted Date','Trip Deadline','Care End Date','Care Days Left','Next Due Date','Due State','Must Close Next Call','Next Date Default','Next Date Max','First Contact Late','SLA Breach','Trip Overdue','Handover Call Due','Handover Call State','Missing Business ID','Return Reason','Has Legacy','In Onboarding Tracker','Priority','Alert'];
const logHeaders = ['Log ID','Logged At','Call Time','Lead ID','Phone','Agent','Team','Event Type','Status','Reason','Channel','Points Covered','Next Date','Note','Entry Source'];

export type BackupSheetMap = Record<string, any[][]>;

export async function buildBackupSheets(admin: any): Promise<BackupSheetMap> {
    const [leads, logs, members, settings, rules, lists, scripts, sources, careReports] = await Promise.all([
      all(admin, 'lead_details', 'lead_id'), all(admin, 'call_history', 'call_time'),
      all(admin, 'team_members', 'name'), all(admin, 'app_settings', 'key'),
      all(admin, 'status_rules', 'status'), all(admin, 'list_values', 'category'),
      all(admin, 'call_scripts', 'point_number'), all(admin, 'lead_sources', 'source'), all(admin, 'care_period_reports', 'consignment_id'),
    ]);
    const memberNames = Object.fromEntries(members.map((m: any) => [m.id, m.name]));
    const leadRows = leads.map((l: any) => [l.lead_id,l.source,l.phone,l.business_id,l.business_name,l.merchant_name,l.email,l.fb_link,l.product_category,l.parcel_volume,l.zone,l.area,l.existing_courier,l.assigned_to_name,d(l.assign_date),d(l.registration_date),l.sheet_notes,l.incubation_agent_name,dt(l.handover_booked_time),l.handover_note,d(l.first_trip_date),l.first_trip_cid,l.onboarded_form,l.pickup_miss,dt(l.last_updated),memberNames[l.last_updated_by] || '',l.phone_clean,l.funnel,l.duplicate_phone,l.total_calls,l.lqt_touches,d(l.first_contact_date),d(l.last_call_date),l.current_status,l.stage,l.tab,l.is_final,l.current_owner,l.cnr_count,l.points_covered,d(l.handover_accepted_date),d(l.trip_deadline),d(l.care_end_date),l.care_days_left,d(l.next_due_date),l.due_state,l.must_close_next_call,d(l.next_date_default),d(l.next_date_max),l.first_contact_late,l.sla_breach,l.trip_overdue,dt(l.handover_call_due),l.handover_call_state,l.missing_business_id,l.return_reason,l.has_legacy,l.in_onboarding_tracker,l.priority,l.alert]);
    const logRows = logs.map((l: any) => [l.log_id,dt(l.logged_at),dt(l.call_time),l.public_lead_id,l.phone,l.agent_name,l.team,l.event_type,l.status,l.reason,l.channel,(l.points_covered || []).join('|'),d(l.next_date),l.note,l.entry_source]);
    const counts = Object.values(leads.reduce((a: any, l: any) => { a[l.tab] = (a[l.tab] || 0) + 1; return a; }, {}));
    const tabNames = Object.keys(leads.reduce((a: any, l: any) => { a[l.tab] = true; return a; }, {}));
    const sheets: Record<string, any[][]> = {
      Leads: [leadHeaders, ...leadRows], Call_Log: [logHeaders, ...logRows],
      Care_Period: [['Reporting Date','Business ID','Business Name','Consignment ID','First Order Date'], ...careReports.map((r: any) => [d(r.reporting_date),r.business_id,r.business_name,r.consignment_id,d(r.first_order_date)])],
      Team: [['Name','Email','Team','Role','Active','Employee ID','Auth Linked'], ...members.map((m: any) => [m.name,m.email || '',m.team,m.role,m.active ? 'TRUE' : 'FALSE',m.employee_id || '',m.auth_user_id ? 'Yes' : 'No'])],
      Settings: [['Key','Value','What it controls'], ...settings.map((s: any) => [s.key,s.value,s.description])],
      Status_Rules: [['Status','Stage','Tab','Is Final','Set By','Needs Next Date','Reason Required','Allowed Reasons','Meaning'], ...rules.map((r: any) => [r.status,r.stage,r.tab,r.is_final ? 'Yes' : 'No',r.set_by,r.needs_next_date ? 'Yes' : 'No',r.reason_required ? 'Yes' : 'No',(r.allowed_reasons || []).join(', '),r.meaning])],
      Lists: [['Category','Value','Sort Order'], ...lists.map((l: any) => [l.category,l.value,l.sort_order])],
      Lead_Sources: [['Source','Funnel'], ...sources.map((s: any) => [s.source,s.funnel])],
      Call_Script: [['#','Talking Point','Script (what the agent says)'], ...scripts.map((s: any) => [s.point_number,s.talking_point,s.script_text])],
      Dashboard: [['Tab','Count'], ...tabNames.map((name, i) => [name, counts[i]]), [], ['Metric','Count'],['All Leads',leads.length],['Call Logs',logs.length],['Open Leads',leads.filter((l: any) => l.is_final === 'No').length],['Overdue',leads.filter((l: any) => l.due_state === 'Overdue').length],['Due Today',leads.filter((l: any) => l.due_state === 'Due Today').length],['SLA Breached',leads.filter((l: any) => l.sla_breach === 'Breached').length]],
    };
  return sheets;
}

export async function runBackup(triggeredBy = 'cron') {
  const admin = createAdminClient();
  const spreadsheetId = process.env.GOOGLE_BACKUP_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_BACKUP_SPREADSHEET_ID is not configured.');
  const { data: run, error: runError } = await admin.from('backup_runs').insert({ triggered_by: triggeredBy }).select().single();
  if (runError) throw runError;
  try {
    const sheets = await buildBackupSheets(admin);
    const client = sheetsClient();
    const meta = await client.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    const existing = new Set((meta.data.sheets || []).map(s => s.properties?.title));
    const wanted = [...Object.keys(sheets), 'Backup_Status'];
    const missing = wanted.filter(name => !existing.has(name));
    if (missing.length) await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: missing.map(title => ({ addSheet: { properties: { title } } })) } });
    for (const [name, values] of Object.entries(sheets)) {
      await client.spreadsheets.values.clear({ spreadsheetId, range: `'${name}'!A:AZ` });
      await client.spreadsheets.values.update({ spreadsheetId, range: `'${name}'!A1`, valueInputOption: 'RAW', requestBody: { values } });
    }
    const finished = new Date().toISOString();
    const leadsCount = sheets.Leads.length - 1;
    const logsCount = sheets.Call_Log.length - 1;
    await client.spreadsheets.values.clear({ spreadsheetId, range: "'Backup_Status'!A:E" });
    await client.spreadsheets.values.update({ spreadsheetId, range: "'Backup_Status'!A1", valueInputOption: 'RAW', requestBody: { values: [['Status','Finished At (UTC)','Leads','Call Logs','Source'],['SUCCESS',finished,leadsCount,logsCount,'Supabase → Google Sheets; Supabase is the source of truth']] } });
    await admin.from('backup_runs').update({ status: 'success', completed_at: finished, leads_count: leadsCount, calls_count: logsCount, message: 'Snapshot written to Google Sheets.' }).eq('id', run.id);
    return { ok: true, leads: leadsCount, logs: logsCount, finished };
  } catch (error: any) {
    await admin.from('backup_runs').update({ status: 'failed', completed_at: new Date().toISOString(), message: error.message || String(error) }).eq('id', run.id);
    throw error;
  }
}
