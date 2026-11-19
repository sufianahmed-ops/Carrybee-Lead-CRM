// Reusable filter parsing + export columns for Reports
export const ALLOWED_DATE_FIELDS = [
  'registration_date',
  'assign_date',
  'last_status_date',
  'next_due_date',
  'first_contact_date',
  'first_trip_date',
  'qualified_at',
  'care_end_date',
  'handover_booked_time',
] as const;

export type DateField = (typeof ALLOWED_DATE_FIELDS)[number];

export const EXPORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'lead_id', label: 'Lead ID' },
  { key: 'business_id', label: 'Business ID' },
  { key: 'business_name', label: 'Business Name' },
  { key: 'merchant_name', label: 'Merchant Name' },
  { key: 'phone_clean', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'source', label: 'Source' },
  { key: 'lead_generation', label: 'Generation (New/Old)' },
  { key: 'zone', label: 'Zone' },
  { key: 'area', label: 'Area' },
  { key: 'product_category', label: 'Product Category' },
  { key: 'parcel_volume', label: 'Parcel Volume' },
  { key: 'existing_courier', label: 'Existing Courier' },
  { key: 'registration_date', label: 'Registration Date' },
  { key: 'assign_date', label: 'Assign Date' },
  { key: 'assigned_to_name', label: 'Assigned To' },
  { key: 'current_owner', label: 'Current Owner' },
  { key: 'current_status', label: 'Lead Status' },
  { key: 'last_reason', label: 'Last Reason' },
  { key: 'stage', label: 'Stage' },
  { key: 'tab', label: 'Tab' },
  { key: 'is_final', label: 'Is Final' },
  { key: 'priority', label: 'Priority' },
  { key: 'due_state', label: 'Due State' },
  { key: 'next_due_date', label: 'Next Due Date' },
  { key: 'total_calls', label: 'Total Calls' },
  { key: 'lqt_touches', label: 'LQT Touches' },
  { key: 'first_contact_date', label: 'First Contact Date' },
  { key: 'last_call_date', label: 'Last Call Date' },
  { key: 'last_status_date', label: 'Last Status Date' },
  { key: 'qualified_by_name', label: 'Qualified By' },
  { key: 'qualified_at', label: 'Qualified At' },
  { key: 'incubation_agent_name', label: 'Incubation Agent' },
  { key: 'handover_booked_time', label: 'Handover Booked Time' },
  { key: 'trip_deadline', label: 'Trip Deadline' },
  { key: 'first_trip_date', label: '1st Trip Date' },
  { key: 'first_trip_cid', label: '1st Trip CID' },
  { key: 'care_end_date', label: 'Care End Date' },
  { key: 'care_days_left', label: 'Care Days Left' },
  { key: 'pickup_state', label: 'Pickup State' },
  { key: 'missing_business_id', label: 'Missing Business ID' },
  { key: 'duplicate_phone', label: 'Duplicate Phone' },
  { key: 'sla_breach', label: 'SLA Breach' },
  { key: 'trip_overdue', label: 'Trip Overdue' },
  { key: 'alert', label: 'Alert' },
];

export const EXPORT_COL_KEYS = EXPORT_COLUMNS.map(c => c.key);

export function toCsvValue(v: any): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function parseListParam(v: string | null): string[] | null {
  if (!v) return null;
  const arr = v.split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : null;
}
