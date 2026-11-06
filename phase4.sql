-- =====================================================================
-- دفتر المعلم — تحديث فترات التقويم (phase4.sql)
-- شغّله بعد phase3.sql. لا يعدّل أي جدول ولا يمس البيانات.
-- يحدّث دالة بوابة الطالب فقط لتعرض اسم فترة التقويم (التقويم الأول، الثاني...) بجانب كل درجة.
-- =====================================================================
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
      select coalesce(jsonb_agg(jsonb_build_object('term', g.term, 'label', g.data->'result'->>'label', 'class', (select data->>'name' from public.tr_classes where id = g.class_id),
               'total', g.data->'result'->'total', 'monthly', g.data->'result'->'monthly', 'monthly_of', g.data->'result'->'monthly_of', 'grand', g.data->'result'->'grand',
               'approved', g.data->'result'->'approved', 'updated', g.updated_at,
               'categories', case when (sh->>'breakdown')::boolean then g.data->'result'->'categories' else null end) order by g.term, g.data->'result'->>'start'), '[]'::jsonb)
      from public.tr_portal_snapshots g where g.student_id = st.id and not g.deleted));
  end if;
  return out;
end $$;

revoke all on function public.tr_portal_me(text) from public;
grant execute on function public.tr_portal_me(text) to anon, authenticated;
-- انتهى.
