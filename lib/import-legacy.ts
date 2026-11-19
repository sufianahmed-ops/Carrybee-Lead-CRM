const text = (value: any) => String(value ?? '').trim();
const phoneClean = (value: any) => text(value).replace(/\D/g, '');

export function legacyDate(value: any): string | null {
  const s = text(value);
  if (!s) return null;
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return Number(match[1]) >= 2000 ? `${match[1]}-${match[2]}-${match[3]}` : null;
  match = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (match) {
    const result = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    const parsed = new Date(`${result}T00:00:00Z`);
    return Number(match[3]) < 2000 || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result ? null : result;
  }
  return null;
}

function legacyTimestamp(day: string, slot: number) {
  // Exact times were not stored in the old tracker. Early fixed times preserve
  // date order and the contact/FU1/FU2 sequence on equal dates.
  return new Date(`${day}T00:0${slot + 1}:00+06:00`).toISOString();
}

const normalizedName = (value: any) => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases: Record<string, string> = {
  sazzadhaider: 'mohammadsazzadhaider',
  ebrahimemu: 'mdebrahimemu',
};

const isSpreadsheetEpoch = (value: any) => /^(?:12\/(?:29|30|31)\/1899|1\/1\/1900|1899-12-(?:29|30|31)|1900-01-01)/.test(text(value));

const statusSlots = [
  { date: '1st Contact Date', status: '1st Contact Status', reason: '1st Contact Reason' },
  { date: '1st FU Date', status: '1st FU Status', reason: '1st FU Reason' },
  { date: '2nd FU Date', status: '2nd FU Status', reason: '2nd FU Reason' },
] as const;

function statusMap(rows: any[]) {
  const map = new Map(rows.filter(row => text(row['Old Status'])).map(row => [text(row['Old Status']), {
    status: text(row['New Status']), reason: text(row['Default Reason']),
  }]));
  // Explicitly approved during migration validation on 2026-11-10.
  map.set('Ineligible - Cold lead', { status: 'Follow Up - Cold', reason: 'Decision Pending' });
  return map;
}

export function validateLegacyImport(currentLeads: any[], legacyRows: any[], mapRows: any[]) {
  if (!legacyRows.length) return;
  const currentPhones = currentLeads.map(row => phoneClean(row.Phone ?? row.phone)).filter(Boolean);
  const legacyPhones = legacyRows.map(row => phoneClean(row.Phone)).filter(Boolean);
  if (legacyPhones.length !== legacyRows.length) throw new Error('Every Legacy_Import row must have a phone number.');
  if (new Set(currentPhones).size !== currentPhones.length) throw new Error('Current Leads has duplicate phones; safe legacy matching is not possible.');
  if (new Set(legacyPhones).size !== legacyPhones.length) throw new Error('Legacy_Import has duplicate phones; resolve them before importing.');
  const map = statusMap(mapRows);
  const unknown = new Set<string>();
  for (const row of legacyRows) for (const slot of statusSlots) {
    const oldStatus = text(row[slot.status]);
    if (oldStatus && !map.has(oldStatus)) unknown.add(oldStatus);
    const rawEventDate = text(row[slot.date]);
    if (oldStatus && rawEventDate && !legacyDate(rawEventDate) && !isSpreadsheetEpoch(rawEventDate)) throw new Error(`Invalid ${slot.date} for legacy phone ${text(row.Phone)}.`);
    if (oldStatus && !legacyDate(rawEventDate) && !legacyDate(row['Assign Date'])) throw new Error(`Missing usable ${slot.date} and Assign Date for legacy phone ${text(row.Phone)}.`);
    for (const field of ['Assign Date', 'Next Follow-up Date', '1st Trip Date']) {
      if (text(row[field]) && !legacyDate(row[field])) throw new Error(`Invalid ${field} for legacy phone ${text(row.Phone)}.`);
    }
  }
  if (unknown.size) throw new Error(`Unmapped legacy statuses: ${[...unknown].join(', ')}`);
}

