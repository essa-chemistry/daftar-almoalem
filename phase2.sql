-- =====================================================================
-- دفتر المعلم — المرحلة 2 (phase2.sql)
-- شغّله بعد schema.sql. يضيف جدولين فقط ولا يعدّل أي جدول سابق ولا يمس البيانات.
--   tr_referrals      : الإحالات (إلى الوكيل/المرشد/المدير) وتتبع حالتها
--   tr_name_practice  : تقدم المعلم في «اختبر نفسك في الأسماء» (تكرار متباعد)
-- =====================================================================
do $$
declare
  defs text[][] := array[
    array['tr_referrals',     'student_id uuid, class_id uuid, date date, status text'],
    array['tr_name_practice', 'student_id uuid']
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

create index if not exists tr_referrals_student_idx on public.tr_referrals (student_id, date);
-- انتهى.
