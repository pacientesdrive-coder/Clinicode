-- =========================================================
-- CLINCOORD MENTAL - FIX v1.4.2
-- RPC segura para crear paciente + equipo tratante.
-- Ejecutar una sola vez en Supabase SQL Editor.
-- =========================================================

create or replace function public.clincoord_create_patient(
  p_patient jsonb,
  p_team jsonb default '[]'::jsonb
)
returns table(id uuid, clinical_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_patient_id uuid;
  v_clinical_code text;
  v_team_item jsonb;
  v_professional_id uuid;
  v_team_role text;
  v_is_primary boolean;
begin
  select *
  into v_profile
  from public.profiles
  where profiles.id = auth.uid()
    and profiles.is_active = true
  limit 1;

  if v_profile.id is null then
    raise exception 'No existe un perfil activo para este usuario.';
  end if;

  if v_profile.role <> 'admin' then
    raise exception 'Solo un administrador puede crear pacientes nuevos.';
  end if;

  insert into public.patients (
    institution_id,
    clinical_code,
    initials,
    age,
    gender,
    dx_main,
    dx_secondary,
    risk,
    status,
    suicide_risk,
    hetero_risk,
    social_risk,
    substances,
    adherence,
    functional_status,
    support_network,
    admission_date,
    last_contact_date,
    next_control_date,
    notes,
    created_by
  )
  values (
    v_profile.institution_id,
    nullif(upper(trim(p_patient->>'clinical_code')), ''),
    nullif(upper(trim(p_patient->>'initials')), ''),
    nullif(p_patient->>'age', '')::integer,
    coalesce(nullif(p_patient->>'gender', ''), 'NR'),
    nullif(p_patient->>'dx_main', ''),
    case
      when jsonb_typeof(p_patient->'dx_secondary') = 'array'
        then coalesce((select array_agg(value) from jsonb_array_elements_text(p_patient->'dx_secondary') as value), '{}'::text[])
      else '{}'::text[]
    end,
    coalesce(nullif(p_patient->>'risk', ''), 'no_evaluado'),
    coalesce(nullif(p_patient->>'status', ''), 'activo'),
    coalesce(nullif(p_patient->>'suicide_risk', ''), 'no_evaluado'),
    coalesce(nullif(p_patient->>'hetero_risk', ''), 'no_evaluado'),
    coalesce(nullif(p_patient->>'social_risk', ''), 'no_evaluado'),
    nullif(p_patient->>'substances', ''),
    nullif(p_patient->>'adherence', ''),
    nullif(p_patient->>'functional_status', ''),
    nullif(p_patient->>'support_network', ''),
    nullif(p_patient->>'admission_date', '')::date,
    nullif(p_patient->>'last_contact_date', '')::date,
    nullif(p_patient->>'next_control_date', '')::date,
    nullif(p_patient->>'notes', ''),
    v_profile.id
  )
  returning patients.id, patients.clinical_code
  into v_patient_id, v_clinical_code;

  for v_team_item in
    select * from jsonb_array_elements(coalesce(p_team, '[]'::jsonb))
  loop
    if nullif(v_team_item->>'professional_id', '') is null then
      continue;
    end if;

    v_professional_id := (v_team_item->>'professional_id')::uuid;
    v_team_role := coalesce(nullif(v_team_item->>'team_role', ''), 'otro');
    v_is_primary := coalesce((v_team_item->>'is_primary')::boolean, false);

    if exists (
      select 1
      from public.professionals pr
      where pr.id = v_professional_id
        and pr.institution_id = v_profile.institution_id
        and pr.is_active = true
    ) then
      insert into public.patient_team (
        patient_id,
        professional_id,
        team_role,
        is_primary
      )
      values (
        v_patient_id,
        v_professional_id,
        v_team_role,
        v_is_primary
      )
      on conflict do nothing;
    end if;
  end loop;

  insert into public.trace_events (
    institution_id,
    patient_id,
    actor_profile_id,
    actor_professional_id,
    action,
    field,
    previous_value,
    next_value,
    event_type
  )
  values (
    v_profile.institution_id,
    v_patient_id,
    v_profile.id,
    v_profile.professional_id,
    'Paciente creado desde app',
    'clinical_code',
    null,
    v_clinical_code,
    'creacion'
  );

  return query select v_patient_id, v_clinical_code;
end;
$$;

grant execute on function public.clincoord_create_patient(jsonb, jsonb) to authenticated;

-- Prueba rápida de existencia de la función.
select proname as funcion_creada
from pg_proc
where proname = 'clincoord_create_patient';
