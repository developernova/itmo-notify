-- Apply after the original schema. Group tasks are append-only for clients.
create table public.study_groups (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 60),
 invite_code text not null unique default replace(gen_random_uuid()::text,'-',''),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create table public.group_members (
 group_id uuid not null references public.study_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(), primary key(group_id,user_id)
);
alter table public.study_groups enable row level security;
alter table public.group_members enable row level security;
create function public.is_group_member(target uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.group_members where group_id=target and user_id=auth.uid());
$$;
revoke all on function public.is_group_member(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
create policy "Members read groups" on public.study_groups for select to authenticated using(public.is_group_member(id));
create policy "Members read membership" on public.group_members for select to authenticated using(public.is_group_member(group_id));
create function public.create_study_group(group_name text) returns public.study_groups
language plpgsql security definer set search_path=public as $$
declare result public.study_groups;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if length(trim(group_name)) not between 1 and 60 then raise exception 'Invalid group name'; end if;
 insert into public.study_groups(name,created_by) values(trim(group_name),auth.uid()) returning * into result;
 insert into public.group_members(group_id,user_id) values(result.id,auth.uid());
 return result;
end; $$;
create function public.join_study_group(code text) returns public.study_groups
language plpgsql security definer set search_path=public as $$
declare result public.study_groups;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into result from public.study_groups where invite_code=lower(trim(code));
 if result.id is null then raise exception 'Группа не найдена. Проверь код.'; end if;
 insert into public.group_members(group_id,user_id) values(result.id,auth.uid()) on conflict do nothing;
 return result;
end; $$;
revoke all on function public.create_study_group(text),public.join_study_group(text) from public;
grant execute on function public.create_study_group(text),public.join_study_group(text) to authenticated;
alter table public.tasks add column group_id uuid references public.study_groups(id) on delete restrict;
create index tasks_group on public.tasks(group_id,due_at);
drop policy "Read own tasks" on public.tasks;
drop policy "Insert own tasks" on public.tasks;
drop policy "Update own tasks" on public.tasks;
drop policy "Delete own tasks" on public.tasks;
create policy "Read personal or group tasks" on public.tasks for select to authenticated using(
 (group_id is null and user_id=auth.uid()) or (group_id is not null and public.is_group_member(group_id))
);
create policy "Add personal or group tasks" on public.tasks for insert to authenticated with check(
 user_id=auth.uid() and not completed and (group_id is null or public.is_group_member(group_id))
);
create policy "Update personal only" on public.tasks for update to authenticated using(group_id is null and user_id=auth.uid()) with check(group_id is null and user_id=auth.uid());
create policy "Delete personal only" on public.tasks for delete to authenticated using(group_id is null and user_id=auth.uid());
-- Keep shared assignments if their author deletes their account.
alter table public.tasks drop constraint tasks_user_id_fkey;
alter table public.tasks alter column user_id drop not null;
alter table public.tasks add constraint tasks_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;
alter table public.push_subscriptions add column hidden_task_ids uuid[] not null default '{}';

-- Track reminder delivery for each member, not only the author of a task.
create table public.reminder_deliveries (
 task_id uuid not null references public.tasks(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 due_at timestamptz not null,
 reminder_minutes integer not null,
 claimed_at timestamptz,
 sent_at timestamptz,
 primary key(task_id,user_id)
);
alter table public.reminder_deliveries enable row level security;
drop function public.claim_reminders();
create function public.claim_reminders() returns table(task_id uuid,user_id uuid,title text,subject text,due_at timestamptz,reminder_minutes integer,claimed_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
 insert into public.reminder_deliveries as d(task_id,user_id,due_at,reminder_minutes)
 select t.id, recipients.user_id,t.due_at,t.reminder_minutes from public.tasks t
 cross join lateral (
  select t.user_id where t.group_id is null and t.user_id is not null
  union all select m.user_id from public.group_members m where m.group_id=t.group_id
 ) recipients
 where not t.completed and t.due_at-make_interval(mins=>t.reminder_minutes)<=now() and t.due_at>now()-interval '1 day'
 and exists(select 1 from public.push_subscriptions p where p.user_id=recipients.user_id and not(t.id=any(p.hidden_task_ids)))
 on conflict on constraint reminder_deliveries_pkey do update set due_at=excluded.due_at,reminder_minutes=excluded.reminder_minutes,sent_at=null,claimed_at=null
 where d.due_at is distinct from excluded.due_at or d.reminder_minutes is distinct from excluded.reminder_minutes;
 return query
 with pending as (
  select d.task_id,d.user_id from public.reminder_deliveries d join public.tasks t on t.id=d.task_id
  where d.sent_at is null and (d.claimed_at is null or d.claimed_at<now()-interval '5 minutes')
  and not t.completed and t.due_at>now()-interval '1 day' and t.due_at-make_interval(mins=>t.reminder_minutes)<=now()
  and ((t.group_id is null and t.user_id=d.user_id) or exists(select 1 from public.group_members m where m.group_id=t.group_id and m.user_id=d.user_id))
  and exists(select 1 from public.push_subscriptions p where p.user_id=d.user_id and not(t.id=any(p.hidden_task_ids)))
  order by t.due_at limit 20 for update of d skip locked
 ), claimed as (
  update public.reminder_deliveries d set claimed_at=now() from pending p where d.task_id=p.task_id and d.user_id=p.user_id returning d.*
 ) select c.task_id,c.user_id,t.title,t.subject,t.due_at,t.reminder_minutes,c.claimed_at from claimed c join public.tasks t on t.id=c.task_id;
end; $$;
revoke all on function public.claim_reminders() from public,anon,authenticated;
grant execute on function public.claim_reminders() to service_role;
