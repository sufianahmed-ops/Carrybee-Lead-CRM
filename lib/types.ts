export type Team = 'LQT' | 'Incubation' | 'Management';
export type Member = {
  id: string; auth_user_id: string | null; name: string; email: string | null;
  team: Team; role: string; active: boolean; employee_id: string | null;
  stage?: 'LQT' | 'Incubation' | null;   // the stage the person actually works in
  on_leave?: boolean;                    // out today: kept out of rotations, still assignable by hand
  is_main_admin?: boolean;               // the person who can grant admin permissions
  admin_access?: boolean;                // granted Admin access: acts like an admin, can be revoked
  can_manage_people?: boolean;           // may change works stage / today / lending (Main Admin + Sazzad)
  admin_access_granted_by?: string | null;
  admin_access_granted_at?: string | null;
  lend_stage?: 'LQT' | 'Incubation' | null;  // borrowed to the other team for today
  lend_cap?: number | null;                  // max leads they may take while borrowed
  lend_reason?: string | null;
};
export type Rule = {
  status: string; stage: 'LQT' | 'Handover' | 'Incubation' | 'Final'; tab: string;
  is_final: boolean; set_by: string; needs_next_date: boolean; reason_required: boolean;
  allowed_reasons: string[]; meaning: string;
};
export type Setting = { key: string; value: string; description: string };
export type ListValue = { category: string; value: string; sort_order: number };
export type ScriptPoint = { point_number: number; talking_point: string; script_text: string };
export type Lead = {
  id: string; lead_id: string; source: string; funnel: string | null; phone: string; phone_clean: string;
  business_id: string; business_name: string; merchant_name: string; email: string; fb_link: string;
  product_category: string; parcel_volume: string; zone: string; area: string; existing_courier: string;
  assigned_to: string | null; assigned_to_name: string | null; assign_date: string | null; registration_date: string | null;
  sheet_notes: string; incubation_agent: string | null; incubation_agent_name: string | null;
  handover_booked_time: string | null; handover_note: string; first_trip_date: string | null; first_trip_cid: string;
  onboarded_form: string; pickup_miss: string; last_updated: string;
  total_calls: number; lqt_touches: number; incubation_calls: number; cnr_count: number;
  points: number[]; points_covered: number; first_contact_date: string | null; last_call_date: string | null;
  last_status: string | null; last_status_date: string | null; last_reason: string | null;
  last_next_date: string | null; last_note: string | null; current_status: string; stage: string; tab: string;
  is_final: 'Yes' | 'No'; current_owner: string | null; handover_accepted_date: string | null;
  trip_deadline: string | null; care_end_date: string | null; care_days_left: number | null;
  next_due_date: string | null; due_state: string; must_close_next_call: string;
  next_date_default: string | null; next_date_max: string | null; first_contact_late: string;
  callback_hold: boolean; callback_date: string | null;
  qualified_by: string | null; qualified_by_name: string | null; qualified_at: string | null;
  sla_breach: string; trip_overdue: string; handover_call_due: string | null; handover_call_state: string;
  missing_business_id: string; return_reason: string; has_legacy: string; in_onboarding_tracker: string;
  duplicate_phone: string; priority: number; first_order_date: string | null; alert: string;
  pickup_state: string; pickup_days_left: number | null; pickup_last_request_at: string | null;
  lead_generation: 'New' | 'Old';
};
export type CallLog = {
  id: string; log_id: string; logged_at: string; call_time: string; public_lead_id: string;
  phone: string; agent_name: string; team: string; event_type: string; status: string; reason: string;
  channel: string; points_covered: number[]; next_date: string | null; note: string; entry_source: string;
};
export type Bootstrap = {
  leads: Lead[]; members: Member[]; rules: Rule[]; settings: Setting[];
  lists: ListValue[]; scripts: ScriptPoint[];
};
