import { createAdminClient } from '../lib/supabase/admin';
import { prepareLegacyImport, validateLegacyImport } from './import-legacy';

function date(value: any): string | null {
  const s = String(value ?? '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  const parsed = new Date(s); return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0,10);
}
function timestamp(value: any): string | null {
  const s = String(value ?? '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[1]}T${m[2]}:${m[3] || '00'}+06:00`).toISOString();
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})[ ,]+(\d{1,2}):(\d{2})/);
  if (m) return new Date(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5]}:00+06:00`).toISOString();
  const parsed = new Date(s); return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
const text = (v: any) => String(v ?? '').trim();
const bool = (v: any) => /^(yes|true)$/i.test(text(v));
async function chunks(rows: any[], save: (chunk: any[]) => Promise<void>, size = 400) {
  for (let i=0;i<rows.length;i+=size) { await save(rows.slice(i,i+size)); console.log(`  ${Math.min(i+size,rows.length)}/${rows.length}`); }
}
async function allRows(admin: any, table: string, columns: string) {
  const result: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 1000) return result;
  }
}
export async function importCrmRows(tab: (name: string) => Promise<any[]>) {
  const admin = createAdminClient();
  console.log('Reading configuration and team…');
  const [settings,rules,scripts,team,listRows,leads,logs,legacyRows,legacyStatusMap] = await Promise.all([
    tab('Settings'),tab('Status_Rules'),tab('Call_Script'),tab('Team'),tab('Lists'),tab('Leads'),tab('Call_Log'),
    tab('Legacy_Import'),tab('Legacy_Status_Map'),
  ]);
  const sourceIds = leads.map(l => text(l['Lead ID'])).filter(Boolean);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('The source Leads tab contains duplicate Lead ID values. Resolve them before importing.');
  const sourceLogIds = logs.map(l => text(l['Log ID'])).filter(Boolean);
  if (new Set(sourceLogIds).size !== sourceLogIds.length) throw new Error('The source Call_Log tab contains duplicate Log ID values. Resolve them before importing.');
  validateLegacyImport(leads, legacyRows, legacyStatusMap);
  for (const r of settings) if (text(r.Key)) {
    const { error } = await admin.from('app_settings').upsert({ key:text(r.Key), value:text(r.Value), description:text(r['What it controls']) }); if (error) throw error;
  }
  for (const r of rules) if (text(r.Status)) {
    const { error } = await admin.from('status_rules').upsert({ status:text(r.Status),stage:text(r.Stage),tab:text(r.Tab),is_final:bool(r['Is Final']),set_by:text(r['Set By']),needs_next_date:bool(r['Needs Next Date']),reason_required:bool(r['Reason Required']),allowed_reasons:text(r['Allowed Reasons']).split(',').map(x=>x.trim()).filter(Boolean),meaning:text(r.Meaning) }); if (error) throw error;
  }
  for (const r of scripts) if (text(r['#'])) {
    const { error } = await admin.from('call_scripts').upsert({ point_number:Number(r['#']),talking_point:text(r['Talking Point']),script_text:text(r['Script (what the agent says)']) }); if (error) throw error;
  }
  const categories = ['Source','Funnel','Zone','Existing Courier','Product Category','Parcel Volume','Channel','Yes/No'];
  for (const row of listRows) for (const category of categories) {
    if (!text(row[category]) || category === 'Funnel') continue;
    const { error } = await admin.from('list_values').upsert({ category,value:text(row[category]),sort_order:999 }); if (error) throw error;
  }
  console.log('Linking team members by Employee ID/name…');
  for (const r of team) {
    const name=text(r.Name); if (!name) continue;
    const employeeId=text(r['Employee ID']) || null; const email=text(r.Email) || null;
    const { data: existing } = await admin.from('team_members').select('id,email,team,role,active,auth_user_id').or(`name.eq.${name.replace(/,/g,' ')},employee_id.eq.${employeeId || '__none__'},email.eq.${email || '__none__'}`).limit(1).maybeSingle();
    // Auth-linked members may already have corrected work emails/roles from invitation setup.
    const row = {
      name,
      email: email || existing?.email || null,
      team: existing?.auth_user_id ? existing.team : (text(r.Team) || 'LQT'),
      role: existing?.auth_user_id ? existing.role : (text(r.Role) || 'Agent'),
      active: text(r.Active) ? bool(r.Active) : (existing?.active ?? true),
      employee_id: employeeId,
    };
    const query = existing?.id ? admin.from('team_members').update(row).eq('id',existing.id) : admin.from('team_members').insert(row);
    const { error } = await query; if (error) throw error;
  }
  const { data: members,error:memberError } = await admin.from('team_members').select('*'); if (memberError) throw memberError;
  const memberByName = new Map(members.map((m:any)=>[m.name,m.id]));
  console.log(`Importing ${leads.length} leads…`);
  let maxId=0; for(const l of leads){const n=Number(text(l['Lead ID']).match(/(\d+)$/)?.[1]||0);maxId=Math.max(maxId,n);}
  const leadRows = leads.filter(l=>text(l.Phone)||text(l['Lead ID'])).map((l:any)=>{
    const id=text(l['Lead ID']) || `CB-${String(++maxId).padStart(6,'0')}`;
    return { lead_id:id,source:text(l.Source),phone:text(l.Phone),business_id:text(l['Business ID']),business_name:text(l['Business Name']),merchant_name:text(l['Merchant Name']),email:text(l.Email),fb_link:text(l['Fb Link']),product_category:text(l['Product Category']),parcel_volume:text(l['Parcel Volume']),zone:text(l.Zone),area:text(l.Area),existing_courier:text(l['Existing Courier']),assigned_to:memberByName.get(text(l['Assigned To']))||null,assign_date:date(l['Assign Date']),registration_date:date(l['Registration Date']),sheet_notes:text(l['Sheet Notes']),incubation_agent:memberByName.get(text(l['Incubation Agent']))||null,handover_booked_time:timestamp(l['Handover Booked Time']),handover_note:text(l['Handover Note']),first_trip_date:date(l['1st Trip Date']),first_trip_cid:text(l['1st Trip CID']),onboarded_form:text(l['Onboarded Form']),pickup_miss:text(l['Pickup Miss']),last_updated:timestamp(l['Last Updated'])||new Date().toISOString(),last_updated_by:memberByName.get(text(l['Last Updated By']))||null };
  });
  const legacyPrepared = prepareLegacyImport({ currentLeadRows: leadRows, legacyRows, statusMapRows: legacyStatusMap, members, startingMaxId: maxId });
  const allLeadRows = [...leadRows, ...legacyPrepared.leads];
  if (legacyRows.length) console.log(`Legacy plan: ${legacyPrepared.stats.matchedCurrentLeads} matched, ${legacyPrepared.stats.newLegacyLeads} new leads, ${legacyPrepared.stats.legacyLogs} historical events.`);
  await chunks(allLeadRows,async chunk=>{const {error}=await admin.from('leads').upsert(chunk,{onConflict:'lead_id'});if(error)throw error;});
  const dbLeads = await allRows(admin, 'leads', 'id,lead_id');
  const leadUuid=new Map(dbLeads.map((l:any)=>[l.lead_id,l.id])); let skippedLogs=0;
  console.log(`Importing ${logs.length} call/event logs…`);
  const logRows = logs.filter((l:any)=>text(l['Lead ID'])).map((l:any,i:number)=>{
    const uuid=leadUuid.get(text(l['Lead ID'])); if(!uuid){skippedLogs++;return null;}
    const logged=timestamp(l['Logged At'])||timestamp(l['Call Time'])||new Date().toISOString();
    const points=text(l['Points Covered']).split('|').map(x=>x.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    return { log_id:text(l['Log ID'])||`IMPORT-${text(l['Lead ID'])}-${i}`,logged_at:logged,call_time:timestamp(l['Call Time'])||logged,lead_id:uuid,phone:text(l.Phone),agent_id:memberByName.get(text(l.Agent))||null,agent_name:text(l.Agent),team:text(l.Team),event_type:text(l['Event Type'])||'Call',status:text(l.Status),reason:text(l.Reason),channel:text(l.Channel),points_covered:points,next_date:date(l['Next Date']),note:text(l.Note),entry_source:text(l['Entry Source'])||'CRM' };
  }).filter(Boolean);
  const legacyLogRows = legacyPrepared.logs.map(({ lead_public_id, ...row }) => {
    const uuid = leadUuid.get(lead_public_id);
    if (!uuid) { skippedLogs++; return null; }
    return { ...row, lead_id: uuid };
  }).filter(Boolean);
  const allLogRows = [...logRows, ...legacyLogRows];
  await chunks(allLogRows,async chunk=>{const {error}=await admin.from('call_logs').upsert(chunk,{onConflict:'log_id'});if(error)throw error;});
  const { error:seqError }=await admin.rpc('sync_lead_sequence');if(seqError)throw seqError;
  console.log(`Migration complete: ${allLeadRows.length} leads, ${allLogRows.length} logs (${legacyLogRows.length} legacy); ${skippedLogs} logs skipped because their lead was absent.`);
}
