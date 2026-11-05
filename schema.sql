-- =====================================================================
-- دفتر المعلم — المرحلة 1 (schema.sql)
-- شغّل هذا الملف مرة واحدة في Supabase: SQL Editor → New query → Run
-- كل الجداول والدوال بسابقة tr_ ، والوصول للمعلم فقط عبر RLS (owner_id = auth.uid())
-- المستخدم العام (anon) لا يصل لأي جدول.
-- المراحل اللاحقة تضيف phase2.sql و phase3.sql دون تعديل هذا الملف.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- دالة عامة: ختم الوقت والمالك ----------
create or replace function public.tr_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    new.created_at := coalesce(new.created_at, now());
  else
    new.owner_id := old.owner_id;          -- لا يُسمح بتغيير المالك
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- ---------- إنشاء جدول بالبنية الموحدة ----------
-- كل جدول: أعمدة أساسية + أعمدة فهرسة + data jsonb لبقية الحقول
-- (يجعل الإضافات في المراحل القادمة ممكنة دون تعديل البنية)
do $$
declare
  t record;
  defs text[][] := array[
    -- اسم الجدول            , أعمدة إضافية
    array['tr_workspaces',     ''],
    array['tr_classes',        'grade int, section text'],
    array['tr_students',       'status text'],
    array['tr_enrollments',    'student_id uuid, class_id uuid, start_date date, end_date date'],
    array['tr_student_private','student_id uuid'],
    array['tr_student_photos', 'student_id uuid, status text'],
    array['tr_notes',          'student_id uuid, session_id uuid, date date'],
    array['tr_contacts',       'student_id uuid, date date'],
    array['tr_timetables',     'effective_from date'],
    array['tr_exceptions',     'date date, date_to date'],
    array['tr_sessions',       'class_id uuid, date date, period int'],
    array['tr_attendance',     'session_id uuid, student_id uuid, class_id uuid, date date, status text'],
    array['tr_event_types',    ''],
    array['tr_events',         'session_id uuid, class_id uuid, student_id uuid, type_id uuid, date date, voided boolean default false'],
    array['tr_picks',          'session_id uuid, class_id uuid, student_id uuid, date date'],
    array['tr_picker_state',   'class_id uuid'],
    array['tr_tasks',          'kind text, date date'],
    array['tr_task_results',   'task_id uuid, student_id uuid'],
    array['tr_grade_schemes',  'grade int, term int'],
    array['tr_grade_overrides','class_id uuid, student_id uuid, term int'],
    array['tr_grade_locks',    'class_id uuid, term int'],
    array['tr_audit',          'action text, at timestamptz']
  ];
  i int;
  tbl text; extra text;
begin
  for i in 1..array_length(defs,1) loop
    tbl := defs[i][1]; extra := defs[i][2];
    execute format($f$
      create table if not exists public.%I (
        id uuid primary key,
        owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
        workspace_id uuid,
        %s
        data jsonb not null default '{}'::jsonb,
        deleted boolean not null default false,
        client_updated_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )$f$, tbl, case when extra = '' then '' else extra || ',' end);

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

create index if not exists tr_events_student_idx on public.tr_events (student_id, date);
create index if not exists tr_attendance_session_idx on public.tr_attendance (session_id);
create index if not exists tr_enrollments_student_idx on public.tr_enrollments (student_id);

-- =====================================================================
-- السجل المدني: لا يُخزَّن نصاً صريحاً أبداً.
-- يُخزَّن HMAC-SHA256 بمفتاح سري في جدول لا تصل إليه إلا الدوال.
-- =====================================================================
create table if not exists public.tr_secrets (
  k text primary key,
  v text not null
);
alter table public.tr_secrets enable row level security;     -- بلا سياسات = لا وصول مباشر
revoke all on public.tr_secrets from anon, authenticated;
insert into public.tr_secrets (k, v)
values ('nid_hmac_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (k) do nothing;

create table if not exists public.tr_student_secrets (
  student_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  nid_hmac text not null,
  updated_at timestamptz not null default now()
);
create index if not exists tr_student_secrets_lookup on public.tr_student_secrets (owner_id, nid_hmac);
alter table public.tr_student_secrets enable row level security;
revoke all on public.tr_student_secrets from anon, authenticated;

-- تطبيع الرقم: أرقام عربية → لاتينية، وإزالة غير الأرقام
create or replace function public.tr_norm_nid(p text)
returns text language sql immutable as $$
  select regexp_replace(translate(coalesce(p,''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g')
$$;

create or replace function public.tr_nid_hash(p_nid text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_key text;
begin
  select v into v_key from public.tr_secrets where k = 'nid_hmac_key';
  return encode(extensions.hmac(public.tr_norm_nid(p_nid), v_key, 'sha256'), 'hex');
end $$;
revoke all on function public.tr_nid_hash(text) from public, anon, authenticated;

-- يستدعيها تطبيق المعلم عند الاستيراد/التعديل: تحفظ البصمة وترجع آخر 4 أرقام
create or replace function public.tr_set_student_nid(p_student_id uuid, p_nid text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_n text; v_ws uuid;
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  v_n := public.tr_norm_nid(p_nid);
  if length(v_n) <> 10 then raise exception 'رقم السجل المدني يجب أن يتكون من 10 أرقام'; end if;
  select workspace_id into v_ws from public.tr_students where id = p_student_id and owner_id = auth.uid();
  if not found then raise exception 'الطالب غير موجود على الخادم بعد'; end if;
  insert into public.tr_student_secrets (student_id, owner_id, workspace_id, nid_hmac)
  values (p_student_id, auth.uid(), v_ws, public.tr_nid_hash(v_n))
  on conflict (student_id) do update set nid_hmac = excluded.nid_hmac, workspace_id = excluded.workspace_id, updated_at = now();
  return right(v_n, 4);
end $$;
revoke all on function public.tr_set_student_nid(uuid, text) from public, anon;
grant execute on function public.tr_set_student_nid(uuid, text) to authenticated;

-- للمعلم: البحث عن طالب موجود بالسجل المدني (لكشف التكرار عند الاستيراد)
create or replace function public.tr_find_students_by_nid(p_nids text[])
returns table (nid_last4 text, student_id uuid) language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  return query
    select right(public.tr_norm_nid(n), 4), s.student_id
    from unnest(p_nids) n
    join public.tr_student_secrets s on s.owner_id = auth.uid() and s.nid_hmac = public.tr_nid_hash(n);
end $$;
revoke all on function public.tr_find_students_by_nid(text[]) from public, anon;
grant execute on function public.tr_find_students_by_nid(text[]) to authenticated;

-- حذف البصمة تلقائياً عند الحذف النهائي للطالب
create or replace function public.tr_on_student_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.tr_student_secrets where student_id = old.id and owner_id = old.owner_id;
  return old;
end $$;
drop trigger if exists tr_students_secret_cleanup on public.tr_students;
create trigger tr_students_secret_cleanup after delete on public.tr_students
for each row execute function public.tr_on_student_delete();

-- =====================================================================
-- انتهى. بعد التشغيل: أنشئ حساب المعلم ثم عطّل التسجيل العام (انظر README).
-- =====================================================================
