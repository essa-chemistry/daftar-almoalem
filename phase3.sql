-- =====================================================================
-- دفتر المعلم — المرحلة 3 (phase3.sql)
-- شغّله بعد schema.sql و phase2.sql. لا يعدّل أي جدول سابق ولا يمس البيانات.
--   جداول مزامنة (للمعلم فقط): tr_portal_snapshots، tr_photo_requests، tr_plan_lessons
--   جداول سرية (لا يصل إليها أحد إلا الدوال): tr_student_access، tr_portal_sessions، tr_portal_throttle
--   بوابة الطالب تعمل فقط عبر دوال security definer — المستخدم العام لا يقرأ أي جدول.
-- =====================================================================

-- ---------- جداول المزامنة ----------
do $$
declare
  defs text[][] := array[
    array['tr_portal_snapshots', 'student_id uuid, class_id uuid, term int'],
    array['tr_photo_requests',   'student_id uuid, status text'],
    array['tr_plan_lessons',     'grade int, term int']
  ];
  i int; tbl text; extra text;
begin
  for i in 1..array_length(defs,1) loop
    tbl := defs[i][1]; extra := defs[i][2];
    execute format($f$
      create table if not exists public.%I (
        id uuid primary key,
        owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
        workspace_id uuid,
        %s,
        data jsonb not null default '{}'::jsonb,
        deleted boolean not null default false,
        client_updated_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )$f$, tbl, extra);
    execute format('create index if not exists %I on public.%I (owner_id, updated_at)', tbl || '_sync_idx', tbl);
    execute format('create index if not exists %I on public.%I (workspace_id)', tbl || '_ws_idx', tbl);
    execute format('drop trigger if exists %I on public.%I', tbl || '_touch', tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tr_touch()', tbl || '_touch', tbl);
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_owner', tbl);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', tbl || '_owner', tbl);
    execute format('revoke all on public.%I from anon', tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
  end loop;
end $$;
create index if not exists tr_portal_snapshots_student_idx on public.tr_portal_snapshots (student_id);
create index if not exists tr_photo_requests_student_idx on public.tr_photo_requests (student_id);

-- ---------- جداول سرية ----------
create table if not exists public.tr_student_access (
  student_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash text,                       -- bcrypt للرمز المكوّن من 6 أرقام (لا يُخزَّن الرمز نفسه)
  code_set_at timestamptz,
  changed_by_student boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.tr_portal_throttle (  -- إيقاف مؤقت بعد المحاولات الخاطئة
  nid_hmac text primary key,
  fails int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
create table if not exists public.tr_portal_sessions (  -- يُحفظ hash رمز الجلسة فقط
  token_hash text primary key,
  student_id uuid not null,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.tr_student_access enable row level security;
alter table public.tr_portal_throttle enable row level security;
alter table public.tr_portal_sessions enable row level security;
revoke all on public.tr_student_access, public.tr_portal_throttle, public.tr_portal_sessions from anon, authenticated;

-- ---------- إعدادات البوابة (من مساحة العمل + تخصيص الفصل) ----------
create or replace function public.tr_portal_cfg(p_ws uuid, p_class uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare base jsonb; cl jsonb;
  defaults jsonb := '{"absence":true,"late":true,"behavior":true,"sleep":true,"participation":true,"homework":true,"tests":true,"grade":true,"breakdown":true}';
begin
  select coalesce(data->'portal', '{}'::jsonb) into base from public.tr_workspaces where id = p_ws and not deleted;
  base := coalesce(base, '{}'::jsonb);
  cl := coalesce(base->'classes'->(p_class::text), '{}'::jsonb);
  return jsonb_build_object(
    'enabled', coalesce((base->>'enabled')::boolean, false),
    'paused', coalesce((base->>'paused')::boolean, false) or coalesce((cl->>'paused')::boolean, false),
    'require_code', coalesce((base->>'require_code')::boolean, true),
    'grades_after', base->>'grades_after',
    'show', defaults || coalesce(base->'show', '{}'::jsonb) || coalesce(cl->'show', '{}'::jsonb)
  );
end $$;
revoke all on function public.tr_portal_cfg(uuid, uuid) from public, anon, authenticated;

-- مجموعة نوع الحدث في البوابة
create or replace function public.tr_type_group(d jsonb)
returns text language sql immutable as $$
  select coalesce(nullif(d->>'portal_group', ''),
    case when d->>'name' like '%نوم%' then 'sleep'
         when d->>'valence' = 'neg' then 'behavior'
         when d->>'category' = 'participation' or d->>'valence' = 'pos' then 'participation'
         else 'other' end)
$$;

-- الطالب الأحدث بهذا السجل المدني في مساحة عمل غير مؤرشفة
create or replace function public.tr_portal_find(p_nid text)
returns table (student_id uuid, owner_id uuid, workspace_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select s.student_id, s.owner_id, st.workspace_id
  from public.tr_student_secrets s
  join public.tr_students st on st.id = s.student_id and not st.deleted
  join public.tr_workspaces w on w.id = st.workspace_id and not w.deleted and coalesce((w.data->>'archived')::boolean, false) = false
  where s.nid_hmac = public.tr_nid_hash(p_nid)
  order by st.created_at desc limit 1
$$;
revoke all on function public.tr_portal_find(text) from public, anon, authenticated;

create or replace function public.tr_current_class(p_student uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select class_id from public.tr_enrollments where student_id = p_student and not deleted
  order by (end_date is null) desc, start_date desc limit 1
$$;
revoke all on function public.tr_current_class(uuid) from public, anon, authenticated;

-- ---------- دخول الطالب ----------
-- لا ترمي استثناءً عند الفشل حتى يُحفظ عدّاد المحاولات (الاستثناء يلغي المعاملة)
create or replace function public.tr_portal_login(p_nid text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_h text; t record; f record; a record; cfg jsonb; ok boolean := false; tok text; v_fail int;
begin
  if length(public.tr_norm_nid(p_nid)) <> 10 then return jsonb_build_object('ok', false, 'error', 'بيانات الدخول غير صحيحة'); end if;
  v_h := public.tr_nid_hash(p_nid);
  select * into t from public.tr_portal_throttle where nid_hmac = v_h;
  if found and t.locked_until is not null and t.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', format('محاولات خاطئة كثيرة. حاول بعد %s دقيقة.', ceil(extract(epoch from (t.locked_until - now())) / 60)::int));
  end if;
  select * into f from public.tr_portal_find(p_nid);
  if f.student_id is not null then
    cfg := public.tr_portal_cfg(f.workspace_id, public.tr_current_class(f.student_id));
    if not (cfg->>'enabled')::boolean then return jsonb_build_object('ok', false, 'error', 'بوابة الطالب غير مفعّلة حالياً'); end if;
    if (cfg->>'paused')::boolean then return jsonb_build_object('ok', false, 'error', 'البوابة متوقفة مؤقتاً من المعلم'); end if;
    select * into a from public.tr_student_access where student_id = f.student_id;
    if (cfg->>'require_code')::boolean then
      ok := a.code_hash is not null and extensions.crypt(coalesce(p_code, ''), a.code_hash) = a.code_hash;
    else
      ok := true;
    end if;
  end if;
  if not ok then
    insert into public.tr_portal_throttle as th (nid_hmac, fails, window_start) values (v_h, 1, now())
    on conflict (nid_hmac) do update set
      fails = case when th.window_start < now() - interval '15 minutes' then 1 else th.fails + 1 end,
      window_start = case when th.window_start < now() - interval '15 minutes' then now() else th.window_start end
    returning fails into v_fail;
    if v_fail >= 5 then update public.tr_portal_throttle set locked_until = now() + interval '15 minutes' where nid_hmac = v_h; end if;
    return jsonb_build_object('ok', false, 'error', 'بيانات الدخول غير صحيحة');
  end if;
  delete from public.tr_portal_throttle where nid_hmac = v_h;
  delete from public.tr_portal_sessions where expires_at < now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tr_portal_sessions (token_hash, student_id, owner_id, expires_at)
  values (encode(extensions.digest(tok, 'sha256'), 'hex'), f.student_id, f.owner_id, now() + interval '12 hours');
  return jsonb_build_object('ok', true, 'token', tok, 'must_change', coalesce(a.code_hash is not null and not a.changed_by_student, false));
end $$;

create or replace function public.tr_portal_session(p_token text)
returns table (student_id uuid, owner_id uuid) language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return query select s.student_id, s.owner_id from public.tr_portal_sessions s
    where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expires_at > now();
  if not found then raise exception 'انتهت الجلسة، سجّل الدخول مجدداً'; end if;
end $$;
revoke all on function public.tr_portal_session(text) from public, anon, authenticated;

-- ---------- بيانات الطالب المفلترة على الخادم ----------
create or replace function public.tr_portal_me(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare s record; st record; v_cls uuid; cfg jsonb; sh jsonb; out jsonb; grades_ok boolean; v_classes uuid[];
begin
  select * into s from public.tr_portal_session(p_token);
  select * into st from public.tr_students where id = s.student_id and not deleted;
  if not found then return jsonb_build_object('ok', false, 'error', 'الحساب غير متاح'); end if;
  v_cls := public.tr_current_class(st.id);
  cfg := public.tr_portal_cfg(st.workspace_id, v_cls);
  if not (cfg->>'enabled')::boolean or (cfg->>'paused')::boolean then return jsonb_build_object('ok', false, 'error', 'البوابة متوقفة مؤقتاً من المعلم'); end if;
  sh := cfg->'show';
  grades_ok := (cfg->>'grades_after') is null or (cfg->>'grades_after') = '' or (cfg->>'grades_after')::date <= current_date;
  select array_agg(distinct class_id) into v_classes from public.tr_enrollments where student_id = st.id and not deleted;

  out := jsonb_build_object('ok', true, 'show', sh, 'grades_visible', grades_ok, 'grades_after', cfg->>'grades_after',
    'student', jsonb_build_object(
      'name', st.data->>'full_name', 'seat_no', st.data->>'seat_no', 'id_last4', st.data->>'id_last4',
      'class', (select data->>'name' from public.tr_classes where id = v_cls),
      'school', (select data->'identity'->>'school' from public.tr_workspaces where id = st.workspace_id),
      'subject', (select data->'identity'->>'subject' from public.tr_workspaces where id = st.workspace_id),
      'teacher', (select data->'identity'->>'teacher' from public.tr_workspaces where id = st.workspace_id)),
    'photo', (select data->>'data' from public.tr_student_photos where id = st.id and not deleted and status = 'approved'),
    'photo_request', (select status from public.tr_photo_requests where student_id = st.id and not deleted order by created_at desc limit 1));

  -- الحضور: عدد الحصص المنعقدة خلال فترات تسجيله فقط
  if (sh->>'absence')::boolean or (sh->>'late')::boolean then
    out := out || jsonb_build_object('attendance', (
      select jsonb_build_object(
        'sessions', (select count(*) from public.tr_sessions x join public.tr_enrollments e on e.class_id = x.class_id and e.student_id = st.id and not e.deleted
                      where not x.deleted and x.date >= e.start_date and (e.end_date is null or x.date <= e.end_date) and x.date <= current_date),
        'absent_excused', case when (sh->>'absence')::boolean then (select count(*) from public.tr_attendance where student_id = st.id and not deleted and status = 'absent_excused') end,
        'absent_unexcused', case when (sh->>'absence')::boolean then (select count(*) from public.tr_attendance where student_id = st.id and not deleted and status = 'absent_unexcused') end,
        'late', case when (sh->>'late')::boolean then (select count(*) from public.tr_attendance where student_id = st.id and not deleted and status = 'late') end,
        'list', (select coalesce(jsonb_agg(jsonb_build_object('date', a.date, 'status', a.status) order by a.date desc), '[]'::jsonb)
                 from public.tr_attendance a where a.student_id = st.id and not a.deleted
                 and ((a.status like 'absent%' and (sh->>'absence')::boolean) or (a.status = 'late' and (sh->>'late')::boolean))))));
  end if;

  -- الأحداث: نوع الحدث وتاريخه فقط (بلا أي نص ملاحظة)، ولأنواع «يظهر للطالب» وللمجموعات المسموحة
  out := out || jsonb_build_object('events', (
    select coalesce(jsonb_agg(jsonb_build_object('date', e.date, 'name', t.data->>'name', 'valence', t.data->>'valence', 'group', public.tr_type_group(t.data), 'icon', t.data->>'icon') order by e.date desc), '[]'::jsonb)
    from (select * from public.tr_events where student_id = st.id and not deleted and not coalesce(voided, false) order by date desc limit 400) e
    join public.tr_event_types t on t.id = e.type_id
    where coalesce((t.data->>'visible')::boolean, true)
      and coalesce(t.data->>'sys', '') not in ('late', 'absent_unexcused', 'absent_excused')
      and public.tr_type_group(t.data) in ('participation', 'behavior', 'sleep')
      and coalesce((sh->>public.tr_type_group(t.data))::boolean, false)));

  if (sh->>'homework')::boolean then
    out := out || jsonb_build_object('homework', (
      select coalesce(jsonb_agg(jsonb_build_object('title', t.data->>'title', 'date', t.date, 'status', r.data->>'status') order by t.date desc), '[]'::jsonb)
      from public.tr_tasks t left join public.tr_task_results r on r.task_id = t.id and r.student_id = st.id and not r.deleted
      where not t.deleted and t.kind = 'homework' and t.date <= current_date
        and exists (select 1 from jsonb_array_elements_text(coalesce(t.data->'class_ids', '[]'::jsonb)) c(id) where c.id::uuid = any(v_classes))
        and exists (select 1 from public.tr_enrollments e where e.student_id = st.id and not e.deleted and e.class_id::text in (select jsonb_array_elements_text(t.data->'class_ids')) and t.date >= e.start_date and (e.end_date is null or t.date <= e.end_date))));
  end if;

  if (sh->>'tests')::boolean then
    out := out || jsonb_build_object('tests', (
      select coalesce(jsonb_agg(jsonb_build_object('title', t.data->>'title', 'kind', t.kind, 'date', t.date, 'max', t.data->>'max_score',
               'score', r.data->>'score', 'status', r.data->>'status') order by t.date desc), '[]'::jsonb)
      from public.tr_tasks t left join public.tr_task_results r on r.task_id = t.id and r.student_id = st.id and not r.deleted
      where not t.deleted and t.kind in ('quiz', 'monthly', 'final', 'worksheet', 'performance', 'project') and t.date <= current_date
        and exists (select 1 from public.tr_enrollments e where e.student_id = st.id and not e.deleted and e.class_id::text in (select jsonb_array_elements_text(t.data->'class_ids')) and t.date >= e.start_date and (e.end_date is null or t.date <= e.end_date))));
  end if;

  if (sh->>'grade')::boolean and grades_ok then
    out := out || jsonb_build_object('grades', (
      select coalesce(jsonb_agg(jsonb_build_object('term', g.term, 'class', (select data->>'name' from public.tr_classes where id = g.class_id),
               'total', g.data->'result'->'total', 'monthly', g.data->'result'->'monthly', 'monthly_of', g.data->'result'->'monthly_of', 'grand', g.data->'result'->'grand',
               'approved', g.data->'result'->'approved', 'updated', g.updated_at,
               'categories', case when (sh->>'breakdown')::boolean then g.data->'result'->'categories' else null end) order by g.term), '[]'::jsonb)
      from public.tr_portal_snapshots g where g.student_id = st.id and not g.deleted));
  end if;
  return out;
end $$;

-- ---------- تغيير الرمز من الطالب ----------
create or replace function public.tr_portal_change_code(p_token text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s record; a record;
begin
  select * into s from public.tr_portal_session(p_token);
  if coalesce(p_new, '') !~ '^[0-9]{6}$' then return jsonb_build_object('ok', false, 'error', 'الرمز الجديد يجب أن يكون 6 أرقام'); end if;
  select * into a from public.tr_student_access where student_id = s.student_id;
  if a.code_hash is not null and extensions.crypt(coalesce(p_old, ''), a.code_hash) <> a.code_hash then
    return jsonb_build_object('ok', false, 'error', 'الرمز الحالي غير صحيح');
  end if;
  insert into public.tr_student_access (student_id, owner_id, code_hash, code_set_at, changed_by_student)
  values (s.student_id, s.owner_id, extensions.crypt(p_new, extensions.gen_salt('bf')), now(), true)
  on conflict (student_id) do update set code_hash = excluded.code_hash, code_set_at = now(), changed_by_student = true, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ---------- رفع صورة من الطالب (بانتظار اعتماد المعلم) ----------
create or replace function public.tr_portal_upload_photo(p_token text, p_data text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s record; v_ws uuid;
begin
  select * into s from public.tr_portal_session(p_token);
  if coalesce(p_data, '') not like 'data:image/%' or length(p_data) > 110000 then
    return jsonb_build_object('ok', false, 'error', 'الصورة غير صالحة أو كبيرة جداً');
  end if;
  select workspace_id into v_ws from public.tr_students where id = s.student_id;
  update public.tr_photo_requests set deleted = true where student_id = s.student_id and status = 'pending';
  insert into public.tr_photo_requests (id, owner_id, workspace_id, student_id, status, data)
  values (gen_random_uuid(), s.owner_id, v_ws, s.student_id, 'pending', jsonb_build_object('data', p_data, 'uploaded_at', now()));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tr_portal_logout(p_token text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.tr_portal_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- ---------- دوال المعلم ----------
create or replace function public.tr_portal_set_code(p_student_id uuid, p_code text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' then raise exception 'الرمز يجب أن يكون 6 أرقام'; end if;
  if not exists (select 1 from public.tr_students where id = p_student_id and owner_id = auth.uid()) then raise exception 'الطالب غير موجود على الخادم بعد — انتظر المزامنة'; end if;
  insert into public.tr_student_access (student_id, owner_id, code_hash, code_set_at, changed_by_student)
  values (p_student_id, auth.uid(), extensions.crypt(p_code, extensions.gen_salt('bf')), now(), false)
  on conflict (student_id) do update set code_hash = excluded.code_hash, code_set_at = now(), changed_by_student = false, updated_at = now();
  delete from public.tr_portal_throttle where nid_hmac in (select nid_hmac from public.tr_student_secrets where student_id = p_student_id and owner_id = auth.uid());
  return true;
end $$;

create or replace function public.tr_portal_status(p_ids uuid[])
returns table (student_id uuid, has_nid boolean, has_code boolean, changed boolean, locked boolean)
language sql stable security definer set search_path = public as $$
  select st.id,
    exists (select 1 from public.tr_student_secrets x where x.student_id = st.id),
    exists (select 1 from public.tr_student_access a where a.student_id = st.id and a.code_hash is not null),
    coalesce((select a.changed_by_student from public.tr_student_access a where a.student_id = st.id), false),
    exists (select 1 from public.tr_portal_throttle th join public.tr_student_secrets x on x.nid_hmac = th.nid_hmac where x.student_id = st.id and th.locked_until > now())
  from public.tr_students st where st.id = any(p_ids) and st.owner_id = auth.uid()
$$;

create or replace function public.tr_portal_unlock(p_student_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  delete from public.tr_portal_throttle where nid_hmac in (select nid_hmac from public.tr_student_secrets where student_id = p_student_id and owner_id = auth.uid());
  return true;
end $$;

-- ---------- الصلاحيات ----------
revoke all on function public.tr_portal_login(text, text), public.tr_portal_me(text), public.tr_portal_change_code(text, text, text),
  public.tr_portal_upload_photo(text, text), public.tr_portal_logout(text) from public;
grant execute on function public.tr_portal_login(text, text), public.tr_portal_me(text), public.tr_portal_change_code(text, text, text),
  public.tr_portal_upload_photo(text, text), public.tr_portal_logout(text) to anon, authenticated;
revoke all on function public.tr_portal_set_code(uuid, text), public.tr_portal_status(uuid[]), public.tr_portal_unlock(uuid) from public, anon;
grant execute on function public.tr_portal_set_code(uuid, text), public.tr_portal_status(uuid[]), public.tr_portal_unlock(uuid) to authenticated;
-- انتهى.
