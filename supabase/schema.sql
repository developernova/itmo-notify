-- Run once in Supabase SQL Editor. External cron calls /api/reminders each minute.
create table public.tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (length(title) between 1 and 160), subject text not null,
 due_at timestamptz not null, reminder_minutes integer not null default 1440 check(reminder_minutes in (0,60,1440,4320)),
 priority text not null default 'normal' check(priority in ('normal','high')), completed boolean not null default false,
 notes text not null default '', notified_at timestamptz, notification_claimed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.tasks enable row level security;
create policy "Read own tasks" on public.tasks for select to authenticated using(auth.uid()=user_id);
create policy "Insert own tasks" on public.tasks for insert to authenticated with check(auth.uid()=user_id);
create policy "Update own tasks" on public.tasks for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "Delete own tasks" on public.tasks for delete to authenticated using(auth.uid()=user_id);
create index tasks_pending on public.tasks(due_at) where completed=false and notified_at is null;
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null, subscription jsonb not null, created_at timestamptz not null default now(), unique(user_id,endpoint)
);
alter table public.push_subscriptions enable row level security;
-- Subscription writes go through authenticated server endpoint to validate destinations.
create or replace function public.reset_reminder() returns trigger language plpgsql set search_path=public as $$
begin
 if new.due_at is distinct from old.due_at or new.reminder_minutes is distinct from old.reminder_minutes or (old.completed and not new.completed) then
 new.notified_at=null; new.notification_claimed_at=null;
 end if;
 return new;
end; $$;
create trigger task_reminder_reset before update on public.tasks for each row execute function public.reset_reminder();
create or replace function public.claim_reminders() returns setof public.tasks language sql security definer set search_path=public as $$
 update public.tasks set notification_claimed_at=now()
 where id in (select id from public.tasks where not completed and notified_at is null
 and due_at - make_interval(mins=>reminder_minutes)<=now() and due_at>now()-interval '1 day'
 and (notification_claimed_at is null or notification_claimed_at<now()-interval '5 minutes')
 order by due_at limit 20 for update skip locked)
 returning *;
$$;
revoke all on function public.claim_reminders() from public,anon,authenticated;
grant execute on function public.claim_reminders() to service_role;

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

-- Apply after 002. Автор правит и удаляет своё задание; остальные участники — нет.
alter table public.tasks drop constraint tasks_reminder_minutes_check;
alter table public.tasks add constraint tasks_reminder_minutes_check
 check(reminder_minutes in (0,10,60,180,1440,4320,10080));
drop policy "Update personal only" on public.tasks;
drop policy "Delete personal only" on public.tasks;
create policy "Update own tasks" on public.tasks for update to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "Delete own tasks" on public.tasks for delete to authenticated using(user_id=auth.uid());
-- Задание не переезжает в другую группу и не меняет автора.
create function public.keep_task_owner() returns trigger language plpgsql set search_path=public as $$
begin
 if new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id then
 raise exception 'Автор и группа задания не меняются';
 end if;
 return new;
end; $$;
create trigger task_owner_guard before update on public.tasks for each row execute function public.keep_task_owner();

-- Apply after 003. Повторяющиеся напоминания: срок сам переезжает на следующий раз.
alter table public.tasks add column repeat_rule text not null default 'none'
 check(repeat_rule in ('none','daily','weekdays','weekly','monthly'));
-- Будни считаются по московскому времени — так же, как подписан текст push.
create function public.next_due(due timestamptz, rule text) returns timestamptz
language plpgsql stable set search_path=public as $$
declare result timestamptz := due;
begin
 if rule is null or rule='none' then return due; end if;
 for guard in 1..500 loop
 result := result + case rule when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' else interval '1 day' end;
 if rule='weekdays' then
 while extract(isodow from result at time zone 'Europe/Moscow')>5 loop result := result + interval '1 day'; end loop;
 end if;
 exit when result>now();
 end loop;
 return result;
end; $$;
-- Запас в 10 минут: сначала уходит напоминание текущего повтора, потом сдвигается срок.
create function public.roll_repeating_tasks() returns integer
language plpgsql security definer set search_path=public as $$
declare moved integer;
begin
 update public.tasks set due_at=public.next_due(due_at,repeat_rule)
 where repeat_rule<>'none' and not completed and due_at<now()-interval '10 minutes';
 get diagnostics moved = row_count;
 return moved;
end; $$;
revoke all on function public.next_due(timestamptz,text),public.roll_repeating_tasks() from public,anon,authenticated;
grant execute on function public.roll_repeating_tasks() to service_role;
