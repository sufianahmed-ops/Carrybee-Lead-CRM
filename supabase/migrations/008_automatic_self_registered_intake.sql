-- Automatic, idempotent self-registered lead intake from Data_Dump_2.
alter table public.sheet_sync_runs
  add column organic_received integer not null default 0,
  add column organic_imported integer not null default 0;

create or replace function public.import_organic_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_phone text;
  v_bid text := btrim(coalesce(p->>'businessId',''));
  v_registration date;
  v_cutoff date;
  v_lead public.leads%rowtype;
  v_note text;
begin
  v_registration := nullif(p->>'registrationDate','')::date;
  select value::date into v_cutoff from public.app_settings where key='LEGACY_CUTOFF';
  v_cutoff := coalesce(v_cutoff,'2026-11-04'::date);
  if v_registration is null or v_registration < '2000-01-01'::date then
    raise exception 'Registration Date must be a real date after 2000.';
  end if;
  if v_registration <= v_cutoff then
    return jsonb_build_object('status','skipped_legacy','leadId','');
  end if;

  v_phone := public.normalize_phone(p->>'phone');
  if v_phone is null then raise exception 'A valid Bangladeshi mobile phone is required.'; end if;

  -- Serialize concurrent attempts for the same identity. The unique phone index
  -- remains the final safeguard; existing CRM leads are never overwritten.
  perform pg_advisory_xact_lock(hashtext('organic-phone:' || v_phone));
  if v_bid <> '' then perform pg_advisory_xact_lock(hashtext('organic-bid:' || v_bid)); end if;

  select * into v_lead from public.leads
    where phone_clean=v_phone or (v_bid<>'' and business_id=v_bid)
    limit 1;
  if v_lead.id is not null then
    return jsonb_build_object('status','skipped_existing','leadId',v_lead.lead_id);
  end if;

  v_note := 'Auto-imported from Data_Dump_2';
  if coalesce(p->>'profileCompleted','') <> '' then
    v_note := v_note || '; Profile Completed: ' || left(p->>'profileCompleted',50);
  end if;
  if coalesce(p->>'activePaymentMethod','') <> '' then
    v_note := v_note || '; Active Payment Method: ' || left(p->>'activePaymentMethod',200);
  end if;

  insert into public.leads(
    source,phone,business_id,business_name,merchant_name,email,area,
    registration_date,sheet_notes,last_updated
  ) values (
    'Self Registered',v_phone,v_bid,coalesce(p->>'businessName',''),
    coalesce(p->>'merchantName',''),coalesce(p->>'email',''),
    coalesce(p->>'storeAddress',''),v_registration,v_note,now()
  ) returning * into v_lead;

  return jsonb_build_object('status','inserted','leadId',v_lead.lead_id);
end $$;

revoke all on function public.import_organic_lead(jsonb) from public;
grant execute on function public.import_organic_lead(jsonb) to service_role;