export function prepareLegacyImport(input: {
  currentLeadRows: any[]; legacyRows: any[]; statusMapRows: any[];
  members: any[]; startingMaxId: number;
}) {
  const { currentLeadRows, legacyRows, statusMapRows, members } = input;
  validateLegacyImport(currentLeadRows, legacyRows, statusMapRows);
  const memberIds = new Map(members.map(member => [normalizedName(member.name), member.id]));
  const memberId = (name: any) => {
    const normalized = normalizedName(name);
    return memberIds.get(normalized) || memberIds.get(aliases[normalized] || '') || null;
  };
  const idsByPhone = new Map(currentLeadRows.map(row => [phoneClean(row.phone), row.lead_id]));
  let maxId = input.startingMaxId;
  const map = statusMap(statusMapRows);
  const leads: any[] = [];
  const logs: any[] = [];
  const unmatchedAgents: Record<string, number> = {};
  const mappedStatuses: Record<string, number> = {};
  let matchedCurrentLeads = 0;
  let approvedFallbacks = 0;
  let spreadsheetDateFallbacks = 0;

  for (const source of legacyRows) {
    const phone = phoneClean(source.Phone);
    let leadId = idsByPhone.get(phone);
    const matchedCurrent = Boolean(leadId);
    if (matchedCurrent) matchedCurrentLeads++;
    else {
      leadId = `CB-${String(++maxId).padStart(6, '0')}`;
      idsByPhone.set(phone, leadId);
    }
    const assignedTo = text(source['Assigned To']);
    const assignedId = memberId(assignedTo);
    if (assignedTo && !assignedId) unmatchedAgents[assignedTo] = (unmatchedAgents[assignedTo] || 0) + 1;
    const events = statusSlots.map((slot, index) => ({ slot, index, oldStatus: text(source[slot.status]) }))
      .filter(event => event.oldStatus);
    const latestIndex = events.length ? events[events.length - 1].index : -1;
    let latestTimestamp: string | null = null;

    for (const event of events) {
      const mapping = map.get(event.oldStatus)!;
      const day = legacyDate(source[event.slot.date]) || legacyDate(source['Assign Date'])!;
      const timestamp = legacyTimestamp(day, event.index);
      latestTimestamp = timestamp;
      mappedStatuses[mapping.status] = (mappedStatuses[mapping.status] || 0) + 1;
      if (event.oldStatus === 'Ineligible - Cold lead') approvedFallbacks++;
      if (isSpreadsheetEpoch(source[event.slot.date])) spreadsheetDateFallbacks++;
      const nextSlot = statusSlots[event.index + 1];
      const nextDate = event.index === latestIndex
        ? legacyDate(source['Next Follow-up Date'])
        : (nextSlot && text(source[nextSlot.status]) ? legacyDate(source[nextSlot.date]) : legacyDate(source['Next Follow-up Date']));
      const notes = [];
      if (isSpreadsheetEpoch(source[event.slot.date])) notes.push(`Original legacy date ${text(source[event.slot.date])} was a spreadsheet placeholder; Assign Date was used for ordering.`);
      if (event.oldStatus === 'Ineligible - Cold lead') notes.push(`Original legacy status: ${event.oldStatus}`);
      if (event.index === latestIndex && text(source.Remarks)) notes.push(text(source.Remarks));
      logs.push({
        log_id: `LEG-${leadId}-${String(event.index + 1).padStart(2, '0')}`,
        logged_at: timestamp, call_time: timestamp, lead_public_id: leadId,
        phone: text(source.Phone), agent_id: assignedId, agent_name: assignedTo,
        team: 'LQT', event_type: 'Call', status: mapping.status,
        reason: text(source[event.slot.reason]) || mapping.reason,
        channel: 'Phone call', points_covered: [], next_date: nextDate,
        note: notes.join(' | '), entry_source: 'Legacy',
      });
    }

    if (!matchedCurrent) {
      const notes = [text(source.Remarks)];
      if (assignedTo && !assignedId) notes.push(`Legacy assigned to: ${assignedTo}`);
      leads.push({
        lead_id: leadId, source: text(source.Source), phone: text(source.Phone),
        business_id: text(source['Business ID']), business_name: text(source['Business Name']),
        merchant_name: text(source['Merchant Name']), email: text(source.Email), fb_link: text(source['Fb Link']),
        product_category: text(source['Product Category']), parcel_volume: text(source['Parcel Volume']),
        zone: text(source.Zone), area: text(source.Area), existing_courier: text(source['Existing Courier']),
        assigned_to: assignedId, assign_date: legacyDate(source['Assign Date']), registration_date: null,
        sheet_notes: notes.filter(Boolean).join(' | '), incubation_agent: memberId(source['Incubation Agent']),
        handover_booked_time: null, handover_note: '', first_trip_date: legacyDate(source['1st Trip Date']),
        first_trip_cid: '', onboarded_form: '', pickup_miss: '',
        last_updated: latestTimestamp || (legacyDate(source['Assign Date']) ? legacyTimestamp(legacyDate(source['Assign Date'])!, 0) : new Date().toISOString()),
        last_updated_by: assignedId,
      });
    }
  }

  return {
    leads, logs,
    stats: {
      legacyRows: legacyRows.length, matchedCurrentLeads, newLegacyLeads: leads.length,
      legacyLogs: logs.length, approvedFallbacks, spreadsheetDateFallbacks, unmatchedAgents, mappedStatuses,
      finalLeadCount: currentLeadRows.length + leads.length, firstNewLeadId: leads[0]?.lead_id || null,
      lastNewLeadId: leads[leads.length - 1]?.lead_id || null,
    },
  };
}
